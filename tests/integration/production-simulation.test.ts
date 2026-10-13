import { writeFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The zero-touch production simulation (tests/simulation/production-simulation.ts)
 * on a company set up like a real one: "Premium Polo Export Q3" goes from the
 * advance to the final CM settlement on the app's own services, every figure it
 * leaves in the books is checked, and the wipe leaves every table exactly as it
 * was before. With SIMULATION_REPORT set to a file path, the Simulation Report
 * is written there (the GitHub workflow shows it on the run's summary).
 */
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import { prisma } from "@/lib/prisma";
import * as bank from "@/modules/accounts/bank.service";
import { paySupplier } from "@/modules/accounts/supplier-payment.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as stock from "@/modules/inventory/stock.service";
import * as parties from "@/modules/parties/party.service";
import * as costs from "@/modules/production/cost.service";
import * as projects from "@/modules/production/project.service";

import {
  readFootprint,
  runSimulation,
  SIMULATION_BATCH,
  simulationReport,
  teardownSimulation,
} from "../simulation/production-simulation";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const ROLES = {
  owner: "SUPER_ADMIN",
  production: "PRODUCTION_MANAGER",
  accounts: "ACCOUNTS",
  store: "WAREHOUSE_TEAM",
} as const;
type Who = keyof typeof ROLES;

/**
 * A company as it stands before the run: its staff, a bank account, a factory
 * with an older CM bill part paid, a fabric mill, and a closed factory that must
 * not be picked. Set up like the live one, it has its store, sizes, the Navy
 * colour and the Lacoste brand already (the run reuses them and leaves them be).
 */
async function company({ setUp = true } = {}) {
  const { company, roles } = await makeCompany("Extas");
  const people = {} as Record<Who, { id: string }>;
  for (const [who, role] of Object.entries(ROLES) as Array<[Who, keyof typeof roles]>) {
    const user = await makeUser(`${who}@extras.test`);
    await addToCompany(user.id, company.id, roles[role]);
    people[who] = user;
  }
  const owner = await contextFor(people.owner.id, company.id);
  const pm = await contextFor(people.production.id, company.id);
  const accounts = await contextFor(people.accounts.id, company.id);
  if (setUp) {
    await stock.createWarehouse(owner, { name: "Main store", isDefault: true });
    for (const name of ["S", "M", "L", "XL"]) await catalog.createSize(owner, { name });
    await catalog.createColor(owner, { name: "Navy", hexCode: "#1F2A44" });
    await catalog.createBrand(owner, { name: "Lacoste" });
  }
  const supplier = async (name: string, category: "CM" | "FABRIC") =>
    (
      await parties.createParty(owner, {
        kind: "SUPPLIER",
        name,
        supplierCategories: [category],
      })
    ).party;
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
  const tee = await projects.createProject(pm, {
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
  await costs.addProjectCost(pm, tee.id, {
    expenseHeadId: sewing.id,
    amount: 50_000,
    paymentType: "DUE",
    supplierId: factory.id,
    date: "2026-08-01",
  });
  await paySupplier(accounts, { supplierId: factory.id, amount: 20_000, method: "CASH" });
  await prisma.notificationLog.deleteMany();
  return { company, owner, factory, mill };
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

run("The zero-touch production simulation", () => {
  let env: Awaited<ReturnType<typeof company>>;

  beforeEach(async () => {
    await resetDb();
    env = await company();
  });

  it("runs Premium Polo Export Q3 end to end, then wipes it without a trace", async () => {
    const before = await fingerprint();
    const sim = await runSimulation(env.owner, { seed: 2026 });
    const f = await readFootprint(env.owner, sim);

    // It picked the company's own active factory, fabric mill and bank account, and
    // reused its store, sizes, colour and brand.
    expect(sim.factory.name).toBe("Gazipur Knit Composite");
    expect(sim.mill.name).toBe("Narayanganj Fabric Mills");
    expect(sim.bankAccount.name).toMatch(/Dutch-Bangla Bank/);
    const batch = await prisma.productionBatch.findUniqueOrThrow({ where: { id: sim.batchId } });
    expect(batch.name).toBe(SIMULATION_BATCH);
    expect(sim.created).toMatchObject({ warehouseIds: [], sizeIds: [], colorIds: [] });
    expect(sim.created.brandIds).toHaveLength(4);

    // Five brands, 1,000 pieces each, a target price of 450-500 a piece.
    expect(sim.styles.map((s) => s.brand)).toEqual([
      "Ralph Lauren",
      "Tommy",
      "CK",
      "Boss",
      "Lacoste",
    ]);
    for (const s of sim.styles) {
      expect(Number(s.targetUnitCost)).toBeGreaterThanOrEqual(450);
      expect(Number(s.targetUnitCost)).toBeLessThanOrEqual(500);
    }
    const made = await prisma.productionProject.findMany({
      where: { batchId: sim.batchId },
      select: { targetQuantity: true, style: { select: { fabric: true } } },
    });
    expect(made.map((p) => [p.targetQuantity, p.style?.fabric])).toEqual(
      Array(5).fill([1000, "95% Cotton, 5% Spandex"]),
    );
    expect(f.styles.map((s) => [s.totals.cut, s.totals.a, s.totals.b, s.totals.c])).toEqual(
      Array(5).fill([1014, 986, 12, 8]),
    );
    expect(f.styles.reduce((t, s) => t + s.totals.reject + s.totals.missing, 0)).toBe(40);
    expect(f.stockPieces).toBe(4990);

    // The advance settled the batch's bills first; last season's bill is as it was.
    expect(
      f.bills.filter((b) => b.supplier === sim.factory.name).map((b) => [b.ref, b.paid, b.status]),
    ).toEqual([
      ["SIM-CM-RL", "95950.00", "PAID"],
      ["SIM-CM-TH", "16713.18", "PARTIALLY_PAID"],
      ["SIM-CM-CK", "0.00", "UNPAID"],
      ["SIM-CM-BS", "0.00", "UNPAID"],
      ["SIM-CM-LC", "0.00", "UNPAID"],
    ]);
    const lastSeason = await prisma.supplierBill.findFirstOrThrow({
      where: { supplierId: env.factory.id, supplierRef: null },
    });
    expect([lastSeason.paidAmount.toFixed(2), lastSeason.status]).toEqual([
      "20000.00",
      "PARTIALLY_PAID",
    ]);

    // The fabric: 1,125 kg billed at 640; the 25 kg short is the mill's fault.
    const fabricBill = f.bills.find((b) => b.supplier === sim.mill.name)!;
    expect([fabricBill.total, fabricBill.status]).toEqual(["720000.00", "UNPAID"]);
    const short = f.faults.filter((x) => x.kind === "SHORT_RECEIVE");
    expect(short).toEqual([
      expect.objectContaining({
        supplier: sim.mill.name,
        quantity: "25",
        amount: "16000.00",
        status: "OPEN",
      }),
    ]);

    // The factory's faults went on the settlement: 6 spoiled and 4 missing a style.
    const spoiled = f.faults.filter((x) => x.kind === "QUALITY");
    expect(spoiled.map((x) => [x.quantity, x.amount, x.status])).toEqual(
      Array(5).fill(["6", "847.06", "DEDUCTED"]),
    );
    const missing = f.faults.filter((x) => x.kind === "MISSING_PIECES");
    expect(missing.map((x) => [x.quantity, x.amount, x.status])).toEqual([
      ["4", "961.72", "DEDUCTED"],
      ["4", "941.48", "DEDUCTED"],
      ["4", "933.40", "DEDUCTED"],
      ["4", "949.56", "DEDUCTED"],
      ["4", "961.72", "DEDUCTED"],
    ]);

    // Total CM - deductions - advance = final payable, and the factory's Supplier Due
    // went up by exactly that.
    expect(f.settlement).toMatchObject({
      totalCm: "464600.00",
      deductions: "12663.18",
      paid: "100000.00",
      payable: "351936.82",
    });
    expect(f.settlement.snapshot.totals).toMatchObject({ faults: "8983.18", cGradeCm: "3680.00" });
    expect(f.due.factory).toEqual({ before: "30000.00", after: "381936.82" });
    expect(f.due.mill).toEqual({ before: "0.00", after: "720000.00" });
    const entry = f.entries.find((e) => e.sourceType === "CM_SETTLEMENT")!;
    expect(entry.number).toBe(f.settlement.entry);
    expect(entry.lines.map((l) => [l.account, l.party, l.debit, l.credit])).toEqual([
      ["2100 Accounts Payable (Suppliers)", sim.factory.name, "12663.18", "0.00"],
      ["4250 Deductions from Suppliers", null, "0.00", "8983.18"],
      ["4250 Deductions from Suppliers", null, "0.00", "3680.00"],
    ]);
    // The books balance.
    const debit = f.accounts.reduce((t, a) => t + Number(a.debit), 0);
    const credit = f.accounts.reduce((t, a) => t + Number(a.credit), 0);
    expect(debit.toFixed(2)).toBe(credit.toFixed(2));

    // The second run waits for the wipe.
    await expect(runSimulation(env.owner)).rejects.toThrow(/Wipe the earlier simulation first/);

    const wiped = await teardownSimulation(sim);
    const report = simulationReport(sim, f, wiped);
    if (process.env.SIMULATION_REPORT) writeFileSync(process.env.SIMULATION_REPORT, report);
    expect(report).toContain("Final payable to Gazipur Knit Composite");

    // Not a row left, and every row it touched as it was.
    expect(await fingerprint()).toEqual(before);
  });

  it("wipes what it had to add on a company with nothing set up yet", async () => {
    await resetDb();
    env = await company({ setUp: false });
    const before = await fingerprint();
    const sim = await runSimulation(env.owner);
    expect(sim.created.warehouseIds).toHaveLength(1);
    expect(sim.created.sizeIds).toHaveLength(4);
    expect(sim.created.brandIds).toHaveLength(5);
    expect((await readFootprint(env.owner, sim)).settlement.payable).toBe("351936.82");
    await teardownSimulation(sim);
    expect(await fingerprint()).toEqual(before);
    // And it can run again.
    await teardownSimulation(await runSimulation(env.owner));
    expect(await fingerprint()).toEqual(before);
  });
});
