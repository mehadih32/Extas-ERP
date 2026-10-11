import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import * as chart from "@/modules/accounts/chart.service";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import * as printing from "@/modules/documents/print.service";
import * as parties from "@/modules/parties/party.service";
import * as challans from "@/modules/production/challan.service";
import * as costs from "@/modules/production/cost.service";
import * as projects from "@/modules/production/project.service";
import * as screens from "@/modules/production/screens.service";
import * as reportScreens from "@/modules/reports/screens.service";

import { pdfLines } from "../fixtures/pdf";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const TZ = "Asia/Dhaka";

/** A calendar day `n` days from today in company time. */
function dayFromToday(n: number) {
  const d = new Date(`${localDay(new Date(), TZ)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * A company with a factory and a fabric mill, a project at the factory, and one
 * person per role: Super Admin, Production Manager, Accounts, Warehouse Team and
 * Sales Executive.
 */
async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const person = async (email: string, roleId: string) => {
    const user = await makeUser(`${email}@extras.test`);
    await addToCompany(user.id, company.id, roleId);
    return contextFor(user.id, company.id);
  };
  const ctx = await person("admin", roles.SUPER_ADMIN);
  const pmCtx = await person("production", roles.PRODUCTION_MANAGER);
  const accountsCtx = await person("accounts", roles.ACCOUNTS);
  const warehouseCtx = await person("warehouse", roles.WAREHOUSE_TEAM);
  const salesCtx = await person("sales", roles.SALES_EXECUTIVE);
  const supplier = async (name: string, extra: Record<string, string> = {}) =>
    (await parties.createParty(ctx, { kind: "SUPPLIER", name, ...extra })).party;
  const factory = await supplier("Gazipur Knit Factory", {
    phone: "01811223344",
    address: "Plot 12, BSCIC Estate",
    city: "Gazipur",
  });
  const mill = await supplier("Narayanganj Fabrics");
  const heads = Object.fromEntries(
    (await costs.listCostHeads(ctx)).map((h) => [h.name, h.id]),
  ) as Record<string, string>;
  const project = await projects.createProject(pmCtx, {
    name: "Classic Polo run",
    factoryId: factory.id,
    targetDate: dayFromToday(30),
    targetQuantity: 1000,
  });
  return {
    ctx,
    pmCtx,
    accountsCtx,
    warehouseCtx,
    salesCtx,
    company,
    factory,
    mill,
    heads,
    project,
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

async function expectInvalid(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ZodError);
}

const OXFORD = { description: "Oxford fabric, navy", quantity: 500, unit: "kg" };
const THREAD = { description: "Sewing thread", quantity: 120, unit: "cones" };

/** How many journal entries and stock movements the company has. */
async function booksAndStock(env: Env) {
  const [entries, movements] = await Promise.all([
    prisma.journalEntry.count({ where: { companyId: env.company.id } }),
    prisma.stockMovement.count({ where: { companyId: env.company.id } }),
  ]);
  return { entries, movements };
}

run("Materials sent to the factory", () => {
  let uploads: string;

  beforeEach(async () => {
    await resetDb();
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-materials-sent-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(uploads, { recursive: true, force: true });
  });

  it("records what went to the factory on numbered challans that move no stock or money", async () => {
    const env = await setup();
    const today = localDay(new Date(), TZ);
    const before = await booksAndStock(env);

    const first = await challans.createMaterialChallan(env.pmCtx, env.project.id, {
      items: [OXFORD, THREAD],
      carrier: "Dhaka Metro-T 11-2345",
    });
    expect(first).toMatchObject({
      number: expect.stringMatching(/^MC-\d{4}-00001$/),
      projectId: env.project.id,
      sentOn: today,
      sentTo: "Gazipur Knit Factory", // the project's factory
      items: [OXFORD, THREAD],
      carrier: "Dhaka Metro-T 11-2345",
      notes: null,
      sentBy: "production",
      cancelled: null,
      project: { code: env.project.code, factory: { name: "Gazipur Knit Factory" } },
    });
    const second = await challans.createMaterialChallan(env.pmCtx, env.project.id, {
      sentOn: dayFromToday(-1),
      sentTo: "Savar washing plant",
      items: [{ description: "Care labels", quantity: 1000.5, unit: "pcs" }],
      notes: "Hand to the floor in-charge.",
    });
    expect(second).toMatchObject({
      number: expect.stringMatching(/^MC-\d{4}-00002$/),
      sentOn: dayFromToday(-1),
      sentTo: "Savar washing plant",
      notes: "Hand to the floor in-charge.",
    });

    // A record only: no stock moved and nothing was booked.
    expect(await booksAndStock(env)).toEqual(before);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "MaterialChallan", entityId: first.id },
    });
    expect(audit.summary).toBe(
      `${first.number} for ${env.project.code} to Gazipur Knit Factory: 500 kg Oxford fabric, navy, 120 cones Sewing thread`,
    );

    // Newest first on the project, for everyone who sees it.
    expect(
      (await challans.listMaterialChallans(env.warehouseCtx, env.project.id)).map((c) => c.id),
    ).toEqual([first.id, second.id]);
    const pm = await screens.getProjectScreen(env.pmCtx, env.project.id);
    expect(pm.materialsSent).toMatchObject({ sentTo: "Gazipur Knit Factory", today });
    expect(pm.materialsSent.challans.map((c) => c.number)).toEqual([first.number, second.number]);
    expect(pm.can).toMatchObject({ sendMaterial: true, cancelChallan: true });
    const store = await screens.getProjectScreen(env.warehouseCtx, env.project.id);
    expect(store.materialsSent.challans).toHaveLength(2);
    expect(store.can).toMatchObject({ sendMaterial: false, cancelChallan: false });
    const accounts = await screens.getProjectScreen(env.accountsCtx, env.project.id);
    expect(accounts.can).toMatchObject({ sendMaterial: false, cancelChallan: false });

    // Refused: a day after today, nothing on it, a quantity too fine, an unknown project.
    const later = await expectAppError(
      challans.createMaterialChallan(env.pmCtx, env.project.id, {
        sentOn: dayFromToday(1),
        items: [OXFORD],
      }),
      "VALIDATION",
    );
    expect(later.message).toBe("It cannot be sent after today.");
    await expectInvalid(challans.createMaterialChallan(env.pmCtx, env.project.id, { items: [] }));
    await expectInvalid(
      challans.createMaterialChallan(env.pmCtx, env.project.id, {
        items: [{ ...OXFORD, quantity: 0.0001 }],
      }),
    );
    await expectInvalid(
      challans.createMaterialChallan(env.pmCtx, env.project.id, {
        items: [{ ...OXFORD, quantity: 0 }],
      }),
    );
    await expectAppError(
      challans.createMaterialChallan(env.pmCtx, "missing", { items: [OXFORD] }),
      "NOT_FOUND",
    );

    // A project with no factory named says where it went, or is refused.
    const loose = await projects.createProject(env.pmCtx, {
      name: "Sample run",
      targetDate: dayFromToday(10),
      targetQuantity: 20,
    });
    const nowhere = await expectAppError(
      challans.createMaterialChallan(env.pmCtx, loose.id, { items: [OXFORD] }),
      "VALIDATION",
    );
    expect(nowhere.message).toBe("Say where the materials went.");
    expect(
      (
        await challans.createMaterialChallan(env.pmCtx, loose.id, {
          sentTo: "Mirpur sample room",
          items: [OXFORD],
        })
      ).number,
    ).toMatch(/^MC-\d{4}-00003$/);

    // Cancelled with a reason, it stays on the list marked; only once.
    await expectInvalid(challans.cancelMaterialChallan(env.pmCtx, first.id, { reason: "oops" }));
    const cancelled = await challans.cancelMaterialChallan(env.pmCtx, first.id, {
      reason: "Entered on the wrong project",
    });
    expect(cancelled.cancelled).toEqual({ on: today, reason: "Entered on the wrong project" });
    const again = await expectAppError(
      challans.cancelMaterialChallan(env.pmCtx, first.id, { reason: "Entered twice" }),
      "CONFLICT",
    );
    expect(again.message).toBe(`${first.number} is already cancelled.`);
    expect(
      (await challans.listMaterialChallans(env.pmCtx, env.project.id)).map((c) => [
        c.number,
        Boolean(c.cancelled),
      ]),
    ).toEqual([
      [first.number, true],
      [second.number, false],
    ]);

    // Once the project is cancelled nothing more is sent for it; its challans stay.
    await projects.cancelProject(env.pmCtx, env.project.id, { reason: "Buyer dropped the order" });
    const closed = await expectAppError(
      challans.createMaterialChallan(env.pmCtx, env.project.id, { items: [OXFORD] }),
      "CONFLICT",
    );
    expect(closed.message).toBe(`${env.project.code} is cancelled; nothing more is sent for it.`);
    expect((await screens.getProjectScreen(env.pmCtx, env.project.id)).can.sendMaterial).toBe(
      false,
    );
    expect(await challans.listMaterialChallans(env.pmCtx, env.project.id)).toHaveLength(2);
  });

  it("prints a material challan with no prices, stamped once cancelled", async () => {
    const env = await setup();
    await costs.createBill(env.pmCtx, {
      supplierId: env.mill.id,
      paymentType: "DUE",
      allocations: [{ projectId: env.project.id, expenseHeadId: env.heads.Fabric, amount: 98765 }],
    });
    const challan = await challans.createMaterialChallan(env.pmCtx, env.project.id, {
      items: [OXFORD, { description: "Rib collar", quantity: 1250.25, unit: "m" }],
      carrier: "Dhaka Metro-T 11-2345",
      notes: "Fabric for the first 1,000 pieces.",
    });

    // The store prints it (production.view); sales, who do not see production, cannot.
    const printed = await printing.printDocument(env.warehouseCtx, {
      type: "MATERIAL_CHALLAN",
      id: challan.id,
    });
    expect(printed).toMatchObject({
      type: "MATERIAL_CHALLAN",
      typeLabel: "Material challan",
      title: `Material challan ${challan.number}`,
      referenceType: "MaterialChallan",
      referenceId: challan.id,
      party: { id: env.factory.id, name: "Gazipur Knit Factory" },
      downloadable: true,
      reused: false,
    });
    const text = pdfLines(
      (await printing.downloadDocument(env.warehouseCtx, printed.id)).bytes,
    ).join("\n");
    for (const expected of [
      challan.number,
      env.project.code,
      "Classic Polo run",
      "Gazipur Knit Factory",
      "01811223344",
      "Plot 12, BSCIC Estate",
      "Oxford fabric, navy",
      "500",
      "kg",
      "Rib collar",
      "1,250.25",
      "Dhaka Metro-T 11-2345",
      "Fabric for the first 1,000 pieces.",
      "This challan carries no prices.",
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain("98,765");
    expect(text).not.toMatch(/cancelled/i);
    await expectAppError(
      printing.printDocument(env.salesCtx, { type: "MATERIAL_CHALLAN", id: challan.id }),
      "FORBIDDEN",
    );

    // Printed documents link it back to its project.
    const rows = await reportScreens.listDocumentRows(env.ctx, { type: "MATERIAL_CHALLAN" });
    expect(rows.items.map((d) => [d.id, d.source])).toEqual([
      [printed.id, { href: `/production/projects/${env.project.id}`, label: "Open the project" }],
    ]);

    // Unchanged, the kept copy comes back; cancelled, it prints again stamped.
    expect(
      await printing.printDocument(env.ctx, { type: "MATERIAL_CHALLAN", id: challan.id }),
    ).toMatchObject({ id: printed.id, reused: true });
    await challans.cancelMaterialChallan(env.pmCtx, challan.id, { reason: "Sent on another day" });
    const stamped = await printing.printDocument(env.ctx, {
      type: "MATERIAL_CHALLAN",
      id: challan.id,
    });
    expect(stamped.id).not.toBe(printed.id);
    const stampedText = pdfLines((await printing.downloadDocument(env.ctx, stamped.id)).bytes).join(
      "\n",
    );
    expect(stampedText).toMatch(/cancelled/i);
    expect(stampedText).toContain("Sent on another day");
  });

  it("warns before the same bill or cost is entered twice", async () => {
    const env = await setup();
    const bill = (extra: Record<string, unknown>, amount = 5000) =>
      costs.createBill(env.pmCtx, {
        supplierId: env.mill.id,
        paymentType: "DUE",
        allocations: [{ projectId: env.project.id, expenseHeadId: env.heads.Fabric, amount }],
        ...extra,
      });

    // The supplier's same bill number, whatever the amount or the case.
    const first = await bill({ supplierRef: "NF-778" });
    const sameRef = await expectAppError(bill({ supplierRef: " nf-778" }, 4000), "CONFLICT");
    expect(sameRef.message).toMatch(
      new RegExp(
        `^${first.number} from Narayanganj Fabrics already has their bill number NF-778: 5,000.00 on .+\\. Is this the same bill\\?$`,
      ),
    );
    expect(sameRef.details).toEqual({ allowDuplicate: [sameRef.message] });
    await bill({ supplierRef: "NF-779" });
    await bill({ supplierRef: "nf-778", allowDuplicate: true }, 4000);

    // Without a number: the same total from the same supplier within three days.
    const plain = await bill({}, 2400);
    const close = await expectAppError(bill({ billDate: dayFromToday(-2) }, 2400), "CONFLICT");
    expect(close.message).toMatch(
      new RegExp(
        `^${plain.number} from Narayanganj Fabrics is also 2,400.00 on .+\\. Is this the same bill\\?$`,
      ),
    );
    await bill({ billDate: dayFromToday(-6) }, 2400); // further apart
    await costs.createBill(env.pmCtx, {
      supplierId: env.factory.id, // another supplier
      paymentType: "DUE",
      allocations: [{ projectId: env.project.id, expenseHeadId: env.heads.Fabric, amount: 2400 }],
    });
    // A voided bill does not count.
    await costs.voidBill(env.pmCtx, plain.id, { reason: "Entered on the wrong project" });
    await bill({ billDate: dayFromToday(-1) }, 2400);

    // A cost owed to a supplier is a one-line bill, checked the same way.
    const owed = {
      expenseHeadId: env.heads["Sewing (CM)"]!,
      amount: 3000,
      paymentType: "DUE",
      supplierId: env.factory.id,
      supplierRef: "GKF-12",
    };
    await costs.addProjectCost(env.pmCtx, env.project.id, owed);
    await expectAppError(costs.addProjectCost(env.pmCtx, env.project.id, owed), "CONFLICT");

    // Paid now with no supplier: the same project, head and amount on the same day.
    const paid = {
      expenseHeadId: env.heads["Print & Embroidery"]!,
      amount: 500,
      paymentType: "CASH_BANK",
      method: "CASH",
    };
    await costs.addProjectCost(env.accountsCtx, env.project.id, paid);
    const twice = await expectAppError(
      costs.addProjectCost(env.accountsCtx, env.project.id, paid),
      "CONFLICT",
    );
    expect(twice.message).toMatch(
      /^EXP-\d{4}-\d{5} is also 500\.00 for Print & Embroidery on this project, the same day\. Is this the same cost\?$/,
    );
    expect(twice.details?.allowDuplicate).toEqual([twice.message]);
    await costs.addProjectCost(env.accountsCtx, env.project.id, {
      ...paid,
      date: dayFromToday(-1),
    });
    await costs.addProjectCost(env.accountsCtx, env.project.id, {
      ...paid,
      expenseHeadId: env.heads.Wash,
    });
    await costs.addProjectCost(env.accountsCtx, env.project.id, { ...paid, allowDuplicate: true });
    const expenses = await prisma.expense.findMany({
      where: { projectId: env.project.id, headId: paid.expenseHeadId, voidedAt: null },
      orderBy: { createdAt: "asc" },
    });
    expect(expenses).toHaveLength(3);
    // Voided ones do not count.
    for (const e of expenses) {
      await costs.voidProjectCost(env.accountsCtx, e.id, { reason: "Entered by mistake" });
    }
    await costs.addProjectCost(env.accountsCtx, env.project.id, paid);
  });

  it("takes money paid now from the exact cash, bank or wallet account chosen", async () => {
    const env = await setup();
    await ensureControlAccounts(env.company.id);
    const pettyCash = await chart.createAccount(env.ctx, {
      name: "Factory petty cash",
      subType: "CASH",
    });
    const wallet = await chart.createAccount(env.ctx, {
      name: "bKash merchant 017",
      subType: "MOBILE_WALLET",
    });
    const credited = async (accountId: string) =>
      (
        await prisma.journalLine.findMany({
          where: { accountId },
          select: { credit: true },
        })
      ).map((l) => l.credit.toFixed(2));

    // The bill and cost forms offer them to Accounts only (who pay).
    const form = await screens.getBillForm(env.accountsCtx, { projectId: env.project.id });
    expect(form.accounts.map((a) => a.name)).toEqual(
      expect.arrayContaining(["Cash in Hand", "Factory petty cash", "bKash merchant 017"]),
    );
    expect(form.accounts.find((a) => a.id === pettyCash.id)).toMatchObject({ kind: "CASH" });
    expect((await screens.getBillForm(env.pmCtx)).accounts).toEqual([]);

    // A cost paid now.
    await costs.addProjectCost(env.accountsCtx, env.project.id, {
      expenseHeadId: env.heads.Wash,
      amount: 750,
      paymentType: "CASH_BANK",
      method: "CASH",
      accountId: pettyCash.id,
    });
    expect(await credited(pettyCash.id)).toEqual(["750.00"]);

    // A bill paid now.
    await costs.createBill(env.accountsCtx, {
      supplierId: env.mill.id,
      paymentType: "CASH_BANK",
      method: "BKASH",
      accountId: wallet.id,
      allocations: [{ projectId: env.project.id, expenseHeadId: env.heads.Fabric, amount: 1200 }],
    });
    expect(await credited(wallet.id)).toEqual(["1200.00"]);

    // Paying a bill owed.
    const owed = await costs.createBill(env.pmCtx, {
      supplierId: env.factory.id,
      paymentType: "DUE",
      allocations: [
        { projectId: env.project.id, expenseHeadId: env.heads["Sewing (CM)"]!, amount: 4000 },
      ],
    });
    const billScreen = await screens.getBillScreen(env.accountsCtx, owed.id);
    expect(billScreen.can.pay).toBe(true);
    expect(billScreen.accounts.map((a) => a.id)).toContain(pettyCash.id);
    expect((await screens.getBillScreen(env.pmCtx, owed.id)).accounts).toEqual([]);
    await costs.payBill(env.accountsCtx, owed.id, {
      amount: 1500,
      method: "CASH",
      accountId: pettyCash.id,
    });
    expect((await credited(pettyCash.id)).sort()).toEqual(["1500.00", "750.00"]);

    // Only a cash, bank or wallet account.
    const wip = await prisma.ledgerAccount.findFirstOrThrow({
      where: { companyId: env.company.id, code: "1350" },
    });
    const wrong = await expectAppError(
      costs.addProjectCost(env.accountsCtx, env.project.id, {
        expenseHeadId: env.heads.Cutting,
        amount: 100,
        paymentType: "CASH_BANK",
        method: "CASH",
        accountId: wip.id,
      }),
      "VALIDATION",
    );
    expect(wrong.message).toBe("Choose a cash, bank or mobile wallet account.");
  });

  it("shows the ledger accounts production costs are booked to", async () => {
    const env = await setup();
    const heads = await screens.getCostHeadsScreen(env.pmCtx);
    expect(heads.books).toMatchObject({
      cost: { code: "1350", name: "Work in Progress (Production)" },
      owed: { code: "2100", name: "Accounts Payable (Suppliers)" },
      delivered: { code: "1300", name: "Finished Goods Inventory" },
      canOpen: false,
    });
    expect((await screens.getCostHeadsScreen(env.accountsCtx)).books.canOpen).toBe(true);

    // And every cost under a head is booked there.
    const bill = await costs.createBill(env.pmCtx, {
      supplierId: env.mill.id,
      paymentType: "DUE",
      allocations: [{ projectId: env.project.id, expenseHeadId: env.heads.Wash, amount: 640 }],
    });
    const lines = await prisma.journalLine.findMany({
      where: { entry: { sourceType: "SUPPLIER_BILL", sourceId: bill.id } },
      select: { debit: true, credit: true, account: { select: { code: true } } },
    });
    expect(
      lines.map((l) => [l.account.code, l.debit.toFixed(2), l.credit.toFixed(2)]).sort(),
    ).toEqual([
      ["1350", "640.00", "0.00"],
      ["2100", "0.00", "640.00"],
    ]);
  });
});
