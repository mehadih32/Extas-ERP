import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { formatDay } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import * as printing from "@/modules/documents/print.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import { getBuyer360 } from "@/modules/parties/buyer-360.service";
import * as parties from "@/modules/parties/party.service";
import * as projects from "@/modules/production/project.service";
import { createRole } from "@/modules/rbac/role.service";
import * as orders from "@/modules/sales/order.service";
import * as payments from "@/modules/sales/payment.service";
import * as reportScreens from "@/modules/reports/screens.service";
import * as quotations from "@/modules/sales/quotation.service";

import { pdfLines } from "../fixtures/pdf";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const DAY_MS = 86_400_000;

/**
 * A company with one person per role that sees buyers, a polo (Navy / White x
 * S M L XL, wholesale 900, retail 1450) and a tee (Navy x M L, wholesale 500),
 * 10 pcs of each SKU (polos at cost 500, tees at 300), the buyers Rahim Traders
 * (30 days' credit) and Karim Fashion, and a factory.
 */
async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const person = async (email: string, roleId: string) => {
    const user = await makeUser(`${email}@extras.test`);
    await addToCompany(user.id, company.id, roleId);
    return contextFor(user.id, company.id);
  };
  const ctx = await person("admin", roles.SUPER_ADMIN);
  const salesCtx = await person("sales", roles.SALES_EXECUTIVE);
  const accountsCtx = await person("accounts", roles.ACCOUNTS);
  const pmCtx = await person("production", roles.PRODUCTION_MANAGER);

  const sizes = new Map<string, string>();
  for (const name of ["S", "M", "L", "XL"]) {
    sizes.set(name, (await catalog.createSize(ctx, { name })).id);
  }
  const navy = await catalog.createColor(ctx, { name: "Navy", hexCode: "#1f2a44" });
  const white = await catalog.createColor(ctx, { name: "White", hexCode: "#FFFFFF" });
  const tops = await catalog.createCategory(ctx, { name: "Tops" });
  const polo = await styles.createStyle(ctx, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    retailPrice: 1450,
    wholesalePrice: 900,
  });
  await matrix.generateMatrix(ctx, polo.id, {
    colorIds: [navy.id, white.id],
    sizeIds: [...sizes.values()],
  });
  const tee = await styles.createStyle(ctx, {
    code: "EX-TS-002",
    name: "Basic Tee",
    categoryId: tops.id,
    retailPrice: 750,
    wholesalePrice: 500,
  });
  await matrix.generateMatrix(ctx, tee.id, {
    colorIds: [navy.id],
    sizeIds: [sizes.get("M")!, sizes.get("L")!],
  });
  const variants = await prisma.productVariant.findMany({
    where: { styleId: { in: [polo.id, tee.id] } },
    include: { color: true, size: true },
  });
  const sku = (styleId: string, color: string, size: string) =>
    variants.find((v) => v.styleId === styleId && v.color.name === color && v.size.name === size)!
      .id;
  for (const v of variants) {
    await stock.adjustStock(ctx, {
      variantId: v.id,
      quantity: 10,
      type: "OPENING",
      unitCost: v.styleId === polo.id ? 500 : 300,
    });
  }
  const buyer = (
    await parties.createParty(ctx, {
      kind: "BUYER",
      name: "Rahim Traders",
      phone: "01711223344",
      paymentTermsDays: 30,
    })
  ).party;
  const other = (await parties.createParty(ctx, { kind: "BUYER", name: "Karim Fashion" })).party;
  const factory = (
    await parties.createParty(ctx, { kind: "SUPPLIER", name: "Gazipur Knit Factory" })
  ).party;
  return { ctx, salesCtx, accountsCtx, pmCtx, company, polo, tee, sku, buyer, other, factory };
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

/**
 * Rahim Traders' business: two wholesale orders, 5,000 received, the second
 * invoice ten days overdue, a quotation and a production project; and one
 * order for Karim Fashion, which must not count.
 *   Order A: 12 Navy polos x 900 = 10,800 (goods cost 12 x 500 = 6,000).
 *   Order B: 6 Navy M tees x 500 + 2 White M polos x 900 = 4,800, less 480
 *            discount = 4,320 (tees 2,700 and polos 1,620 after the discount;
 *            goods cost 1,800 + 1,000).
 */
