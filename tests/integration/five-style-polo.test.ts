import { Prisma } from "@prisma/client";
import { writeFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The Five Style Polo simulation (src/modules/simulation) on a company set up
 * like the live one: 6,000 pieces in five styles go from the purchase orders to
 * the final CM settlement with the real CM rules (Demo Embo pays for what it
 * spoils, rejects over the 2% allowance and missing pieces come off the
 * factory), every figure is checked, and the wipe leaves every table exactly as
 * it was. The wipe refuses, wiping nothing, when real work was added on top.
 * With FIVE_STYLE_POLO_REPORT set to a file path, the Simulation Report is
 * written there (the GitHub workflow shows it on the run's summary).
 */
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import { prisma } from "@/lib/prisma";
import * as bank from "@/modules/accounts/bank.service";
import { paySupplier } from "@/modules/accounts/supplier-payment.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as stock from "@/modules/inventory/stock.service";
import { getPartyBalance } from "@/modules/parties/ledger.service";
import * as parties from "@/modules/parties/party.service";
import { getBatchSummary } from "@/modules/production/batch-summary.service";
import * as costs from "@/modules/production/cost.service";
import * as projects from "@/modules/production/project.service";
import {
  POLO_BATCH,
  poloPlan,
  POLO_STYLES,
  runFiveStylePolo,
} from "../../prisma/demo/five-style-polo";
import { fiveStylePoloReport, readFiveStylePolo } from "../simulation/five-style-polo/report";
import { wipeSimulation } from "../simulation/five-style-polo/wipe";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/**
 * A company as it stands before the run: a Super Admin and an accountant, a bank
 * account, a CM factory with an older CM bill part paid, a fabric mill, and a
 * closed factory that must not be picked. Set up like the live one, it has its
 * store, sizes S to XL, the Navy colour and the Lacoste brand already.
 */
async function company({ setUp = true } = {}) {
  const { company, roles } = await makeCompany("Extas");
  const ownerUser = await makeUser("owner@extras.test");
  await addToCompany(ownerUser.id, company.id, roles.SUPER_ADMIN);
  const accountsUser = await makeUser("accounts@extras.test");
  await addToCompany(accountsUser.id, company.id, roles.ACCOUNTS);
  const owner = await contextFor(ownerUser.id, company.id);
  const accounts = await contextFor(accountsUser.id, company.id);
  if (setUp) {
    await stock.createWarehouse(owner, { name: "Main store", isDefault: true });
    for (const name of ["S", "M", "L", "XL"]) await catalog.createSize(owner, { name });
    await catalog.createColor(owner, { name: "Navy", hexCode: "#1F2A44" });
    await catalog.createBrand(owner, { name: "Lacoste" });
  }
  const supplier = async (name: string, category: "CM" | "FABRIC") =>
    (await parties.createParty(owner, { kind: "SUPPLIER", name, supplierCategories: [category] }))
      .party;
  const closed = await supplier("Old Tongi Factory", "CM");
  await prisma.party.update({ where: { id: closed.id }, data: { status: "CLOSED" } });
  const factory = await supplier("Gazipur Knit Composite", "CM");
  const mill = await supplier("Narayanganj Fabric Mills", "FABRIC");
  await bank.createBankAccount(accounts, {
    bankName: "Dutch-Bangla Bank",
    accountName: "Extas Apparel",
    accountNumber: "1101100045678",
  });
  // Last season's tee at the same factory: a 50,000 CM bill, 20,000 of it paid.
  const tee = await projects.createProject(owner, {
    name: "Last season tee",
    factoryId: factory.id,
    startDate: "2026-07-01",
    targetDate: "2026-08-30",
    targetQuantity: 500,
  });
  await costs.ensureProductionCostHeads(company.id);
  const sewing = await prisma.expenseHead.findFirstOrThrow({
    where: { companyId: company.id, name: "Sewing (CM)" },
  });
  await costs.addProjectCost(owner, tee.id, {
    expenseHeadId: sewing.id,
    amount: 50_000,
    paymentType: "DUE",
    supplierId: factory.id,
    date: "2026-08-01",
  });
  await paySupplier(accounts, { supplierId: factory.id, amount: 20_000, method: "CASH" });
  await prisma.notificationLog.deleteMany();
  return { company, owner, accounts, factory, mill };
}

/** Every table's rows, as one fingerprint each: equal means not a byte changed. */
async function fingerprint() {
  const tables = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT tablename AS name FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    ORDER BY tablename`;
  const out: Record<string, string> = {};
  for (const { name } of tables) {
    const [row] = await prisma.$queryRawUnsafe<Array<{ n: bigint; h: string | null }>>(
      `SELECT count(*) AS n, md5(string_agg(t::text, '|' ORDER BY t::text)) AS h FROM "${name}" t`,
    );
    out[name] = `${row!.n} rows ${row!.h ?? "-"}`;
  }
  return out;
}

const due = async (ctx: Parameters<typeof getPartyBalance>[0], partyId: string) =>
  (await getPartyBalance(ctx, partyId)).neg().toFixed(2);

run("The Five Style Polo simulation", () => {
  let env: Awaited<ReturnType<typeof company>>;

  beforeEach(async () => {
    await resetDb();
    env = await company();
  });

  it("runs 6,000 pieces through the real CM rules, then wipes it without a trace", async () => {
    const before = await fingerprint();
    const sim = await runFiveStylePolo(env.owner, { seed: 2026 });
    expect(sim.error).toBeNull();

    // The company's own factory, mill and bank; its store, sizes, colour and brand reused.
    expect([sim.factory!.name, sim.mill!.name]).toEqual([
      "Gazipur Knit Composite",
      "Narayanganj Fabric Mills",
    ]);
    expect(sim.bank!.name).toMatch(/Dutch-Bangla Bank/);
    expect(sim.created).toMatchObject({ warehouseIds: [], categoryIds: [expect.any(String)] });
    expect(sim.created.sizeIds).toHaveLength(1); // XXL
    expect(sim.created.colorIds).toHaveLength(4); // all but Navy
    expect(sim.created.brandIds).toHaveLength(4); // all but Lacoste
    expect(sim.created.partyIds).toHaveLength(3);
    const embo = await prisma.party.findUniqueOrThrow({ where: { id: sim.added.embo!.id } });
    expect([embo.name, embo.city, embo.supplierCategories]).toEqual([
      "Demo Embo",
      "Gazipur",
      ["EMBROIDERY_PRINT"],
    ]);

    // Five styles of 1,200 (S to XXL), 6,119 cut, a target price of 450-500 a piece.
    const s = await getBatchSummary(env.owner, sim.batchId!);
    expect(s.batch.name).toBe(POLO_BATCH);
    expect(s.styles.map((x) => [x.name, x.target, x.cut])).toEqual([
      ["Ralph Lauren pique polo", 1200, 1223],
      ["Tommy pique polo", 1200, 1224],
      ["CK pique polo", 1200, 1225],
      ["Boss pique polo", 1200, 1223],
      ["Lacoste pique polo", 1200, 1224],
    ]);
    for (const x of s.styles) {
      expect(Number(x.targetPrice)).toBeGreaterThanOrEqual(450);
      expect(Number(x.targetPrice)).toBeLessThanOrEqual(500);
    }
    expect(s.pieces).toEqual({
      target: 6000,
      cut: 6119,
      a: 5857,
      b: 88,
      c: 50,
      reject: 112,
      missing: 12,
      good: 5945,
    });
    expect(poloPlan(POLO_STYLES[1]).reduce((t, z) => t + z.reject, 0)).toBe(37);

    // Demo Embo spoiled 22 pieces: each valued at the fabric in a cut piece and taken
    // off Demo Embo's own Supplier Due at once, never the factory's.
    const house = s.penalties.faults.filter((f) => f.kind === "SPOILED_PIECES");
    expect(house.map((f) => [f.supplier.name, f.quantity, f.amount, f.status])).toEqual([
      ["Demo Embo", "6", "1156.62", "DEDUCTED"],
      ["Demo Embo", "4", "771.16", "DEDUCTED"],
      ["Demo Embo", "4", "771.20", "DEDUCTED"],
      ["Demo Embo", "5", "963.85", "DEDUCTED"],
      ["Demo Embo", "3", "578.37", "DEDUCTED"],
    ]);
    expect(s.penalties.housesOff).toBe("4241.20");
    expect(
      await prisma.supplierFault.count({
        where: { supplierId: env.factory.id, kind: { in: ["QUALITY", "SPOILED_PIECES"] } },
      }),
    ).toBe(0);
    // Its bills: the good pieces at 10-12 a piece (print at 9), less what it spoiled.
    expect(await due(env.owner, embo.id)).toBe("59686.04");

    // The 2% rule: Ralph Lauren's 15 rejects of 1,223 cut cost nothing; Tommy's 37 of
    // 1,224 are 13 over the allowance of 24, each at Tommy's target price.
    const tommy = sim.styles.find((x) => x.brand === "Tommy")!;
    expect(s.penalties.cm.overAllowance).toEqual([
      expect.objectContaining({
        code: tommy.projectCode,
        reject: 37,
        allowance: 24,
        over: 13,
        targetPrice: tommy.targetUnitCost,
        amount: new Prisma.Decimal(tommy.targetUnitCost).times(13).toFixed(2),
      }),
    ]);
    // 12 missing pieces, all charged to the factory at the style's final unit cost.
    const missing = s.penalties.faults.filter((f) => f.kind === "MISSING_PIECES");
    expect(missing.map((f) => [f.supplier.name, f.quantity, f.status])).toEqual(
      [2, 3, 2, 3, 2].map((n) => ["Gazipur Knit Composite", String(n), "DEDUCTED"]),
    );

    // The final settlement: CM on A+B+C+rejects, less the missing pieces, the rejects
    // over the allowance, the C-grade CM and the advance.
    expect(s.penalties.cm.totals).toMatchObject({
      totalCm: "561839.00",
      faults: "5108.16",
      rejects: "6370.91",
      cGradeCm: "4594.00",
      deductions: "16073.07",
      paid: "200000.00",
      payable: "345765.93",
    });
    expect(s.penalties.cm.saved?.posted).toBe(true);
    // 30,000 owed before + 5,61,839 CM bills - 2,00,000 advance - 16,073.07 deductions.
    expect(await due(env.owner, env.factory.id)).toBe("375765.93");

    // The overheads, split over the five styles.
    for (const [head, amount] of [
      ["Outsourcing QC", 45_000],
      ["Office Manpower", 60_000],
    ] as const) {
      const rows = await prisma.expense.findMany({
        where: { companyId: env.company.id, head: { name: head } },
        select: { amount: true, projectId: true },
      });
      expect(rows).toHaveLength(5);
      expect(rows.reduce((t, r) => t + Number(r.amount), 0)).toBe(amount);
    }

    // A and B to stock; the money story on the summary.
    const stocked = await prisma.stockBalance.aggregate({
      where: { variant: { styleId: { in: sim.created.styleIds } } },
      _sum: { quantity: true },
    });
    expect(stocked._sum.quantity).toBe(5945);
    expect(s.stock.a + s.stock.b).toBe(5945);
    expect(s.money).toMatchObject({ recovered: "20314.27" });
    expect(Number(s.money.perPiece)).toBeCloseTo(Number(s.money.totalCost) / 5945, 2);

    // The books balance.
    const sums = await prisma.journalLine.aggregate({ _sum: { debit: true, credit: true } });
    expect(sums._sum.debit!.toFixed(2)).toBe(sums._sum.credit!.toFixed(2));

    // A second run waits for the wipe.
    await expect(runFiveStylePolo(env.owner)).rejects.toThrow(/Wipe the earlier simulation first/);

    const figures = await readFiveStylePolo(env.owner, sim);
    expect(figures.dues.map((d) => [d.name, d.before, d.after])).toEqual([
      ["Gazipur Knit Composite", "30000.00", "375765.93"],
      ["Narayanganj Fabric Mills", "0.00", expect.any(String)],
      ["Demo Embo", "0.00", "59686.04"],
      ["Demo Trims House", "0.00", "69760.00"],
      ["Demo Button & Poly", "0.00", "53790.00"],
    ]);
    const wiped = await wipeSimulation(sim);
    expect(wiped).toContain("ProductionBatch: 1");
    expect(wiped).toContain("Party: 3");
    const report = fiveStylePoloReport(sim, figures, wiped);
    if (process.env.FIVE_STYLE_POLO_REPORT) {
      writeFileSync(process.env.FIVE_STYLE_POLO_REPORT, report);
    }
    expect(report).toContain("**Final payable to Gazipur Knit Composite** (CMS-");
    expect(report).toContain("BDT 3,45,765.93");
    // Not a row left, and every row it touched as it was.
    expect(await fingerprint()).toEqual(before);
  });

  it("refuses to wipe, wiping nothing, when real work was added on top", async () => {
    const sim = await runFiveStylePolo(env.owner, { seed: 7 });
    await paySupplier(env.accounts, {
      supplierId: sim.added.embo!.id,
      amount: 1_000,
      method: "CASH",
    });
    const was = await fingerprint();
    await expect(wipeSimulation(sim)).rejects.toThrow(
      /Real work was added to the simulation's records since it ran \(1 payments.*nothing was wiped/,
    );
    expect(await fingerprint()).toEqual(was);
  });

  it("wipes what it had to add on a company with nothing set up yet", async () => {
    await resetDb();
    env = await company({ setUp: false });
    const before = await fingerprint();
    const sim = await runFiveStylePolo(env.owner);
    expect(sim.created.sizeIds).toHaveLength(5);
    expect(sim.created.brandIds).toHaveLength(5);
    await wipeSimulation(sim);
    expect(await fingerprint()).toEqual(before);
    // And it can run again.
    await wipeSimulation(await runFiveStylePolo(env.owner));
    expect(await fingerprint()).toEqual(before);
  });
});
