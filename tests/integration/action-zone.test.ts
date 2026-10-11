import { beforeEach, describe, expect, it } from "vitest";

import { dateColumn, localDay, startOfDayInZone } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { addDays } from "@/modules/accounts/periods";
import {
  BIG_DISCOUNT_PCT,
  getActionZone,
  reminderMessage,
} from "@/modules/dashboard/action-zone.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as parties from "@/modules/parties/party.service";
import * as screens from "@/modules/production/screens.service";
import * as orders from "@/modules/sales/order.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const TZ = "Asia/Dhaka";

/**
 * Home dashboard overhaul 2: the Action Zone. Overdue invoices by buyer with a
 * WhatsApp reminder link, low stock with "Order now", and pending approvals
 * (leave, payroll, and for the owner the period's sales returns and orders with a
 * discount over 10%).
 *
 * A company with one person per built-in role, two polos (Navy M with 50 pcs,
 * Navy L with 2 pcs: low), and two buyers, one without a phone.
 */
async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const member = async (role: keyof typeof roles, who: string) => {
    const user = await makeUser(`${who}@extras.test`);
    await addToCompany(user.id, company.id, roles[role]);
    return contextFor(user.id, company.id);
  };
  const admin = await member("SUPER_ADMIN", "admin");
  const accounts = await member("ACCOUNTS", "accounts");
  const sales = await member("SALES_EXECUTIVE", "sales");
  const production = await member("PRODUCTION_MANAGER", "production");
  const store = await member("WAREHOUSE_TEAM", "store");
  const employee = await member("EMPLOYEE", "employee");

  const m = await catalog.createSize(admin, { name: "M" });
  const l = await catalog.createSize(admin, { name: "L" });
  const navy = await catalog.createColor(admin, { name: "Navy", hexCode: "#1f2a44" });
  const tops = await catalog.createCategory(admin, { name: "Tops" });
  const style = await styles.createStyle(admin, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    retailPrice: 1450,
    wholesalePrice: 1000,
  });
  await matrix.generateMatrix(admin, style.id, { colorIds: [navy.id], sizeIds: [m.id, l.id] });
  const variants = await prisma.productVariant.findMany({
    where: { styleId: style.id },
    include: { size: true },
  });
  const medium = variants.find((v) => v.size.name === "M")!;
  const large = variants.find((v) => v.size.name === "L")!;
  for (const [variant, quantity] of [
    [medium, 50],
    [large, 2],
  ] as const) {
    await stock.adjustStock(admin, {
      variantId: variant.id,
      quantity,
      type: "OPENING",
      unitCost: 500,
    });
  }
  const { party: rahim } = await parties.createParty(admin, {
    kind: "BUYER",
    name: "Rahim Traders",
    phone: "01711223344",
  });
  const { party: selim } = await parties.createParty(admin, {
    kind: "BUYER",
    name: "Selim Fashion",
  });
  return {
    company,
    admin,
    accounts,
    sales,
    production,
    store,
    employee,
    style,
    tops,
    medium,
    large,
    rahim,
    selim,
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

const today = () => localDay(new Date(), TZ);

/** An invoiced order of `pieces` Navy M for the buyer at 1000 (or a walk-in at the counter, at 1450). */
async function sell(
  env: Env,
  buyer: { id: string } | { name: string; phone?: string },
  pieces: number,
  extra: { lineDiscount?: number; discount?: number } = {},
) {
  const order = await orders.createOrder(env.admin, {
    ...("id" in buyer
      ? { channel: "WHOLESALE", partyId: buyer.id }
      : { channel: "POS", customerName: buyer.name, customerPhone: buyer.phone }),
    lines: [{ variantId: env.medium.id, quantity: pieces, discount: extra.lineDiscount }],
    discount: extra.discount,
  });
  return prisma.invoice.findUniqueOrThrow({ where: { orderId: order.id } });
}

/** Moves an invoice's due day `days` back from today (positive: in the past). */
const dueDaysAgo = (invoiceId: string, days: number) =>
  prisma.invoice.update({
    where: { id: invoiceId },
    data: { dueDate: new Date(startOfDayInZone(addDays(today(), -days), TZ).getTime() + 3600_000) },
  });

describe("the WhatsApp payment reminder", () => {
  it("names the company, the amount and the invoices, oldest due first", () => {
    expect(
      reminderMessage({
        company: "Extras",
        buyer: "Rahim Traders",
        amount: "BDT 12,000.00",
        numbers: ["INV-0001"],
        oldestDueOn: "2026-10-01",
      }),
    ).toBe(
      "Dear Rahim Traders, a gentle reminder from Extras: BDT 12,000.00 is overdue on invoice " +
        "INV-0001 (due 1 Oct 2026). Please arrange the payment at your earliest convenience. Thank you.",
    );
    const many = reminderMessage({
      company: "Extras",
      buyer: null,
      amount: "BDT 5.00",
      numbers: ["INV-1", "INV-2", "INV-3", "INV-4", "INV-5"],
      oldestDueOn: "2026-09-03",
    });
    expect(many).toContain("Dear customer,");
    expect(many).toContain(
      "on invoices INV-1, INV-2, INV-3 and 2 more, the oldest due 3 Sep 2026.",
    );
    expect(
      reminderMessage({
        company: "Extras",
        buyer: "Selim",
        amount: "BDT 5.00",
        numbers: ["INV-1", "INV-2"],
        oldestDueOn: "2026-09-03",
      }),
    ).toContain("on invoices INV-1 and INV-2, the oldest due");
  });
});

run("the Action Zone's overdue invoices", () => {
  beforeEach(resetDb);

  it("lists buyers by what they owe, with a WhatsApp reminder ready to send", async () => {
    const env = await setup();
    const old = await sell(env, env.rahim, 10); // 10,000
    const recent = await sell(env, env.rahim, 2); // 2,000
    const notYet = await sell(env, env.rahim, 1);
    const paid = await sell(env, env.rahim, 1);
    const counter = await sell(env, { name: "Karim", phone: "01811000000" }, 3); // 4,350
    const noPhone = await sell(env, env.selim, 1);
    await dueDaysAgo(old.id, 10);
    await dueDaysAgo(recent.id, 3);
    await dueDaysAgo(notYet.id, -5);
    await dueDaysAgo(paid.id, 20);
    await prisma.invoice.update({
      where: { id: paid.id },
      data: { status: "PAID", paidAmount: paid.total, dueAmount: 0 },
    });
    await dueDaysAgo(counter.id, 1);
    await dueDaysAgo(noPhone.id, 40);

    const zone = await getActionZone(env.admin);
    const overdue = zone.overdue!;
    expect(overdue).toMatchObject({ buyers: 3, invoices: 4, total: "17350.00" });
    expect(overdue.items.map((i) => i.buyer)).toEqual(["Rahim Traders", "Karim", "Selim Fashion"]);

    const [rahim, karim, selim] = overdue.items;
    expect(rahim).toMatchObject({
      partyId: env.rahim.id,
      walkIn: false,
      due: "12000.00",
      invoices: 2,
      numbers: [old.number, recent.number],
      invoiceId: old.id,
      daysLate: 10,
      oldestDueOn: addDays(today(), -10),
    });
    expect(rahim!.whatsapp).toMatch(/^https:\/\/wa\.me\/8801711223344\?text=/);
    const text = decodeURIComponent(rahim!.whatsapp!.split("?text=")[1]!);
    expect(text).toContain("Dear Rahim Traders, a gentle reminder from Extras: BDT 12,000.00");
    expect(text).toContain(`invoices ${old.number} and ${recent.number}`);

    // A walk-in sale: the customer's name and phone from the order.
    expect(karim).toMatchObject({ partyId: null, walkIn: true, due: "4350.00", daysLate: 1 });
    expect(karim!.whatsapp).toMatch(/^https:\/\/wa\.me\/8801811000000\?text=Dear%20Karim/);
    // No number on the buyer: no link.
    expect(selim).toMatchObject({ due: "1000.00", daysLate: 40, whatsapp: null });
  });

  it("is for those who follow up dues: Sales, Accounts and the owner", async () => {
    const env = await setup();
    const invoice = await sell(env, env.rahim, 1);
    await dueDaysAgo(invoice.id, 2);
    for (const [who, ctx, sees] of [
      ["owner", env.admin, true],
      ["accounts", env.accounts, true],
      ["sales", env.sales, true],
      ["store", env.store, false],
      ["production", env.production, false],
      ["employee", env.employee, false],
    ] as const) {
      const zone = await getActionZone(ctx);
      expect(zone.overdue === null, who).toBe(!sees);
      if (sees) expect(zone.overdue!.invoices, who).toBe(1);
    }
  });
});

run("the Action Zone's low stock", () => {
  beforeEach(resetDb);

  it("lists the SKUs below the threshold with the way to order more", async () => {
    const env = await setup();
    const zone = await getActionZone(env.production);
    expect(zone.lowStock).toMatchObject({ threshold: 5, total: 1, outOfStock: 0 });
    expect(zone.lowStock!.items).toEqual([
      expect.objectContaining({
        variantId: env.large.id,
        styleId: env.style.id,
        styleName: "Classic Polo",
        sizeName: "L",
        available: 2,
      }),
    ]);
    // Production starts a project; others open the product, or nothing without Products.
    expect(zone.lowStock!.orderNow).toBe("PRODUCTION");
    expect((await getActionZone(env.admin)).lowStock!.orderNow).toBe("PRODUCTION");
    expect((await getActionZone(env.sales)).lowStock!.orderNow).toBe("PRODUCT");
    expect((await getActionZone(env.store)).lowStock!.orderNow).toBe("PRODUCT");
    expect((await getActionZone(env.accounts)).lowStock!.orderNow).toBeNull();
    expect((await getActionZone(env.employee)).lowStock).toBeNull();
  });

  it("opens a new in-house project for the style with its low SKUs named", async () => {
    const env = await setup();
    const form = await screens.getProjectForm(env.production, undefined, {
      restockStyleId: env.style.id,
    });
    expect(form.source).toBeNull();
    expect(form.restock).toMatchObject({
      style: { id: env.style.id, code: "EX-PL-001", name: "Classic Polo" },
      categoryId: env.tops.id,
      name: "Restock: Classic Polo (EX-PL-001)",
      threshold: 5,
      low: [{ variantId: env.large.id, colorName: "Navy", sizeName: "L", available: 2 }],
    });
    // The style's grid, every box empty to fill in.
    expect(form.blocks).toHaveLength(1);
    expect(form.blocks[0]!.matrix.style.id).toBe(env.style.id);
    expect(form.blocks[0]!.quantities).toEqual({});
    // An order or a proforma wins over a restock; an unknown style is not found.
    const plain = await screens.getProjectForm(env.production);
    expect(plain.restock).toBeNull();
    const error = await screens
      .getProjectForm(env.production, undefined, { restockStyleId: "nope" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("NOT_FOUND");
  });
});

run("the Action Zone's pending approvals", () => {
  beforeEach(resetDb);

  async function waiting(env: Env) {
    const sabbir = await prisma.employee.create({
      data: {
        companyId: env.company.id,
        code: "EMP-001",
        name: "Sabbir Ahmed",
        joinDate: new Date("2025-01-01"),
        baseSalary: 18000,
      },
    });
    const casual = await prisma.leaveType.create({
      data: { companyId: env.company.id, name: "Casual", daysPerYear: 10 },
    });
    const leave = (start: string, end: string, days: number) =>
      prisma.leaveRequest.create({
        data: {
          companyId: env.company.id,
          employeeId: sabbir.id,
          leaveTypeId: casual.id,
          startDate: dateColumn(start),
          endDate: dateColumn(end),
          days,
        },
      });
    const pendingLeave = await leave("2026-11-02", "2026-11-03", 2);
    await prisma.leaveRequest.update({
      where: { id: (await leave("2026-11-10", "2026-11-10", 1)).id },
      data: { status: "APPROVED" },
    });

    const draft = await prisma.payrollRun.create({
      data: { companyId: env.company.id, year: 2026, month: 9 },
    });
    await prisma.payrollRun.create({
      data: { companyId: env.company.id, year: 2026, month: 8, status: "PAID" },
    });
    return { pendingLeave, draft };
  }

  it("shows leave and payroll to the people who decide them", async () => {
    const env = await setup();
    const { pendingLeave, draft } = await waiting(env);

    const owner = (await getActionZone(env.admin)).approvals!;
    expect(owner.leave).toEqual({
      count: 1,
      items: [
        {
          id: pendingLeave.id,
          employee: "Sabbir Ahmed",
          type: "Casual",
          from: "2026-11-02",
          to: "2026-11-03",
          days: "2",
        },
      ],
    });
    expect(owner.payroll).toEqual({ count: 1, items: [{ id: draft.id, month: "2026-09" }] });

    // Accounts prepares payroll but does not approve it; the others decide neither.
    for (const ctx of [env.accounts, env.sales, env.store, env.production, env.employee]) {
      expect((await getActionZone(ctx)).approvals).toBeNull();
    }
  });

  it("flags the period's sales returns for the owner to look over", async () => {
    const env = await setup();
    const invoice = await sell(env, env.rahim, 3);
    const returned = (number: string, at: Date, extra: object = {}) =>
      prisma.salesReturn.create({
        data: {
          companyId: env.company.id,
          number,
          orderId: invoice.orderId,
          invoiceId: invoice.id,
          partyId: env.rahim.id,
          status: "COMPLETED",
          receivedAt: at,
          completedAt: at,
          amount: 1000,
          createdById: env.admin.user.id,
          ...extra,
        },
      });
    const now = new Date();
    const credit = await returned("CN-0001", now);
    await returned("CN-0002", now, { voidedAt: now });
    await returned("CN-0003", startOfDayInZone(addDays(today(), -40), TZ));

    const zone = await getActionZone(env.admin, { range: "MONTH" });
    expect(zone.approvals!.returns).toEqual({
      count: 1,
      items: [
        {
          id: credit.id,
          number: "CN-0001",
          buyer: "Rahim Traders",
          returnedOn: today(),
          amount: "1000.00",
          by: "admin",
        },
      ],
    });
    for (const ctx of [env.accounts, env.sales, env.store]) {
      expect((await getActionZone(ctx)).approvals).toBeNull();
    }
  });

  it(`flags orders in the period with a discount over ${BIG_DISCOUNT_PCT}% for the owner`, async () => {
    const env = await setup();
    // 10 x 1000 = 10,000 before discounts.
    const big = await sell(env, env.rahim, 10, { lineDiscount: 1000, discount: 500 }); // 15%
    await sell(env, env.rahim, 10, { discount: 1000 }); // exactly 10%: not flagged
    const cancelled = await orders.createOrder(env.admin, {
      channel: "WHOLESALE",
      partyId: env.rahim.id,
      lines: [{ variantId: env.medium.id, quantity: 10 }],
      discount: 3000,
      documents: { invoice: false },
    });
    await orders.cancelOrder(env.admin, cancelled.id, { reason: "Buyer changed mind" });
    const lastMonth = await sell(env, env.rahim, 10, { discount: 2500 });
    await prisma.salesOrder.update({
      where: { id: lastMonth.orderId },
      data: { orderDate: startOfDayInZone(addDays(today(), -40), TZ) },
    });

    const zone = await getActionZone(env.admin, { range: "MONTH" });
    const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: big.orderId } });
    expect(zone.approvals!.discounts).toEqual({
      threshold: 10,
      count: 1,
      items: [
        {
          id: order.id,
          number: order.number,
          buyer: "Rahim Traders",
          orderedOn: today(),
          percent: "15.0",
          discount: "1500.00",
          by: "admin",
        },
      ],
    });
    // Only the owner (company settings) sees them.
    expect((await getActionZone(env.accounts)).approvals).toBeNull();
    expect((await getActionZone(env.sales)).approvals).toBeNull();
  });
});