async function business(env: Env, now: Date) {
  const { ctx } = env;
  const a = await orders.createOrder(ctx, {
    channel: "WHOLESALE",
    partyId: env.buyer.id,
    matrix: [
      {
        styleId: env.polo.id,
        quantities: {
          [env.sku(env.polo.id, "Navy", "S")]: 2,
          [env.sku(env.polo.id, "Navy", "M")]: 4,
          [env.sku(env.polo.id, "Navy", "L")]: 4,
          [env.sku(env.polo.id, "Navy", "XL")]: 2,
        },
      },
    ],
  });
  const b = await orders.createOrder(ctx, {
    channel: "WHOLESALE",
    partyId: env.buyer.id,
    lines: [
      { variantId: env.sku(env.tee.id, "Navy", "M"), quantity: 6 },
      { variantId: env.sku(env.polo.id, "White", "M"), quantity: 2 },
    ],
    discount: 480,
  });
  const c = await orders.createOrder(ctx, {
    channel: "WHOLESALE",
    partyId: env.other.id,
    lines: [{ variantId: env.sku(env.polo.id, "White", "L"), quantity: 3 }],
  });
  expect([a.total.toFixed(2), b.total.toFixed(2), c.total.toFixed(2)]).toEqual([
    "10800.00",
    "4320.00",
    "2700.00",
  ]);
  const { payment: paid } = await payments.receivePayment(env.accountsCtx, {
    orderId: a.id,
    amount: 5000,
    method: "CASH",
  });
  // Order B fell due ten days ago and is not paid.
  await prisma.invoice.update({
    where: { orderId: b.id },
    data: { dueDate: new Date(now.getTime() - 10 * DAY_MS) },
  });
  const quotation = await quotations.createQuotation(ctx, {
    partyId: env.buyer.id,
    validUntil: "2099-12-31",
    items: [{ description: "Pique polo with tipping", quantity: 600, unitPrice: 650 }],
  });
  const project = await projects.createProject(env.pmCtx, {
    name: "Rahim polo run",
    styleId: env.polo.id,
    factoryId: env.factory.id,
    buyerId: env.buyer.id,
    targetDate: "2099-12-31",
    targetQuantity: 300,
  });
  return { a, b, c, paid, quotation, project };
}

