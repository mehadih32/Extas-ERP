import { Prisma } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/*
 * Bug Guard's data and accounts checks (v6.4 part C, the owner's 2b): a whole
 * company made through the ERP's own services (sales, refunds, returns, a
 * proforma's advance, a walk-in sale, materials bought, paid, returned and
 * issued, a factory delivery, a booking, expenses, a CM settlement, payroll and
 * an advance) gives no findings at all. Then each thing is broken with a direct
 * write: the right finding comes (key, severity, screen, evidence, plan); a
 * plan, applied as the owner's correction would apply it, makes the check clean
 * and the books still balance; undone, the finding is back. Every check runs
 * inside readOnly(), so none can write.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import { accountsHref } from "@/components/accounts/labels";
import { hrHref } from "@/components/hr/labels";
import { materialsHref } from "@/components/materials/labels";
import { partyHref } from "@/components/parties/labels";
import { productionHref } from "@/components/production/labels";
import { salesHref } from "@/components/sales/labels";
import { localDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { readOnly } from "@/lib/read-only";
import { runTransaction } from "@/lib/transaction";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { reverseJournalEntry } from "@/modules/accounts/journal.service";
import * as supplierPayments from "@/modules/accounts/supplier-payment.service";
import { settleSupplierBills } from "@/modules/accounts/supplier-settlement";
import { setPin } from "@/modules/ai/settings.service";
import type { CompanyContext } from "@/modules/auth/context";
import { DATA_CHECKS } from "@/modules/bug-guard/checks/data";
import { applyPlan, describePlan, undoPlan } from "@/modules/bug-guard/corrections";
import {
  applyCorrection,
  processCorrections,
  undoCorrection,
} from "@/modules/bug-guard/fixes.service";
import type { CheckContext, Found } from "@/modules/bug-guard/types";
import * as expenses from "@/modules/expenses/expense.service";
import * as advances from "@/modules/hr/advance.service";
import * as employees from "@/modules/hr/employee.service";
import * as payroll from "@/modules/hr/payroll.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as issues from "@/modules/materials/issue.service";
import * as materials from "@/modules/materials/material.service";
import * as purchaseOrders from "@/modules/materials/purchase-order.service";
import * as purchases from "@/modules/materials/purchase.service";
import * as supplierReturns from "@/modules/materials/supplier-return.service";
import * as ledger from "@/modules/parties/ledger.service";
import * as parties from "@/modules/parties/party.service";
import * as batchMoney from "@/modules/production/batch-money.service";
import * as batches from "@/modules/production/batch.service";
import * as bookings from "@/modules/production/booking.service";
import * as costs from "@/modules/production/cost.service";
import * as cutting from "@/modules/production/cutting.service";
import * as faults from "@/modules/production/fault.service";
import * as finishing from "@/modules/production/finishing.service";
import * as intakes from "@/modules/production/intake.service";
import * as projects from "@/modules/production/project.service";
import * as documents from "@/modules/sales/documents.service";
import * as orders from "@/modules/sales/order.service";
import * as payments from "@/modules/sales/payment.service";
import * as proformas from "@/modules/sales/proforma.service";
import * as quotations from "@/modules/sales/quotation.service";
import * as refunds from "@/modules/sales/refund.service";
import * as salesReturns from "@/modules/sales/return.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const TZ = "Asia/Dhaka";

/** A calendar day `n` days from today in company time, e.g. "2026-10-26". */
function dayFromToday(n: number) {
  const d = new Date(`${localDay(new Date(), TZ)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Last month, e.g. "2026-09". */
function lastMonth() {
  const d = new Date(`${localDay(new Date(), TZ)}T00:00:00Z`);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

/** The company, made through the ERP's own services. */
async function world() {
  const { company, roles } = await makeCompany("Extas");
  const member = async (role: keyof typeof roles, who: string) => {
    const user = await makeUser(`${who}@${company.slug}.test`);
    await addToCompany(user.id, company.id, roles[role]);
    return { user, ctx: await contextFor(user.id, company.id) };
  };
  const owner = await member("SUPER_ADMIN", "owner");
  const pm = (await member("PRODUCTION_MANAGER", "production")).ctx;
  const accounts = (await member("ACCOUNTS", "accounts")).ctx;
  const store = (await member("WAREHOUSE_TEAM", "store")).ctx;
  const sales = (await member("SALES_EXECUTIVE", "sales")).ctx;
  const admin = owner.ctx;
  const acc = await ensureControlAccounts(company.id);

  // A polo in Navy S and M, 50 of each at cost 500.
  const small = await catalog.createSize(admin, { name: "S" });
  const medium = await catalog.createSize(admin, { name: "M" });
  const navy = await catalog.createColor(admin, { name: "Navy", hexCode: "#1f2a44" });
  const tops = await catalog.createCategory(admin, { name: "Tops" });
  const style = await styles.createStyle(admin, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    retailPrice: 1450,
    wholesalePrice: 900,
  });
  await matrix.generateMatrix(admin, style.id, {
    colorIds: [navy.id],
    sizeIds: [small.id, medium.id],
  });
  const variants = await prisma.productVariant.findMany({
    where: { styleId: style.id },
    include: { size: true },
  });
  const sku = (size: string) => variants.find((v) => v.size.name === size)!.id;
  for (const v of variants) {
    await stock.adjustStock(admin, {
      variantId: v.id,
      quantity: 50,
      type: "OPENING",
      unitCost: 500,
    });
  }

  const party = async (kind: "BUYER" | "SUPPLIER", name: string, phone?: string) =>
    (await parties.createParty(admin, { kind, name, phone })).party;
  const buyer = await party("BUYER", "Rahim Traders", "01711223344");
  const shop = await party("BUYER", "Karim Fashions", "01811223344");
  const mill = await party("SUPPLIER", "Narayanganj Fabrics");
  const factory = await party("SUPPLIER", "Gazipur Knit Factory");
  // Owed to the mill from before the ERP.
  await ledger.setOpeningBalance(admin, mill.id, { amount: -5000 });

  // Sales: an invoiced order with discount, delivery and VAT, part paid, delivered,
  // one piece back; an order with an advance, part of it paid back; a walk-in sale;
  // a quotation made a proforma with its advance.
  const order = await orders.createOrder(sales, {
    channel: "WHOLESALE",
    partyId: buyer.id,
    lines: [
      { variantId: sku("S"), quantity: 10 },
      { variantId: sku("M"), quantity: 2 },
    ],
    discount: 800,
    shippingCharge: 200,
    tax: 500,
  });
  const { payment } = await payments.receivePayment(accounts, {
    orderId: order.id,
    amount: 5000,
    method: "CASH",
  });
  await documents.createDeliveryChallan(admin, order.id);
  const invoice = (await orders.getOrder(admin, order.id)).invoice!;
  const orderLine = await prisma.salesOrderItem.findFirstOrThrow({
    where: { orderId: order.id, variantId: sku("S") },
  });
  const salesReturn = await salesReturns.createSalesReturn(accounts, {
    invoiceId: invoice.id,
    items: [{ orderItemId: orderLine.id, quantity: 1 }],
    reason: "Size problem",
  });
  const advanceOrder = await orders.createOrder(sales, {
    channel: "WHOLESALE",
    partyId: shop.id,
    lines: [{ variantId: sku("M"), quantity: 5 }],
    documents: { invoice: false },
  });
  await payments.receivePayment(accounts, {
    orderId: advanceOrder.id,
    amount: 2000,
    method: "BKASH",
  });
  await refunds.refundBuyer(accounts, {
    orderId: advanceOrder.id,
    kind: "CASH",
    method: "BKASH",
    amount: 500,
    reason: "Fewer pieces agreed",
  });
  await orders.createOrder(admin, {
    channel: "POS",
    customerName: "Walk-in buyer",
    lines: [{ variantId: sku("M"), quantity: 2 }],
    payment: { amount: 2900, method: "CASH" },
  });
  const quotation = await quotations.createQuotation(admin, {
    partyId: buyer.id,
    items: [
      {
        categoryId: tops.id,
        styleId: style.id,
        description: "Polo pre-order",
        sizeBreakdown: { S: 6, M: 6 },
        unitPrice: 1000,
      },
    ],
  });
  const proforma = await proformas.convertQuotationToProforma(admin, quotation.id);
  await payments.receivePayment(accounts, {
    proformaId: proforma.id,
    amount: 3600,
    method: "CASH",
  });

  // Materials: ordered for a style, billed on credit, paid in part, some sent back,
  // some issued to the floor; the style's delivery comes in; a booking.
  const fabric = await materials.createMaterial(pm, {
    name: "Single Jersey 180 GSM",
    kind: "FABRIC",
    unit: "KG",
    supplierId: mill.id,
  });
  const project = await projects.createProject(pm, {
    name: "Classic Polo run",
    styleId: style.id,
    targetDate: dayFromToday(30),
    targetQuantity: 100,
  });
  const po = await purchaseOrders.createPurchaseOrder(pm, {
    supplierId: mill.id,
    projectId: project.id,
    expectedDate: dayFromToday(10),
    lines: [{ materialId: fabric.id, quantity: 200, unitPrice: 175.5 }],
  });
  const bill = await purchases.createPurchase(pm, {
    purchaseOrderId: po.id,
    supplierRef: "NF-7781",
    paymentType: "DUE",
    items: [{ purchaseOrderLineId: po.lines[0]!.id, quantity: 150 }],
  });
  await supplierPayments.paySupplier(accounts, {
    supplierId: mill.id,
    amount: 10000,
    method: "CASH",
  });
  const billItem = await prisma.supplierBillItem.findFirstOrThrow({ where: { billId: bill.id } });
  await supplierReturns.createSupplierReturn(pm, {
    billId: bill.id,
    reason: "Shade variation",
    lines: [{ billItemId: billItem.id, quantity: 10 }],
  });
  await issues.issueToProduction(store, {
    projectId: project.id,
    receivedBy: "Karim (cutting master)",
    lines: [{ materialId: fabric.id, quantity: 100 }],
  });
  const delivery = await intakes.createIntake(pm, {
    projectId: project.id,
    lines: [{ variantId: sku("S"), quantity: 40 }],
  });
  await intakes.confirmIntake(pm, delivery.id, { finalDelivery: true });
  const booking = await bookings.createBooking(pm, {
    source: "SUPPLIER_PO",
    category: "KNITWEAR",
    supplierId: mill.id,
    lines: [{ materialId: fabric.id, quantity: 50, unitPrice: 180 }],
  });

  // Expenses: one paid, one voided, one claim waiting for Accounts.
  await expenses.ensureGeneralExpenseHeads(company.id);
  const heads = Object.fromEntries(
    (await expenses.listExpenseHeads(admin)).map((h: { name: string; id: string }) => [
      h.name,
      h.id,
    ]),
  ) as Record<string, string>;
  const rent = await expenses.createExpense(accounts, {
    headId: heads["Office Rent"],
    amount: 12000,
    paymentType: "CASH_BANK",
    method: "CASH",
  });
  const mistake = await expenses.createExpense(accounts, {
    headId: heads["Office Supplies"],
    amount: 450,
    paymentType: "CASH_BANK",
    method: "CASH",
  });
  await expenses.voidExpense(admin, mistake.id, { reason: "Entered twice" });
  await expenses.createExpense(pm, {
    headId: heads["Office Supplies"],
    amount: 300,
    paymentType: "CASH_BANK",
  });

  // Production: a batch at the factory, a CM bill, the count, a fault and the CM settled.
  const batch = await batches.createBatch(pm, {
    name: "Winter 2030",
    factoryId: factory.id,
    targetDate: "2030-12-20",
  });
  const polo = await projects.createProject(pm, {
    name: "Brand A polo",
    batchId: batch.id,
    factoryId: factory.id,
    targetDate: "2030-12-20",
    targets: [
      { variantId: sku("S"), quantity: 10 },
      { variantId: sku("M"), quantity: 10 },
    ],
  });
  await costs.ensureProductionCostHeads(company.id);
  const sewing = await prisma.expenseHead.findFirstOrThrow({
    where: { companyId: company.id, name: "Sewing (CM)" },
  });
  await costs.addProjectCost(pm, polo.id, {
    expenseHeadId: sewing.id,
    amount: 1800,
    paymentType: "DUE",
    supplierId: factory.id,
  });
  await cutting.createCuttingReport(pm, polo.id, {
    lines: [
      { colorName: "Navy", sizeName: "S", quantity: 10 },
      { colorName: "Navy", sizeName: "M", quantity: 10 },
    ],
  });
  // The CM agreed with the factory (set on the style as the contract does).
  await prisma.productionProject.update({ where: { id: polo.id }, data: { cmRate: 90 } });
  await finishing.createFinishingCount(store, polo.id, {
    lines: [
      { colorName: "Navy", sizeName: "S", a: 7, b: 1, c: 1, reject: 0 },
      { colorName: "Navy", sizeName: "M", a: 9, b: 0, c: 0, reject: 1 },
    ],
  });
  await finishing.receivePackingList(pm, polo.id, {
    missing: [{ colorName: "Navy", sizeName: "S", quantity: 1 }],
  });
  await faults.createFault(pm, {
    supplierId: factory.id,
    kind: "FABRIC_FAULT",
    projectId: polo.id,
    amount: 100,
    note: "Holes in two panels",
  });
  const settlement = await batchMoney.settleCm(pm, batch.id, { deductCGrade: false });

  // HR: last month's salaries approved, one paid in full and one in part; an advance.
  const rahim = await employees.createEmployee(admin, {
    name: "Rahim Uddin",
    joinDate: "2025-01-01",
    salary: 30000,
  });
  const karim = await employees.createEmployee(admin, {
    name: "Karim Mia",
    joinDate: "2025-01-01",
    salary: 20000,
  });
  const salaries = await payroll.createPayrollRun(admin, { month: lastMonth() });
  await payroll.approvePayrollRun(admin, salaries.id);
  const itemOf = (employeeId: string) =>
    prisma.payrollItem.findFirstOrThrow({ where: { runId: salaries.id, employeeId } });
  await payroll.payPayrollRun(accounts, salaries.id, {
    itemIds: [(await itemOf(rahim.id)).id],
    method: "CASH",
  });
  await payroll.payPayrollRun(accounts, salaries.id, {
    parts: [{ itemId: (await itemOf(karim.id)).id, amount: 5000 }],
    method: "CASH",
  });
  const advance = await advances.giveAdvance(accounts, {
    employeeId: rahim.id,
    amount: 3000,
    installmentAmount: 1000,
    recoverFrom: dayFromToday(40).slice(0, 7),
  });

  // Another company, to keep apart.
  const other = await makeCompany("Other Co");
  const otherAdmin = await makeUser("admin@other-co.test");
  await addToCompany(otherAdmin.id, other.company.id, other.roles.SUPER_ADMIN);
  const otherCtx = await contextFor(otherAdmin.id, other.company.id);
  const stranger = (
    await parties.createParty(otherCtx, {
      kind: "BUYER",
      name: "Stranger Ltd",
      phone: "01911223344",
    })
  ).party;

  return {
    company,
    roles,
    owner: owner.user,
    accounts,
    acc,
    style,
    sku,
    buyer,
    shop,
    mill,
    factory,
    order,
    payment,
    invoice,
    salesReturn,
    advanceOrder,
    quotation,
    proforma,
    fabric,
    project,
    po,
    bill,
    delivery,
    booking,
    rent,
    batch,
    polo,
    settlement,
    rahim,
    karim,
    salaries,
    advance,
    other: other.company,
    stranger,
  };
}

type World = Awaited<ReturnType<typeof world>>;

const WEEK = 7 * 24 * 60 * 60 * 1000;

const contextOf = (companyId: string): CheckContext => ({
  companyId,
  now: new Date(),
  since: new Date(Date.now() - WEEK),
  platform: false,
  db: prisma,
});

/** Runs the data checks (all, or those named) as Bug Guard runs them: only reading. */
async function runChecks(companyId: string, keys?: string[]) {
  const ran = await readOnly("Bug Guard only reads", async () => {
    const ctx = contextOf(companyId);
    const out: Array<{ key: string; ms: number; found: Found[] }> = [];
    for (const check of DATA_CHECKS) {
      if (keys && !keys.includes(check.key)) continue;
      const start = performance.now();
      const found = await check.run(ctx);
      out.push({ key: check.key, ms: performance.now() - start, found });
    }
    return out;
  });
  const found = ran.flatMap((r) => r.found);
  // One finding per problem: keys never repeat.
  expect(new Set(found.map((f) => f.key)).size).toBe(found.length);
  for (const f of found) {
    expect(f.area).toBe("DATA");
    expect(f.key.startsWith(`${f.key.split(":")[0]}:`)).toBe(true);
  }
  return { ran, found };
}

const checkOf = (key: string) => key.slice(0, key.indexOf(":"));

run("Bug Guard data and accounts checks", () => {
  let w: World;

  /** What one check finds now. */
  const only = async (checkKey: string, companyId = w.company.id) =>
    (await runChecks(companyId, [checkKey])).found;

  /** The one finding with this key. */
  const theFinding = async (key: string) => {
    const found = await only(checkOf(key));
    const finding = found.find((f) => f.key === key);
    expect(finding, `expected ${key} among ${found.map((f) => f.key).join(", ")}`).toBeDefined();
    return finding!;
  };

  /**
   * Keeps a finding and prepares its correction, as the owner's Bug Guard screen
   * does: an adjusting entry is posted for that correction (correctedKeys reads it).
   */
  const prepare = async (f: Found) => {
    const finding = await prisma.bugGuardFinding.upsert({
      where: { companyId_key: { companyId: w.company.id, key: f.key } },
      update: {},
      create: {
        companyId: w.company.id,
        key: f.key,
        check: checkOf(f.key),
        area: f.area,
        severity: f.severity,
        title: f.title,
        href: f.href ?? null,
        place: f.place ?? null,
        why: f.why,
        fix: f.fix,
        fixKind: f.fixKind,
        evidence: f.evidence as Prisma.InputJsonValue,
        correction: f.correction as unknown as Prisma.InputJsonValue,
      },
    });
    return prisma.bugGuardCorrection.create({
      data: {
        companyId: w.company.id,
        findingId: finding.id,
        plan: f.correction as unknown as Prisma.InputJsonValue,
        summary: describePlan(f.correction!),
      },
    });
  };

  /**
   * Applies the finding's plan as the owner's correction: its check is then clean
   * (and an adjusting entry leaves every entry and the trial balance balanced);
   * undone, the finding is back.
   */
  const correctAndUndo = async (f: Found) => {
    expect(f.fixKind).toBe("DATA");
    const plan = f.correction!;
    const correctionId = (await prepare(f)).id;
    const applied = await prisma.$transaction((tx) =>
      applyPlan(tx, w.company.id, plan, { userId: w.owner.id, correctionId }),
    );
    expect(await only(checkOf(f.key))).toEqual([]);
    if (plan.kind === "JOURNAL") {
      expect(applied.journalEntryId).not.toBeNull();
      expect(await only("data.ledger.entries")).toEqual([]);
      expect(await only("data.ledger.trial")).toEqual([]);
    }
    await prisma.$transaction((tx) =>
      undoPlan(tx, w.company.id, plan, applied, { userId: w.owner.id, correctionId }),
    );
    expect((await only(checkOf(f.key))).map((x) => x.key)).toContain(f.key);
    if (plan.kind === "JOURNAL") expect(await only("data.ledger.trial")).toEqual([]);
    return correctionId;
  };

  /** A stored total Bug Guard never sets (v6.4.1 B4): the owner's, with the steps. */
  const leftToOwner = (f: Found) => {
    expect(f).toMatchObject({ fixKind: "MANUAL", correction: null });
    expect(f.fix).toContain("Bug Guard কোনো লেখা অঙ্ক বদলায় না");
  };

  const evidence = (f: Found) =>
    Object.fromEntries((f.evidence ?? []).map((e) => [e.label, e.value]));

  beforeAll(async () => {
    await resetDb();
    w = await world();
  }, 120_000);

  // Every test puts back what it broke: the company is clean again after each one.
  afterEach(async () => {
    expect((await runChecks(w.company.id)).found.map((f) => `${f.key} ${f.title}`)).toEqual([]);
  });

  it("finds nothing in a company made through the ERP, each check under 2 seconds", async () => {
    const { ran, found } = await runChecks(w.company.id);
    expect(ran.map((r) => r.key)).toEqual(DATA_CHECKS.map((c) => c.key));
    expect(found.map((f) => `${f.key} ${f.title}`)).toEqual([]);
    for (const r of ran) expect(r.ms, r.key).toBeLessThan(2000);
    // The other company too.
    expect((await runChecks(w.other.id)).found).toEqual([]);
    // Check keys and words: "data.<check>", English labels, every check its own key.
    expect(new Set(DATA_CHECKS.map((c) => c.key)).size).toBe(DATA_CHECKS.length);
    for (const c of DATA_CHECKS) {
      expect(c.key).toMatch(/^data\.[a-z]+\.[a-z]+$/);
      expect(c.area).toBe("DATA");
      expect(c.label).toMatch(/^[A-Z][A-Za-z ,'-]+$/);
    }
  });

  // ---------------------------------------------------------------------------
  // The books
  // ---------------------------------------------------------------------------

  it("finds an entry that does not balance, and the trial balance with it", async () => {
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { companyId: w.company.id, sourceType: "EXPENSE", sourceId: w.rent.id },
      include: { lines: { orderBy: { debit: "desc" } } },
    });
    const line = entry.lines[0]!;
    await prisma.journalLine.update({
      where: { id: line.id },
      data: { debit: line.debit.plus(1) },
    });
    try {
      const f = await theFinding(`data.ledger.entries:${entry.id}`);
      expect(f).toMatchObject({
        severity: "URGENT",
        href: accountsHref.entry(entry.id),
        place: entry.number,
        fixKind: "MANUAL",
        correction: null,
      });
      expect(evidence(f)).toMatchObject({ "মোট ডেবিট": "12,001.00", "মোট ক্রেডিট": "12,000.00" });
      const trial = await theFinding(`data.ledger.trial:${w.company.id}`);
      expect(trial).toMatchObject({
        severity: "URGENT",
        href: "/accounts/reports/trial-balance",
        fixKind: "MANUAL",
      });
      expect(evidence(trial)).toMatchObject({ পার্থক্য: "1.00", "না-মেলা এন্ট্রি": "1" });
    } finally {
      await prisma.journalLine.update({ where: { id: line.id }, data: { debit: line.debit } });
    }
  });

  it("reverses an entry that shows as reversed but has no reversal, with an adjusting entry", async () => {
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { companyId: w.company.id, sourceType: "OPENING_BALANCE", sourceId: w.mill.id },
    });
    await prisma.journalEntry.update({ where: { id: entry.id }, data: { isReversed: true } });
    try {
      const f = await theFinding(`data.ledger.reversals:${entry.id}`);
      expect(f).toMatchObject({
        severity: "URGENT",
        href: accountsHref.entry(entry.id),
        place: entry.number,
        fixKind: "DATA",
      });
      expect(evidence(f)).toMatchObject({ এন্ট্রি: entry.number, "উল্টো এন্ট্রি": "নেই" });
      // The mirror image of the entry: Dr Accounts Payable (the mill), Cr Opening Balance Equity.
      expect(f.correction).toMatchObject({
        kind: "JOURNAL",
        date: localDay(new Date(), TZ),
        lines: expect.arrayContaining([
          expect.objectContaining({
            accountId: w.acc.PAYABLE,
            partyId: w.mill.id,
            debit: "5000.00",
            credit: "0.00",
          }),
          expect.objectContaining({
            accountId: w.acc.OPENING_EQUITY,
            debit: "0.00",
            credit: "5000.00",
          }),
        ]),
      });
      await correctAndUndo(f);
    } finally {
      await prisma.journalEntry.update({ where: { id: entry.id }, data: { isReversed: false } });
      // The correction settled the mill's bills on their Payable (S6): settled again the ERP's way.
      await runTransaction((tx) => settleSupplierBills(tx, w.company.id, w.mill.id));
    }
  });

  it("finds a buyer's line that names no buyer", async () => {
    const line = await prisma.journalLine.findFirstOrThrow({
      where: {
        accountId: w.acc.RECEIVABLE,
        partyId: w.buyer.id,
        entry: { sourceType: "SALE", sourceId: w.invoice.id },
      },
      include: { entry: true },
    });
    await prisma.journalLine.update({ where: { id: line.id }, data: { partyId: null } });
    try {
      const f = await theFinding(`data.ledger.named:${line.entryId}`);
      expect(f).toMatchObject({
        severity: "IMPORTANT",
        href: accountsHref.entry(line.entryId),
        place: line.entry.number,
        fixKind: "MANUAL",
      });
      expect(evidence(f)).toMatchObject({ "নামহীন লাইন": "1" });
    } finally {
      await prisma.journalLine.update({ where: { id: line.id }, data: { partyId: w.buyer.id } });
    }
  });

  it("finds an opening balance that is not what its entry says", async () => {
    await prisma.party.update({ where: { id: w.mill.id }, data: { openingBalance: -4000 } });
    try {
      const f = await theFinding(`data.ledger.openings:${w.mill.id}`);
      expect(f).toMatchObject({
        severity: "IMPORTANT",
        href: partyHref({ id: w.mill.id, kind: "SUPPLIER" }),
        fixKind: "MANUAL",
      });
      expect(evidence(f)).toMatchObject({
        "প্রোফাইলে লেখা": "-4,000.00",
        "খাতার শুরুর এন্ট্রিতে": "-5,000.00",
      });
    } finally {
      await prisma.party.update({ where: { id: w.mill.id }, data: { openingBalance: -5000 } });
    }
  });

  // ---------------------------------------------------------------------------
  // Documents in the books
  // ---------------------------------------------------------------------------

  it("posts a buyer's payment that has no entry as the entry the ERP would have made", async () => {
    const number = "PAY-TEST-0001";
    const lost = await prisma.payment.create({
      data: {
        companyId: w.company.id,
        number,
        direction: "RECEIVED",
        method: "CASH",
        partyId: w.shop.id,
        amount: 750,
        accountId: w.acc.CASH,
        isAdvance: true,
        reference: "lost-entry",
      },
    });
    try {
      const f = await theFinding(`data.posting.sales:${lost.id}`);
      expect(f).toMatchObject({
        severity: "URGENT",
        href: salesHref.payment(lost.id),
        place: number,
        fixKind: "DATA",
      });
      expect(evidence(f)).toMatchObject({
        পেমেন্ট: number,
        টাকা: "750.00",
        "জার্নাল এন্ট্রি": "নেই",
      });
      expect(f.correction).toMatchObject({
        kind: "JOURNAL",
        lines: [
          { accountId: w.acc.CASH, debit: "750.00", credit: "0.00" },
          {
            accountId: w.acc.CUSTOMER_ADVANCE,
            partyId: w.shop.id,
            debit: "0.00",
            credit: "750.00",
          },
        ],
      });
      await correctAndUndo(f);
    } finally {
      await prisma.payment.delete({ where: { id: lost.id } });
    }
  });

  it("reverses the live entry of a voided expense", async () => {
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { companyId: w.company.id, sourceType: "EXPENSE", sourceId: w.rent.id },
    });
    await prisma.expense.update({ where: { id: w.rent.id }, data: { voidedAt: new Date() } });
    try {
      const f = await theFinding(`data.posting.purchases:${w.rent.id}`);
      expect(f).toMatchObject({
        severity: "URGENT",
        href: accountsHref.expense(w.rent.id),
        fixKind: "DATA",
      });
      expect(evidence(f)).toMatchObject({
        "জার্নাল এন্ট্রি": entry.number,
        "কাগজের টাকা": "12,000.00",
      });
      expect(f.correction).toMatchObject({
        kind: "JOURNAL",
        lines: expect.arrayContaining([
          expect.objectContaining({ accountId: w.acc.CASH, debit: "12000.00", credit: "0.00" }),
        ]),
      });
      await correctAndUndo(f);
    } finally {
      await prisma.expense.update({ where: { id: w.rent.id }, data: { voidedAt: null } });
    }
  });

  it("finds a draft payroll whose approval entry is still live", async () => {
    const before = await prisma.payrollRun.findUniqueOrThrow({ where: { id: w.salaries.id } });
    await prisma.payrollRun.update({ where: { id: w.salaries.id }, data: { status: "DRAFT" } });
    try {
      const f = await theFinding(`data.posting.hr:${w.salaries.id}`);
      expect(f).toMatchObject({
        severity: "URGENT",
        href: hrHref.payrollRun(w.salaries.id),
        place: `Payroll ${lastMonth()}`,
        fixKind: "MANUAL",
      });
      expect(evidence(f)).toMatchObject({ মাস: lastMonth(), অবস্থা: "Draft" });
    } finally {
      await prisma.payrollRun.update({
        where: { id: w.salaries.id },
        data: { status: before.status },
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Stock
  // ---------------------------------------------------------------------------

  it("records a stock balance's difference from its movements as a movement, never changing the stock (v6.4.1 B4)", async () => {
    const balance = await prisma.stockBalance.findFirstOrThrow({
      where: { companyId: w.company.id, variantId: w.sku("M"), grade: "A_GRADE" },
      include: { variant: true, warehouse: true },
    });
    await prisma.stockBalance.update({
      where: { id: balance.id },
      data: { quantity: balance.quantity + 3 },
    });
    const ours = (correctionId: string) =>
      prisma.stockMovement.findMany({
        where: { referenceType: "BugGuardCorrection", referenceId: correctionId },
        orderBy: { createdAt: "asc" },
        select: { type: true, quantity: true, unitCost: true, createdById: true, note: true },
      });
    try {
      const f = await theFinding(`data.stock.balance:${balance.id}`);
      expect(f).toMatchObject({
        severity: "IMPORTANT",
        href: `/products/${w.style.id}`,
        fixKind: "DATA",
      });
      expect(evidence(f)).toMatchObject({
        SKU: balance.variant.sku,
        গুদাম: balance.warehouse.name,
        "স্টকে লেখা": String(balance.quantity + 3),
        "আসা-যাওয়ার যোগফল": String(balance.quantity),
      });
      expect(f.correction).toEqual({
        kind: "STOCK",
        balanceId: balance.id,
        variantId: balance.variantId,
        warehouseId: balance.warehouseId,
        grade: "A_GRADE",
        stored: balance.quantity + 3,
        moved: balance.quantity,
        label: expect.stringContaining(balance.variant.sku),
      });
      expect(describePlan(f.correction!)).toContain("+3 পিস");
      const correctionId = await correctAndUndo(f);
      // A movement of the difference, then its opposite: the stock itself never changed.
      expect(await ours(correctionId)).toEqual([
        {
          type: "ADJUSTMENT",
          quantity: 3,
          unitCost: null,
          createdById: w.owner.id,
          note: expect.stringContaining("Bug Guard correction"),
        },
        {
          type: "ADJUSTMENT",
          quantity: -3,
          unitCost: null,
          createdById: w.owner.id,
          note: expect.stringContaining("undone"),
        },
      ]);
      expect(
        (await prisma.stockBalance.findUniqueOrThrow({ where: { id: balance.id } })).quantity,
      ).toBe(balance.quantity + 3);
      await expect(
        prisma.$transaction((tx) =>
          undoPlan(
            tx,
            w.company.id,
            f.correction!,
            { journalEntryId: null },
            {
              userId: w.owner.id,
              correctionId,
            },
          ),
        ),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringMatching(/undone already/),
      });

      // Made only while the stock and its movements are as the check saw them.
      const again = (await prepare(f)).id;
      await prisma.stockBalance.update({
        where: { id: balance.id },
        data: { quantity: balance.quantity + 4 },
      });
      await expect(
        prisma.$transaction((tx) =>
          applyPlan(tx, w.company.id, f.correction!, { userId: w.owner.id, correctionId: again }),
        ),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringMatching(/Out of date.*changed since this was prepared/),
      });
      expect(await ours(again)).toEqual([]);
      // Below zero, nothing is offered: the owner counts it first.
      await prisma.stockBalance.update({ where: { id: balance.id }, data: { quantity: -2 } });
      const negative = await theFinding(`data.stock.balance:${balance.id}`);
      expect(negative).toMatchObject({ fixKind: "MANUAL", correction: null });
    } finally {
      await prisma.stockBalance.update({
        where: { id: balance.id },
        data: { quantity: balance.quantity },
      });
    }
  });

  it("finds a raw material whose stock is not its movements", async () => {
    const before = await prisma.rawMaterial.findUniqueOrThrow({ where: { id: w.fabric.id } });
    await prisma.rawMaterial.update({
      where: { id: w.fabric.id },
      data: { quantity: before.quantity.plus(5) },
    });
    try {
      const f = await theFinding(`data.stock.materials:${w.fabric.id}`);
      expect(f).toMatchObject({
        severity: "IMPORTANT",
        href: materialsHref.material(w.fabric.id),
        fixKind: "MANUAL",
      });
    } finally {
      await prisma.rawMaterial.update({
        where: { id: w.fabric.id },
        data: { quantity: before.quantity },
      });
    }
  });

  it("finds a factory delivery whose cost is not what went into stock", async () => {
    const before = await prisma.stockIntake.findUniqueOrThrow({ where: { id: w.delivery.id } });
    await prisma.stockIntake.update({
      where: { id: w.delivery.id },
      data: { totalCost: before.totalCost.plus(100) },
    });
    try {
      const f = await theFinding(`data.stock.intakes:${w.delivery.id}`);
      expect(f).toMatchObject({
        severity: "URGENT",
        href: productionHref.delivery(w.delivery.id),
        place: before.number,
        fixKind: "MANUAL",
      });
      expect(evidence(f)).toMatchObject({ "চালু এন্ট্রি": "1" });
    } finally {
      await prisma.stockIntake.update({
        where: { id: w.delivery.id },
        data: { totalCost: before.totalCost },
      });
    }
  });

  it("finds the stock value off its ledger account", async () => {
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: w.sku("M") } });
    await prisma.productVariant.update({
      where: { id: variant.id },
      data: { avgCost: variant.avgCost.plus(100) },
    });
    try {
      const f = await theFinding("data.stock.registers:inventory");
      expect(f).toMatchObject({
        severity: "IMPORTANT",
        href: "/accounts/reports/books-check",
        fixKind: "MANUAL",
      });
    } finally {
      await prisma.productVariant.update({
        where: { id: variant.id },
        data: { avgCost: variant.avgCost },
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Stored totals
  // ---------------------------------------------------------------------------

  it("leaves a purchase order's total off its lines to the owner, never setting it (v6.4.1 B4)", async () => {
    const before = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: w.po.id } });
    await prisma.purchaseOrder.update({
      where: { id: w.po.id },
      data: { totalAmount: before.totalAmount.plus(100) },
    });
    try {
      const f = await theFinding(`data.totals.purchase:${w.po.id}`);
      expect(f).toMatchObject({
        severity: "IMPORTANT",
        href: materialsHref.order(w.po.id),
        place: before.number,
      });
      expect(evidence(f)).toMatchObject({
        "লেখা মোট": "35,200.00",
        "লাইনগুলোর যোগফল": "35,100.00",
      });
      leftToOwner(f);
      expect(f.fix).toContain("“Save the changes”");
    } finally {
      await prisma.purchaseOrder.update({
        where: { id: w.po.id },
        data: { totalAmount: before.totalAmount },
      });
    }
  });

  it("leaves what is paid and due on an order and its invoice to the owner (v6.4.1 B4)", async () => {
    const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: w.order.id } });
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: w.invoice.id } });
    expect(invoice.status).toBe("PARTIALLY_PAID");
    const shift = (v: Prisma.Decimal, by: number) => v.plus(by);
    await prisma.salesOrder.update({
      where: { id: order.id },
      data: { paidAmount: shift(order.paidAmount, -1000), dueAmount: shift(order.dueAmount, 1000) },
    });
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        paidAmount: shift(invoice.paidAmount, -1000),
        dueAmount: shift(invoice.dueAmount, 1000),
      },
    });
    try {
      const f = await theFinding(`data.totals.sales:${order.id}`);
      expect(f).toMatchObject({
        severity: "IMPORTANT",
        href: salesHref.order(order.id),
        place: order.number,
      });
      expect(evidence(f)).toMatchObject({
        "পেমেন্ট থেকে পাওয়া": "5,000.00",
        "অর্ডারে লেখা পাওয়া": "4,000.00",
      });
      leftToOwner(f);
    } finally {
      await prisma.salesOrder.update({
        where: { id: order.id },
        data: { paidAmount: order.paidAmount, dueAmount: order.dueAmount },
      });
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { paidAmount: invoice.paidAmount, dueAmount: invoice.dueAmount },
      });
    }
  });

  it("leaves it to the owner when putting it right would change the invoice's status", async () => {
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: w.invoice.id } });
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "PAID" } });
    try {
      const f = await theFinding(`data.totals.sales:${w.order.id}`);
      expect(f).toMatchObject({ severity: "IMPORTANT", fixKind: "MANUAL", correction: null });
      expect(f.fix).toContain("Paid, Partly paid");
    } finally {
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: invoice.status } });
    }
  });

  it("leaves a proforma's advance off its payments to the owner (v6.4.1 B4)", async () => {
    const before = await prisma.proformaInvoice.findUniqueOrThrow({ where: { id: w.proforma.id } });
    expect(before.advancePaid.toFixed(2)).toBe("3600.00");
    await prisma.proformaInvoice.update({
      where: { id: w.proforma.id },
      data: { advancePaid: 3000 },
    });
    try {
      const f = await theFinding(`data.totals.sales:${w.proforma.id}`);
      expect(f).toMatchObject({
        severity: "IMPORTANT",
        href: salesHref.proforma(w.proforma.id),
      });
      expect(evidence(f)).toMatchObject({
        "লেখা অগ্রিম": "3,000.00",
        "পেমেন্ট থেকে রিফান্ড বাদে": "3,600.00",
      });
      leftToOwner(f);
    } finally {
      await prisma.proformaInvoice.update({
        where: { id: w.proforma.id },
        data: { advancePaid: before.advancePaid },
      });
    }
  });

  it("leaves a supplier bill's paid and due off the supplier's ledger to the owner (v6.4.1 B4)", async () => {
    const before = await prisma.supplierBill.findUniqueOrThrow({ where: { id: w.bill.id } });
    expect(before.status).toBe("PARTIALLY_PAID");
    await prisma.supplierBill.update({
      where: { id: w.bill.id },
      data: { paidAmount: before.paidAmount.plus(100), dueAmount: before.dueAmount.minus(100) },
    });
    try {
      const f = await theFinding(`data.totals.bills:${w.bill.id}`);
      expect(f).toMatchObject({
        severity: "IMPORTANT",
        href: materialsHref.purchase(w.bill.id),
        place: before.number,
      });
      leftToOwner(f);
      // The supplier's next payment or voucher settles the bills from the ledger again.
      expect(f.fix).toContain("ভাউচার");
    } finally {
      await prisma.supplierBill.update({
        where: { id: w.bill.id },
        data: { paidAmount: before.paidAmount, dueAmount: before.dueAmount },
      });
    }
  });

  it("leaves salary totals, what is paid on a salary and an advance's balance to the owner (v6.4.1 B4)", async () => {
    const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: w.salaries.id } });
    const item = await prisma.payrollItem.findFirstOrThrow({
      where: { runId: w.salaries.id, employeeId: w.karim.id },
    });
    expect(item.paidAmount.toFixed(2)).toBe("5000.00");
    const advance = await prisma.salaryAdvance.findUniqueOrThrow({ where: { id: w.advance.id } });
    await prisma.payrollRun.update({
      where: { id: run.id },
      data: { totalNet: run.totalNet.plus(1) },
    });
    await prisma.payrollItem.update({ where: { id: item.id }, data: { paidAmount: 4000 } });
    await prisma.salaryAdvance.update({ where: { id: advance.id }, data: { outstanding: 2500 } });
    try {
      const totals = await theFinding(`data.totals.payroll:${run.id}`);
      expect(totals).toMatchObject({ severity: "IMPORTANT", href: hrHref.payrollRun(run.id) });
      const paid = await theFinding(`data.totals.payroll:${item.id}`);
      expect(paid).toMatchObject({ severity: "IMPORTANT", href: hrHref.payrollRun(run.id) });
      expect(evidence(paid)).toMatchObject({ "লেখা দেওয়া": "4,000.00", পরিশোধগুলোতে: "5,000.00" });
      const owed = await theFinding(`data.totals.payroll:${advance.id}`);
      expect(owed).toMatchObject({ severity: "IMPORTANT", href: hrHref.advance(advance.id) });
      for (const f of [totals, paid, owed]) leftToOwner(f);
    } finally {
      await prisma.payrollRun.update({ where: { id: run.id }, data: { totalNet: run.totalNet } });
      await prisma.payrollItem.update({
        where: { id: item.id },
        data: { paidAmount: item.paidAmount },
      });
      await prisma.salaryAdvance.update({
        where: { id: advance.id },
        data: { outstanding: advance.outstanding },
      });
    }
  });

  it("finds a CM settlement whose payable does not add up", async () => {
    const before = await prisma.cmSettlement.findUniqueOrThrow({ where: { id: w.settlement.id } });
    await prisma.cmSettlement.update({
      where: { id: before.id },
      data: { payable: before.payable.plus(10) },
    });
    try {
      const f = await theFinding(`data.totals.cm:${before.id}`);
      expect(f).toMatchObject({
        severity: "IMPORTANT",
        href: `${productionHref.batch(w.batch.id)}/cm-settlement`,
        place: before.number,
        fixKind: "MANUAL",
      });
    } finally {
      await prisma.cmSettlement.update({
        where: { id: before.id },
        data: { payable: before.payable },
      });
    }
  });

  it("finds a sales return whose credit does not add up", async () => {
    const before = await prisma.salesReturn.findUniqueOrThrow({ where: { id: w.salesReturn.id } });
    await prisma.salesReturn.update({
      where: { id: before.id },
      data: { goodsValue: before.goodsValue.plus(10) },
    });
    try {
      const f = await theFinding(`data.totals.returns:${before.id}`);
      expect(f).toMatchObject({
        severity: "IMPORTANT",
        href: salesHref.salesReturn(before.id),
        place: before.number,
        fixKind: "MANUAL",
      });
    } finally {
      await prisma.salesReturn.update({
        where: { id: before.id },
        data: { goodsValue: before.goodsValue },
      });
    }
  });

  it("leaves a style's cost off its bills, costs and materials to the owner (v6.4.1 B4)", async () => {
    const before = await prisma.productionProject.findUniqueOrThrow({ where: { id: w.polo.id } });
    expect(before.totalCost.toFixed(2)).toBe("1800.00");
    await prisma.productionProject.update({ where: { id: w.polo.id }, data: { totalCost: 1850 } });
    try {
      const f = await theFinding(`data.totals.projects:${w.polo.id}`);
      expect(f).toMatchObject({
        severity: "IMPORTANT",
        href: productionHref.project(w.polo.id),
      });
      expect(evidence(f)).toMatchObject({ "লেখা মোট খরচ": "1,850.00" });
      leftToOwner(f);
    } finally {
      await prisma.productionProject.update({
        where: { id: w.polo.id },
        data: { totalCost: before.totalCost },
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Money
  // ---------------------------------------------------------------------------

  it("finds a line amount that is not quantity times price, small or not", async () => {
    const line = await prisma.purchaseOrderLine.findFirstOrThrow({ where: { orderId: w.po.id } });
    expect(line.amount.toFixed(2)).toBe("35100.00");
    await prisma.purchaseOrderLine.update({ where: { id: line.id }, data: { amount: 35100.4 } });
    try {
      const small = await theFinding(`data.money.rounding:${line.id}`);
      expect(small).toMatchObject({
        severity: "LATER",
        href: materialsHref.order(w.po.id),
        fixKind: "MANUAL",
      });
      expect(evidence(small)).toMatchObject({
        "লেখা টাকা": "35,100.40",
        "হওয়ার কথা": "35,100.00",
        পার্থক্য: "0.40",
      });
      await prisma.purchaseOrderLine.update({ where: { id: line.id }, data: { amount: 35200 } });
      expect((await theFinding(`data.money.rounding:${line.id}`)).severity).toBe("IMPORTANT");
    } finally {
      await prisma.purchaseOrderLine.update({
        where: { id: line.id },
        data: { amount: line.amount },
      });
    }
  });

  it("finds a proforma made from a quotation in another currency", async () => {
    await prisma.quotation.update({ where: { id: w.quotation.id }, data: { currency: "USD" } });
    try {
      const f = await theFinding(`data.money.currency:${w.proforma.id}`);
      expect(f).toMatchObject({
        severity: "IMPORTANT",
        href: salesHref.proforma(w.proforma.id),
        fixKind: "MANUAL",
      });
      expect(evidence(f)).toMatchObject({ "কোটেশনের মুদ্রা": "USD", "খাতার মুদ্রা": "BDT" });
    } finally {
      await prisma.quotation.update({ where: { id: w.quotation.id }, data: { currency: "BDT" } });
    }
  });

  // ---------------------------------------------------------------------------
  // Links and dates
  // ---------------------------------------------------------------------------

  it("finds a link into another company, and only in the company it is in", async () => {
    await prisma.payment.update({
      where: { id: w.payment.id },
      data: { partyId: w.stranger.id },
    });
    try {
      const f = await theFinding(`data.links.company:${w.payment.id}-partyId`);
      expect(f).toMatchObject({
        severity: "URGENT",
        href: salesHref.payment(w.payment.id),
        fixKind: "MANUAL",
      });
      expect(evidence(f)).toMatchObject({ "যে লিংক": "ক্রেতা বা সরবরাহকারী" });
      // Nothing about it in the other company's checks.
      expect((await runChecks(w.other.id)).found).toEqual([]);
    } finally {
      await prisma.payment.update({ where: { id: w.payment.id }, data: { partyId: w.buyer.id } });
    }
  });

  it("finds a payment entered twice and a buyer made twice", async () => {
    const twin = await prisma.party.create({
      data: {
        companyId: w.company.id,
        code: "BUY-TWIN",
        kind: "BUYER",
        name: "  rahim   traders ",
        phone: "+880 1711-223344",
      },
    });
    const first = await payments.receivePayment(w.accounts, {
      partyId: w.shop.id,
      amount: 111,
      method: "CASH",
    });
    const second = await payments.receivePayment(w.accounts, {
      partyId: w.shop.id,
      amount: 111,
      method: "CASH",
    });
    try {
      const party = await theFinding(`data.links.duplicates:${twin.id}`);
      expect(party).toMatchObject({
        severity: "LATER",
        href: partyHref({ id: twin.id, kind: "BUYER" }),
        fixKind: "MANUAL",
      });
      const paidTwice = await theFinding(`data.links.duplicates:${second.payment.id}`);
      expect(paidTwice).toMatchObject({
        severity: "IMPORTANT",
        href: salesHref.payment(second.payment.id),
        place: second.payment.number,
        fixKind: "MANUAL",
      });
      expect(evidence(paidTwice).পেমেন্ট).toBe(`${first.payment.number}, ${second.payment.number}`);
    } finally {
      await prisma.party.delete({ where: { id: twin.id } });
      // Told apart by their references, as two real payments would be.
      await prisma.payment.update({
        where: { id: first.payment.id },
        data: { reference: "TRX-1" },
      });
      await prisma.payment.update({
        where: { id: second.payment.id },
        data: { reference: "TRX-2" },
      });
    }
  });

  it("finds an invoice standing on a cancelled order", async () => {
    await prisma.salesOrder.update({ where: { id: w.order.id }, data: { status: "CANCELLED" } });
    const status = (await prisma.salesOrder.findUniqueOrThrow({ where: { id: w.order.id } }))
      .status;
    expect(status).toBe("CANCELLED");
    try {
      const f = await theFinding(`data.links.parents:${w.invoice.id}`);
      expect(f).toMatchObject({
        severity: "IMPORTANT",
        href: salesHref.invoice(w.invoice.id),
        fixKind: "MANUAL",
      });
    } finally {
      await prisma.salesOrder.update({
        where: { id: w.order.id },
        data: { status: w.order.status },
      });
    }
  });

  it("finds an invoice due before it was issued", async () => {
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: w.invoice.id } });
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { dueDate: new Date(invoice.issueDate.getTime() - 3 * 24 * 60 * 60 * 1000) },
    });
    try {
      const f = await theFinding(`data.links.dates:due-${invoice.id}`);
      expect(f).toMatchObject({
        severity: "LATER",
        href: salesHref.invoice(invoice.id),
        place: invoice.number,
        fixKind: "MANUAL",
      });
    } finally {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { dueDate: invoice.dueDate },
      });
    }
  });

  it("finds a date years away, as a typing mistake", async () => {
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { companyId: w.company.id, sourceType: "EXPENSE", sourceId: w.rent.id },
    });
    await prisma.journalEntry.update({
      where: { id: entry.id },
      data: { date: new Date("2062-10-16T00:00:00.000Z") },
    });
    try {
      const f = await theFinding(`data.links.dates:future-${entry.id}`);
      expect(f).toMatchObject({
        severity: "LATER",
        href: accountsHref.entry(entry.id),
        fixKind: "MANUAL",
      });
    } finally {
      await prisma.journalEntry.update({ where: { id: entry.id }, data: { date: entry.date } });
    }
  });

  // ---------------------------------------------------------------------------
  // Applying an adjusting entry (v6.4 fresh review S5, S6)
  // ---------------------------------------------------------------------------

  const PIN = "4321";
  let boss: CompanyContext | null = null;

  /** The platform owner, with the PIN set, as on the Bug Guard screen. */
  const guardOwner = async () => {
    if (boss) return boss;
    const user = await makeUser(`guard@${w.company.slug}.test`, { isSuperAdmin: true });
    await addToCompany(user.id, w.company.id, w.roles.SUPER_ADMIN);
    boss = await contextFor(user.id, w.company.id);
    await setPin(boss, { pin: PIN });
    return boss;
  };
  const backup = (status: "RUNNING" | "SUCCEEDED") => async () =>
    (await prisma.backupRun.create({ data: { trigger: "MANUAL", status } })).id;
  const statusOf = async (id: string) =>
    (await prisma.bugGuardCorrection.findUniqueOrThrow({ where: { id } })).status;
  const another = (c: { companyId: string; findingId: string }, plan: unknown) =>
    prisma.bugGuardCorrection.create({
      data: {
        companyId: c.companyId,
        findingId: c.findingId,
        plan: plan as Prisma.InputJsonValue,
        summary: "the same correction again",
      },
    });

  it("checks an adjusting entry again at Apply and after the backup, under a lock: never posted twice (S5)", async () => {
    const owner = await guardOwner();
    const companyId = w.company.id;
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { companyId, sourceType: "EXPENSE", sourceId: w.rent.id },
    });
    await prisma.expense.update({ where: { id: w.rent.id }, data: { voidedAt: new Date() } });
    const entries = () => prisma.journalEntry.count({ where: { companyId } });
    const before = await entries();
    let reversalId: string | null = null;
    try {
      const f = await theFinding(`data.posting.purchases:${w.rent.id}`);
      expect(f.correction).toMatchObject({
        kind: "JOURNAL",
        precondition: { kind: "ENTRY", entryId: entry.id, isReversed: false },
      });

      // The same reversal approved twice: it is posted once, the other is out of date.
      const first = await prepare(f);
      const second = await another(first, f.correction);
      for (const c of [first, second]) {
        await applyCorrection(owner, c.id, { pin: PIN }, undefined, undefined, backup("SUCCEEDED"));
      }
      await processCorrections(new Date());
      expect([await statusOf(first.id), await statusOf(second.id)].sort()).toEqual([
        "APPLIED",
        "STALE",
      ]);
      expect(await entries()).toBe(before + 1);
      const applied = (await statusOf(first.id)) === "APPLIED" ? first : second;
      await undoCorrection(owner, applied.id, { pin: PIN });
      expect(await entries()).toBe(before + 2);

      // Reversed the ERP's way while the backup ran: nothing is posted after it.
      const third = await another(first, f.correction);
      await applyCorrection(owner, third.id, { pin: PIN }, undefined, undefined, backup("RUNNING"));
      const run = (await prisma.bugGuardCorrection.findUniqueOrThrow({ where: { id: third.id } }))
        .backupRunId!;
      reversalId = (
        await runTransaction((tx) =>
          reverseJournalEntry(tx, entry.id, { description: `Reversal of ${entry.number}` }),
        )
      ).id;
      await prisma.backupRun.update({ where: { id: run }, data: { status: "SUCCEEDED" } });
      await processCorrections(new Date());
      expect(
        await prisma.bugGuardCorrection.findUniqueOrThrow({ where: { id: third.id } }),
      ).toMatchObject({
        status: "STALE",
        error: expect.stringMatching(/reversed/),
      });
      expect(await entries()).toBe(before + 3);

      // And at Apply: out of date at once, before any backup starts.
      const fourth = await another(first, f.correction);
      let started = false;
      await expect(
        applyCorrection(owner, fourth.id, { pin: PIN }, undefined, undefined, async () => {
          started = true;
          return "none";
        }),
      ).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/reversed/) });
      expect(started).toBe(false);
      expect(await statusOf(fourth.id)).toBe("STALE");
      expect(await entries()).toBe(before + 3);
    } finally {
      if (reversalId) await prisma.journalEntry.delete({ where: { id: reversalId } });
      await prisma.journalEntry.update({ where: { id: entry.id }, data: { isReversed: false } });
      await prisma.expense.update({ where: { id: w.rent.id }, data: { voidedAt: null } });
    }
  });

  it("never posts a payment's entry once the payment changed, nor a plan kept without its check (S5)", async () => {
    const owner = await guardOwner();
    const lost = await prisma.payment.create({
      data: {
        companyId: w.company.id,
        number: "PAY-TEST-0002",
        direction: "RECEIVED",
        method: "CASH",
        partyId: w.shop.id,
        amount: 750,
        accountId: w.acc.CASH,
        isAdvance: true,
      },
    });
    try {
      const f = await theFinding(`data.posting.sales:${lost.id}`);
      expect(f.correction).toMatchObject({
        precondition: {
          kind: "PAYMENT",
          paymentId: lost.id,
          amount: "750.00",
          accountId: w.acc.CASH,
          isAdvance: true,
          partyId: w.shop.id,
        },
      });
      const c = await prepare(f);
      await prisma.payment.update({ where: { id: lost.id }, data: { amount: 700 } });
      await expect(
        applyCorrection(owner, c.id, { pin: PIN }, undefined, undefined, backup("SUCCEEDED")),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await statusOf(c.id)).toBe("STALE");

      // A plan kept before Bug Guard stored what to check: never posted.
      const older = { ...(f.correction as object), precondition: undefined };
      const old = await another(c, older);
      await expect(
        applyCorrection(owner, old.id, { pin: PIN }, undefined, undefined, backup("SUCCEEDED")),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await statusOf(old.id)).toBe("STALE");
      expect(
        await prisma.journalEntry.count({
          where: {
            companyId: w.company.id,
            sourceType: "CORRECTION",
            sourceId: { in: [c.id, old.id] },
          },
        }),
      ).toBe(0);
    } finally {
      await prisma.payment.delete({ where: { id: lost.id } });
    }
  });

  it("settles a supplier's bills when a correction on their Payable is applied, and when it is undone (S6)", async () => {
    const owner = await guardOwner();
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { companyId: w.company.id, sourceType: "OPENING_BALANCE", sourceId: w.mill.id },
    });
    const bill = () => prisma.supplierBill.findUniqueOrThrow({ where: { id: w.bill.id } });
    const was = await bill();
    await prisma.journalEntry.update({ where: { id: entry.id }, data: { isReversed: true } });
    try {
      const f = await theFinding(`data.ledger.reversals:${entry.id}`);
      const c = await prepare(f);
      await applyCorrection(owner, c.id, { pin: PIN }, undefined, undefined, backup("SUCCEEDED"));
      await processCorrections(new Date());
      expect(await statusOf(c.id)).toBe("APPLIED");
      // Less owed to the mill: their bill is paid more, exactly as their ledger says.
      const applied = await bill();
      expect(applied.paidAmount.gt(was.paidAmount)).toBe(true);
      expect(await only("data.totals.bills")).toEqual([]);

      await undoCorrection(owner, c.id, { pin: PIN });
      expect((await bill()).paidAmount.lt(applied.paidAmount)).toBe(true);
      expect(await only("data.totals.bills")).toEqual([]);
    } finally {
      // The opening balance live again, and the mill's bills settled the ERP's way.
      await prisma.journalEntry.update({ where: { id: entry.id }, data: { isReversed: false } });
      await runTransaction((tx) => settleSupplierBills(tx, w.company.id, w.mill.id));
    }
    expect((await bill()).paidAmount.toFixed(2)).toBe(was.paidAmount.toFixed(2));
  });

  // ---------------------------------------------------------------------------
  // The words
  // ---------------------------------------------------------------------------

  it("speaks Bengali with Western digits, never naming a secret, and never repeats a key", async () => {
    // Break several things at once to see many kinds of finding together.
    const balance = await prisma.stockBalance.findFirstOrThrow({
      where: { companyId: w.company.id, variantId: w.sku("S"), grade: "A_GRADE" },
    });
    const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: w.salaries.id } });
    await prisma.stockBalance.update({
      where: { id: balance.id },
      data: { quantity: balance.quantity + 2 },
    });
    await prisma.payrollRun.update({
      where: { id: run.id },
      data: { totalGross: run.totalGross.plus(5) },
    });
    await prisma.salesOrder.update({ where: { id: w.order.id }, data: { status: "CANCELLED" } });
    try {
      const { found } = await runChecks(w.company.id);
      expect(found.length).toBeGreaterThanOrEqual(3);
      for (const f of found) {
        for (const text of [f.title, f.why, f.fix, ...(f.evidence ?? []).map((e) => e.label)]) {
          expect(text, f.key).not.toMatch(/[০-৯]/);
          expect(text, f.key).not.toMatch(/password|token|secret|api[_ ]?key/i);
        }
        expect(f.why, f.key).toMatch(/[ঀ-৿]/);
        expect(f.fix, f.key).toMatch(/[ঀ-৿]/);
        // No amount in a key: the same problem keeps its key as figures change.
        expect(f.key, f.key).not.toMatch(/\d+\.\d{2}/);
        if (f.correction) expect(f.fixKind).toBe("DATA");
        if (f.fixKind === "DATA") expect(f.correction).not.toBeNull();
        for (const e of f.evidence ?? []) expect(e.label).toMatch(/[ঀ-৿]|^SKU$/);
      }
    } finally {
      await prisma.stockBalance.update({
        where: { id: balance.id },
        data: { quantity: balance.quantity },
      });
      await prisma.payrollRun.update({
        where: { id: run.id },
        data: { totalGross: run.totalGross },
      });
      await prisma.salesOrder.update({
        where: { id: w.order.id },
        data: { status: w.order.status },
      });
    }
  });
});