run("Customer 360°", () => {
  let uploads: string;

  beforeEach(async () => {
    await resetDb();
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-buyer-360-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(uploads, { recursive: true, force: true });
  });

  it("adds up a buyer's sales, dues, overdue, gross profit and history", async () => {
    const env = await setup();
    const now = new Date();
    const today = localDay(now, env.company.timezone);
    const { a, b, c, paid, quotation, project } = await business(env, now);

    const view = await getBuyer360(env.ctx, env.buyer.id, {}, now);
    expect(view.party).toMatchObject({
      id: env.buyer.id,
      name: "Rahim Traders",
      kind: "BUYER",
      isWalkIn: false,
    });
    expect(view.asOf).toBe(today);
    expect(view.shows).toEqual({ sales: true, profit: true, production: true });
    expect(view.figures).toEqual({
      outstanding: "10120.00", // 10,800 + 4,320 - 5,000
      heldForThem: "0.00",
      sales: {
        total: "15120.00",
        orders: 2,
        pieces: 20,
        averageOrder: "7560.00",
        firstOn: today,
        lastOn: today,
      },
      overdue: { amount: "4320.00", invoices: 1, oldestDays: 10 },
      // 15,120 less 6,000 + 1,800 + 1,000 of goods.
      profit: { gross: "6320.00", cost: "8800.00", marginPct: "41.8" },
    });
    expect(view.topStyles).toEqual([
      {
        id: env.polo.id,
        code: "EX-PL-001",
        name: "Classic Polo",
        orders: 2,
        pieces: 14,
        value: "12420.00",
        sharePct: "82.1",
        profit: "5420.00",
        marginPct: "43.6",
      },
      {
        id: env.tee.id,
        code: "EX-TS-002",
        name: "Basic Tee",
        orders: 1,
        pieces: 6,
        value: "2700.00",
        sharePct: "17.9",
        profit: "900.00",
        marginPct: "33.3",
      },
    ]);

    // History, newest first; Karim Fashion's order is not theirs.
    expect(view.orders!.total).toBe(2);
    expect(view.orders!.items.map((o) => o.number)).toEqual([b.number, a.number]);
    expect(view.orders!.items.map((o) => o.number)).not.toContain(c.number);
    expect(view.orders!.items[0]).toMatchObject({
      total: "4320.00",
      paid: "0.00",
      due: "4320.00",
      invoice: { status: "UNPAID", isOverdue: true },
    });
    expect(view.orders!.items[1]).toMatchObject({
      total: "10800.00",
      paid: "5000.00",
      due: "5800.00",
      invoice: { status: "PARTIALLY_PAID", isOverdue: false },
    });
    expect(view.quotations).toMatchObject({
      total: 1,
      items: [{ id: quotation.id, number: quotation.number, total: "390000.00", itemCount: 1 }],
    });
    expect(view.payments).toMatchObject({
      total: 1,
      totalReceived: "5000.00",
      items: [{ number: paid.number, amount: "5000.00", method: "CASH", voided: false }],
    });
    expect(view.payments!.items[0]!.order).toEqual({ id: a.id, number: a.number });
    expect(view.refunds).toEqual({ total: 0, items: [] });
    expect(view.production).toMatchObject({
      total: 1,
      items: [{ id: project.id, code: project.code, factory: "Gazipur Knit Factory" }],
    });
    expect(view.documents).toEqual({ total: 0, items: [] });
    expect(view.can).toEqual({ print: true });

    // Karim Fashion's own view counts only their order, and has no overdue.
    const karim = await getBuyer360(env.ctx, env.other.id, {}, now);
    expect(karim.figures.sales).toMatchObject({ total: "2700.00", orders: 1, pieces: 3 });
    expect(karim.figures.overdue).toEqual({ amount: "0.00", invoices: 0, oldestDays: null });
    expect(karim.figures.profit).toEqual({ gross: "1200.00", cost: "1500.00", marginPct: "44.4" });
  });

  it("shows each person only the parts their role may see", async () => {
    const env = await setup();
    const now = new Date();
    await business(env, now);

    // Accounts sees everything, like the owner.
    const accounts = await getBuyer360(env.accountsCtx, env.buyer.id, {}, now);
    expect(accounts.shows).toEqual({ sales: true, profit: true, production: true });
    expect(accounts.figures.profit?.gross).toBe("6320.00");

    // A Sales Executive sees the sales and history, but no profit or production.
    const seller = await getBuyer360(env.salesCtx, env.buyer.id, {}, now);
    expect(seller.shows).toEqual({ sales: true, profit: false, production: false });
    expect(seller.figures.sales?.total).toBe("15120.00");
    expect(seller.figures.overdue?.amount).toBe("4320.00");
    expect(seller.figures.profit).toBeNull();
    expect(seller.topStyles!.map((s) => [s.code, s.profit, s.marginPct])).toEqual([
      ["EX-PL-001", null, null],
      ["EX-TS-002", null, null],
    ]);
    expect(seller.orders?.total).toBe(2);
    expect(seller.payments?.total).toBe(1);
    expect(seller.production).toBeNull();

    // The Production Manager sees what they owe and the production, but no sales figures.
    const pm = await getBuyer360(env.pmCtx, env.buyer.id, {}, now);
    expect(pm.shows).toEqual({ sales: false, profit: false, production: true });
    expect(pm.figures).toEqual({
      outstanding: "10120.00",
      heldForThem: "0.00",
      sales: null,
      overdue: null,
      profit: null,
    });
    expect(pm.topStyles).toBeNull();
    expect(pm.orders).toBeNull();
    expect(pm.quotations).toBeNull();
    expect(pm.payments).toBeNull();
    expect(pm.refunds).toBeNull();
    expect(pm.production?.total).toBe(1);
  });

  it("lists one history in full on request, and checks what is asked", async () => {
    const env = await setup();
    const now = new Date();
    await business(env, now);
    const view = await getBuyer360(env.ctx, env.buyer.id, { all: "orders", topStyles: 1 }, now);
    expect(view.orders!.items).toHaveLength(2);
    expect(view.topStyles!.map((s) => s.code)).toEqual(["EX-PL-001"]);
    await expect(
      getBuyer360(env.ctx, env.buyer.id, { all: "salaries" as never }, now),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("answers not found for a supplier or another company's buyer", async () => {
    const env = await setup();
    await expectAppError(getBuyer360(env.ctx, env.factory.id), "NOT_FOUND");
    await expectAppError(getBuyer360(env.ctx, "c000000000000000000000000"), "NOT_FOUND");

    const { company, roles } = await makeCompany("Other Co");
    const outsider = await makeUser("admin@other.test");
    await addToCompany(outsider.id, company.id, roles.SUPER_ADMIN);
    const otherCtx = await contextFor(outsider.id, company.id);
    await expectAppError(getBuyer360(otherCtx, env.buyer.id), "NOT_FOUND");
  });

  it("counts counter and online sales on the Walk-in customers account", async () => {
    const env = await setup();
    const sale = await orders.createOrder(env.ctx, {
      channel: "POS",
      customerName: "Karim Uddin",
      lines: [{ variantId: env.sku(env.polo.id, "White", "M"), quantity: 2 }],
      payment: { amount: 2900, method: "CASH" },
    });
    const walkIn = await prisma.party.findFirstOrThrow({
      where: { companyId: env.company.id, systemRole: "WALK_IN" },
    });
    const view = await getBuyer360(env.ctx, walkIn.id);
    expect(view.party.isWalkIn).toBe(true);
    expect(view.figures.sales).toMatchObject({ total: "2900.00", orders: 1, pieces: 2 });
    expect(view.figures.profit).toEqual({ gross: "1900.00", cost: "1000.00", marginPct: "65.5" });
    expect(view.orders?.items.map((o) => [o.number, o.customerName])).toEqual([
      [sale.number, "Karim Uddin"],
    ]);
    expect(view.payments).toMatchObject({ total: 1, totalReceived: "2900.00" });
    // Walk-in customers get no quotations or production of their own.
    expect(view.quotations).toBeNull();
    expect(view.production).toBeNull();

    // Rahim Traders bought nothing: their figures are all zero.
    const rahim = await getBuyer360(env.ctx, env.buyer.id);
    expect(rahim.figures.sales).toEqual({
      total: "0.00",
      orders: 0,
      pieces: 0,
      averageOrder: null,
      firstOn: null,
      lastOn: null,
    });
    expect(rahim.figures.profit).toEqual({ gross: "0.00", cost: "0.00", marginPct: null });
    expect(rahim.topStyles).toEqual([]);
  });

  it("prints the whole profile as a PDF that opens only for people who may see all of it", async () => {
    const env = await setup();
    const now = new Date();
    const today = localDay(now, env.company.timezone);
    const { a, b, quotation, project } = await business(env, now);

    const owners = await printing.printDocument(env.ctx, {
      type: "BUYER_360",
      partyId: env.buyer.id,
    });
    expect(owners).toMatchObject({
      type: "BUYER_360",
      typeLabel: "Buyer 360° profile",
      title: `Buyer profile: Rahim Traders (${formatDay(today)})`,
      referenceType: "PartyProfile",
      referenceId: env.buyer.id,
      party: { id: env.buyer.id, name: "Rahim Traders" },
      downloadable: true,
      reused: false,
    });
    const row = await prisma.generatedDocument.findUniqueOrThrow({ where: { id: owners.id } });
    expect(row.options).toMatchObject({
      shows: { sales: true, profit: true, production: true },
    });
    const lines = pdfLines((await printing.downloadDocument(env.ctx, owners.id)).bytes);
    const text = lines.join("\n");
    for (const expected of [
      "Rahim Traders (BUY-0001)",
      "15,120.00",
      "7,560.00",
      "10,120.00",
      "4,320.00",
      "6,320.00",
      "41.8%",
      "STYLES BOUGHT MOST",
      "EX-PL-001 · Classic Polo",
      a.number,
      b.number,
      quotation.number,
      project.code,
      "Gazipur Knit Factory",
    ]) {
      expect(text).toContain(expected);
    }

    // Printed documents link it back to the buyer.
    const rows = await reportScreens.listDocumentRows(env.ctx, { type: "BUYER_360" });
    expect(rows.items.map((d) => [d.id, d.typeLabel, d.source])).toEqual([
      [
        owners.id,
        "Buyer 360° profile",
        { href: `/parties/buyers/${env.buyer.id}`, label: "Open the buyer" },
      ],
    ]);

    // Nothing changed: the same copy comes back.
    const again = await printing.printDocument(env.ctx, {
      type: "BUYER_360",
      partyId: env.buyer.id,
    });
    expect(again).toMatchObject({ id: owners.id, reused: true });

    // A Sales Executive's profile leaves out profit and production...
    const sellers = await printing.printDocument(env.salesCtx, {
      type: "BUYER_360",
      partyId: env.buyer.id,
    });
    expect(sellers.id).not.toBe(owners.id);
    const sellerRow = await prisma.generatedDocument.findUniqueOrThrow({
      where: { id: sellers.id },
    });
    expect(sellerRow.options).toMatchObject({
      shows: { sales: true, profit: false, production: false },
    });
    const sellerText = pdfLines(
      (await printing.downloadDocument(env.salesCtx, sellers.id)).bytes,
    ).join("\n");
    expect(sellerText).toContain("15,120.00");
    expect(sellerText).not.toContain("6,320.00");
    expect(sellerText).not.toMatch(/gross profit/i);
    expect(sellerText).not.toContain(project.code);

    // ...and they cannot open the owner's, which shows profit.
    await expectAppError(printing.getDocument(env.salesCtx, owners.id), "FORBIDDEN");
    await expectAppError(printing.downloadDocument(env.salesCtx, owners.id), "FORBIDDEN");
    const sellerList = await printing.listDocuments(env.salesCtx, {});
    expect(sellerList.items.map((d) => d.id)).toEqual([sellers.id]);
    expect(
      (await getBuyer360(env.salesCtx, env.buyer.id, {}, now)).documents!.items.map((d) => d.id),
    ).toEqual([sellers.id]);

    // The Production Manager sees no sales, so neither of those profiles; their own has none.
    const pms = await printing.printDocument(env.pmCtx, {
      type: "BUYER_360",
      partyId: env.buyer.id,
    });
    const pmText = pdfLines((await printing.downloadDocument(env.pmCtx, pms.id)).bytes).join("\n");
    expect(pmText).toContain("10,120.00");
    expect(pmText).toContain(project.code);
    expect(pmText).not.toContain("15,120.00");
    expect(pmText).not.toContain(a.number);
    await expectAppError(printing.getDocument(env.pmCtx, sellers.id), "FORBIDDEN");
    expect(
      (await printing.listDocuments(env.pmCtx, { type: "BUYER_360" })).items.map((d) => d.id),
    ).toEqual([pms.id]);
    // The Sales Executive cannot open the Production Manager's (it shows production).
    await expectAppError(printing.getDocument(env.salesCtx, pms.id), "FORBIDDEN");

    // Accounts and the owner see all three, on the buyer's profile too.
    for (const reader of [env.ctx, env.accountsCtx]) {
      const listed = await printing.listDocuments(reader, { partyId: env.buyer.id });
      expect(new Set(listed.items.map((d) => d.id))).toEqual(
        new Set([owners.id, sellers.id, pms.id]),
      );
      const docs = (await getBuyer360(reader, env.buyer.id, {}, now)).documents!;
      expect(docs.total).toBe(3);
      expect(docs.items[0]).toMatchObject({ type: "BUYER_360", typeLabel: "Buyer 360° profile" });
    }
  });

  it("keeps the same pages apart when they were printed for different readers", async () => {
    const env = await setup();
    await orders.createOrder(env.ctx, {
      channel: "POS",
      customerName: "Karim Uddin",
      lines: [{ variantId: env.sku(env.polo.id, "White", "M"), quantity: 2 }],
      payment: { amount: 2900, method: "CASH" },
    });
    const walkIn = await prisma.party.findFirstOrThrow({
      where: { companyId: env.company.id, systemRole: "WALK_IN" },
    });
    // A role that sees sales and production but no profit. Walk-in customers have no
    // production, so its profile has the same pages as a Sales Executive's.
    const role = await createRole(env.ctx, {
      name: "Sales and production desk",
      permissions: ["parties.view", "sales.view", "production.view"],
    });
    const deskUser = await makeUser("desk@extras.test");
    await addToCompany(deskUser.id, env.company.id, role.id);
    const desk = await contextFor(deskUser.id, env.company.id);

    const deskCopy = await printing.printDocument(desk, { type: "BUYER_360", partyId: walkIn.id });
    const sellerCopy = await printing.printDocument(env.salesCtx, {
      type: "BUYER_360",
      partyId: walkIn.id,
    });
    expect(sellerCopy).toMatchObject({ reused: false });
    expect(sellerCopy.id).not.toBe(deskCopy.id);
    // Each opens their own; the desk's says it may show production, so sales staff cannot.
    await printing.getDocument(env.salesCtx, sellerCopy.id);
    await printing.getDocument(desk, deskCopy.id);
    await printing.getDocument(desk, sellerCopy.id);
    await expectAppError(printing.getDocument(env.salesCtx, deskCopy.id), "FORBIDDEN");
    // Printing again gives each their own kept copy back.
    expect(
      await printing.printDocument(env.salesCtx, { type: "BUYER_360", partyId: walkIn.id }),
    ).toMatchObject({ id: sellerCopy.id, reused: true });
  });

  it("will not print a supplier's profile as a buyer's", async () => {
    const env = await setup();
    await expectAppError(
      printing.printDocument(env.ctx, { type: "BUYER_360", partyId: env.factory.id }),
      "NOT_FOUND",
    );
  });
});
