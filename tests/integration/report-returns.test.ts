import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dayRange, localDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { addDays } from "@/modules/accounts/periods";
import * as logos from "@/modules/companies/logo.service";
import * as compliance from "@/modules/compliance/compliance.service";
import { getDashboardInsights } from "@/modules/dashboard/insights.service";
import {
  ALL_TIME,
  buyerSales,
  buyerTopStyles,
  profitLeaders,
  salesByBucket,
  salesByChannel,
  salesTotals,
  styleSales,
  topBuyers,
  topSellers,
} from "@/modules/dashboard/sales-figures";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as parties from "@/modules/parties/party.service";
import * as reports from "@/modules/reports/export.service";
import * as documents from "@/modules/sales/documents.service";
import * as orders from "@/modules/sales/order.service";
import * as returns from "@/modules/sales/return.service";

import { png } from "../fixtures/images";
import { pdfLines } from "../fixtures/pdf";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const TZ = "Asia/Dhaka";

/**
 * A company with a polo style (Navy M and L, wholesale 900), 10 pcs of each at
 * cost 500, and a wholesale buyer.
 */
async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const admin = await makeUser(`admin@${company.slug}.test`);
  await addToCompany(admin.id, company.id, roles.SUPER_ADMIN);
  const ctx = await contextFor(admin.id, company.id);
  const m = await catalog.createSize(ctx, { name: "M" });
  const l = await catalog.createSize(ctx, { name: "L" });
  const navy = await catalog.createColor(ctx, { name: "Navy", hexCode: "#1f2a44" });
  const tops = await catalog.createCategory(ctx, { name: "Tops" });
  const style = await styles.createStyle(ctx, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    retailPrice: 1450,
    wholesalePrice: 900,
  });
  await matrix.generateMatrix(ctx, style.id, { colorIds: [navy.id], sizeIds: [m.id, l.id] });
  const variants = await prisma.productVariant.findMany({
    where: { styleId: style.id },
    include: { size: true },
  });
  const sku = (size: string) => variants.find((v) => v.size.name === size)!.id;
  for (const v of variants) {
    await stock.adjustStock(ctx, { variantId: v.id, quantity: 10, type: "OPENING", unitCost: 500 });
  }
  const buyer = (await parties.createParty(ctx, { kind: "BUYER", name: "Rahim Traders" })).party;
  return { ctx, company, style, sku, buyer, categoryId: tops.id };
}

type Env = Awaited<ReturnType<typeof setup>>;

/** An invoiced and delivered wholesale order for the buyer. */
async function deliveredOrder(env: Env, quantities: Record<string, number>, discount = 0) {
  const order = await orders.createOrder(env.ctx, {
    channel: "WHOLESALE",
    partyId: env.buyer.id,
    matrix: [{ styleId: env.style.id, quantities }],
    ...(discount ? { discount } : {}),
  });
  const invoice = (await orders.getOrder(env.ctx, order.id)).invoice!;
  await documents.createDeliveryChallan(env.ctx, order.id);
  const line = async (variantId: string) =>
    (
      await prisma.salesOrderItem.findFirstOrThrow({
        where: { orderId: order.id, variantId },
        select: { id: true },
      })
    ).id;
  return { order, invoice, line };
}

const today = () => localDay(new Date(), TZ);
const day = (d: string) => {
  const { start, end } = dayRange(d, d, TZ);
  return { start: start!, end: end! };
};
const figure = (doc: Awaited<ReturnType<typeof reports.previewReport>>, key: string) =>
  doc.sections.find((s) => s.key === key)!;

run("Sales figures less sales returns (v6.4.1 review 3)", () => {
  let uploads = "";
  beforeEach(async () => {
    await resetDb();
    uploads = await mkdtemp(path.join(os.tmpdir(), "report-returns-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(uploads, { recursive: true, force: true });
  });

  it("takes a full return off the month's sales, pieces and top sellers", async () => {
    const env = await setup();
    const { invoice, line } = await deliveredOrder(env, { [env.sku("M")]: 10 });
    await returns.createSalesReturn(env.ctx, {
      invoiceId: invoice.id,
      items: [{ orderItemId: await line(env.sku("M")), quantity: 10 }],
      reason: "All came back",
    });

    const doc = await reports.previewReport(env.ctx, {
      period: "TODAY",
      metrics: "SUMMARY,SALES,TOP_SELLERS",
    });
    const sales = figure(doc, "SALES");
    expect(sales.figures).toEqual([
      { label: "Net sales", value: "0.00", kind: "money" },
      { label: "Invoices", value: 1, kind: "int" },
      { label: "Pieces sold", value: 0, kind: "int" },
      // Per invoice, before the returns.
      { label: "Average invoice", value: "9000.00", kind: "money" },
    ]);
    // The books agree (the return took the sale off the Sales account), so no difference is reported.
    expect(sales.notes).toEqual([
      "Invoiced sales on their invoice date, less sales returns on the day the goods came back, after discounts, without delivery charges or VAT. Void invoices, void returns and cancelled orders are left out.",
      "Sales returns in this period: 1 credit note, 10 pieces, 9,000.00 taken off.",
    ]);
    const byDay = sales.tables.find((t) => t.title === "Sales by day")!;
    expect(byDay.rows).toEqual([
      { cells: [today(), 1, 0, "0.00"] },
      { cells: ["Total", 1, 0, "0.00"], style: "total" },
    ]);
    const byChannel = sales.tables.find((t) => t.title === "Sales by channel")!;
    expect(byChannel.rows[0]!.cells).toEqual(["Wholesale", 1, 0, "0.00", null]);

    const summary = figure(doc, "SUMMARY");
    expect(summary.figures.find((f) => f.label === "Sales")).toMatchObject({
      value: "0.00",
      hint: "1 invoices, 0 pieces",
    });
    expect(summary.tables.find((t) => t.title === "Invoices")!.rows).toEqual([
      { cells: ["Invoices issued", 1, "9000.00"] },
      { cells: ["Sales returns", 1, "-9000.00"] },
      { cells: ["Pieces sold", 0, null] },
      { cells: ["Average invoice (goods value)", null, "9000.00"] },
    ]);

    // Nothing is left sold: no top sellers.
    const top = figure(doc, "TOP_SELLERS");
    expect(top.figures.slice(0, 3)).toEqual([
      { label: "SKUs sold", value: 0, kind: "int" },
      { label: "Pieces sold", value: 0, kind: "int" },
      { label: "Net sales", value: "0.00", kind: "money" },
    ]);
    expect(top.tables.every((t) => t.rows.length === 0)).toBe(true);
    expect(top.notes[0]).toContain("less the pieces that came back in it");
  });

  it("takes a return off in the period it comes back, with its share of the discount", async () => {
    const env = await setup();
    // 6 M + 6 L at 900 = 10,800 less 800 discount: 10,000 (5,000 a line).
    const { invoice, line } = await deliveredOrder(
      env,
      { [env.sku("M")]: 6, [env.sku("L")]: 6 },
      800,
    );
    // The invoice was issued 40 days ago.
    const invoiceDay = addDays(today(), -40);
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { issueDate: day(invoiceDay).start },
    });
    const ret = await returns.createSalesReturn(env.ctx, {
      invoiceId: invoice.id,
      items: [{ orderItemId: await line(env.sku("M")), quantity: 2 }],
      reason: "Wrong colour",
    });
    // 2 × 900 = 1,800 less 800 × 1,800 / 10,800 = 133.33: 1,666.67 off the sales.
    expect([ret.goodsValue, ret.discount].map((d) => d.toFixed(2))).toEqual(["1800.00", "133.33"]);

    const fmt = (t: { orders: number; pieces: number; net: Prisma.Decimal }) => ({
      orders: t.orders,
      pieces: t.pieces,
      net: t.net.toFixed(2),
    });
    // The invoice's day keeps the sale; today carries the return.
    expect(fmt(await salesTotals(env.company.id, day(invoiceDay)))).toEqual({
      orders: 1,
      pieces: 12,
      net: "10000.00",
    });
    expect(fmt(await salesTotals(env.company.id, day(today())))).toEqual({
      orders: 0,
      pieces: -2,
      net: "-1666.67",
    });
    expect(fmt(await salesTotals(env.company.id, ALL_TIME))).toEqual({
      orders: 1,
      pieces: 10,
      net: "8333.33",
    });
    const both = { start: day(invoiceDay).start, end: day(today()).end };
    expect(
      (await salesByBucket(env.company.id, both, TZ, "day")).map((b) => [
        b.bucket,
        ...Object.values(fmt(b)),
      ]),
    ).toEqual([
      [invoiceDay, 1, 12, "10000.00"],
      [today(), 0, -2, "-1666.67"],
    ]);
    expect(
      (await salesByChannel(env.company.id, both)).map((c) => [
        c.channel,
        ...Object.values(fmt(c)),
      ]),
    ).toEqual([["WHOLESALE", 1, 10, "8333.33"]]);

    // Per SKU: M keeps 4 pieces and 5,000 less 1,666.67; L is untouched.
    const top = await topSellers(env.company.id, ALL_TIME, {
      groupBy: "SKU",
      sortBy: "QUANTITY",
      limit: 10,
    });
    expect(
      top.items.map((i) => [i.sizeName, i.pieces, i.orders, i.net.toFixed(2), i.cost.toFixed(2)]),
    ).toEqual([
      ["L", 6, 1, "5000.00", "3000.00"],
      ["M", 4, 1, "3333.33", "2000.00"],
    ]);
    expect(top.totals).toMatchObject({ groups: 2, pieces: 10 });
    expect(top.totals.net.toFixed(2)).toBe("8333.33");
    // Today alone: M only came back, so nothing was sold today.
    const todayTop = await topSellers(env.company.id, day(today()), {
      groupBy: "STYLE",
      sortBy: "QUANTITY",
      limit: 10,
    });
    expect(todayTop.items).toEqual([]);
    expect(todayTop.totals).toMatchObject({ groups: 0, pieces: -2 });
    expect(await topBuyers(env.company.id, day(today()), 5)).toEqual([]);

    // The buyer, the style and the profit leaders see the same.
    const buyer = await buyerSales(env.company.id, { partyId: env.buyer.id });
    expect([buyer.orders, buyer.pieces, buyer.net.toFixed(2), buyer.cost.toFixed(2)]).toEqual([
      1,
      10,
      "8333.33",
      "5000.00",
    ]);
    const [topStyle] = await buyerTopStyles(env.company.id, { partyId: env.buyer.id }, 5);
    expect([topStyle!.orders, topStyle!.pieces, topStyle!.net.toFixed(2)]).toEqual([
      1,
      10,
      "8333.33",
    ]);
    const style = await styleSales(env.company.id, env.style.id);
    expect(fmt(style.wholesale)).toEqual({ orders: 1, pieces: 10, net: "8333.33" });
    const leaders = await profitLeaders(env.company.id, ALL_TIME, 5);
    expect(leaders.buyers.map((b) => [b.id, b.pieces, b.profit.toFixed(2)])).toEqual([
      [env.buyer.id, 10, "3333.33"],
    ]);

    // A voided return gives the sale back.
    await returns.voidSalesReturn(env.ctx, ret.id, { reason: "Recorded by mistake" });
    expect(fmt(await salesTotals(env.company.id, day(today())))).toEqual({
      orders: 0,
      pieces: 0,
      net: "0.00",
    });
    expect(fmt(await salesTotals(env.company.id, ALL_TIME)).net).toBe("10000.00");
  });

  it("keeps shares between 0 and 100 and shows no margin on negative sales when older goods come back (v6.4.1 review 4)", async () => {
    const env = await setup();
    // 8 L invoiced 40 days ago; today 3 M and 2 L are sold, and 6 L of the old invoice come back.
    const old = await deliveredOrder(env, { [env.sku("L")]: 8 });
    await prisma.invoice.update({
      where: { id: old.invoice.id },
      data: { issueDate: day(addDays(today(), -40)).start },
    });
    await deliveredOrder(env, { [env.sku("M")]: 3, [env.sku("L")]: 2 });
    await returns.createSalesReturn(env.ctx, {
      invoiceId: old.invoice.id,
      items: [{ orderItemId: await old.line(env.sku("L")), quantity: 6 }],
      reason: "Late",
    });

    // The totals stay net of the returns (they match the books): 5 sold less 6 back.
    const top = await topSellers(env.company.id, day(today()), {
      groupBy: "SKU",
      sortBy: "QUANTITY",
      limit: 10,
    });
    expect(top.items.map((i) => [i.sizeName, i.pieces])).toEqual([["M", 3]]);
    expect(top.totals).toMatchObject({ groups: 1, pieces: -1, soldPieces: 5 });
    expect(top.totals.net.toFixed(2)).toBe("-900.00");

    // The dashboard: M kept 3 of the 5 pieces sold today (not 3 of -1), and no margin on negative sales.
    const insights = await getDashboardInsights(env.ctx, { period: "TODAY" });
    expect(insights.topSellers.items.map((i) => [i.sizeName, i.sharePct, i.marginPct])).toEqual([
      ["M", "60.0", "44.4"],
    ]);
    expect(insights.topSellers.totals).toMatchObject({
      pieces: -1,
      net: "-900.00",
      marginPct: null,
    });

    // The Report Builder (screen and PDF) says the same.
    const doc = await reports.previewReport(env.ctx, {
      period: "TODAY",
      metrics: "SALES,TOP_SELLERS",
    });
    const section = figure(doc, "TOP_SELLERS");
    const [skus, stylesTable] = section.tables;
    // #, SKU, Product, Color, Size, Pieces, Share, Net sales, Avg price, Margin, In stock.
    expect(skus!.rows.map((r) => [r.cells[4], r.cells[5], r.cells[6], r.cells[9]])).toEqual([
      ["M", 3, "60.0", "44.4"],
    ]);
    // The style kept 3 + 2 - 6 = -1 pieces: not listed.
    expect(stylesTable!.rows).toEqual([]);
    expect(section.figures).toEqual([
      { label: "SKUs sold", value: 1, kind: "int" },
      { label: "Pieces sold", value: -1, kind: "int" },
      { label: "Net sales", value: "-900.00", kind: "money" },
      {
        label: "Gross margin",
        value: null,
        kind: "percent",
        hint: "Estimated from the goods' costs",
      },
    ]);
    expect(section.notes[0]).toContain("Share is each one's pieces out of all pieces invoiced");
    // A channel's share of negative sales is no share either.
    const byChannel = figure(doc, "SALES").tables.find((t) => t.title === "Sales by channel")!;
    expect(byChannel.rows.map((r) => r.cells[4])).toEqual([null, null]);
  });
});

run("Report Builder PDF letterhead (v6.4.1 review 3)", () => {
  let uploads = "";
  beforeEach(async () => {
    await resetDb();
    uploads = await mkdtemp(path.join(os.tmpdir(), "report-logo-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(uploads, { recursive: true, force: true });
  });

  it("prints the company's logo, BIN and trade licence, and still prints without them", async () => {
    const env = await setup();
    const make = async () => {
      const made = await reports.generateReport(env.ctx, {
        format: "PDF",
        period: "TODAY",
        metrics: "SALES",
      });
      expect(made.status).toBe("SUCCEEDED");
      return (await reports.downloadReportExport(env.ctx, made.id)).bytes;
    };

    // No logo and no numbers on file: the PDF is made all the same.
    const plain = await make();
    expect(plain.toString("latin1")).not.toContain("/Subtype /Image");
    expect(pdfLines(plain).some((l) => l.startsWith("BIN:"))).toBe(false);

    await logos.uploadCompanyLogo(env.ctx, {
      fileName: "logo.png",
      bytes: png({ width: 120, height: 40, colorType: 2 }),
    });
    await compliance.createCompliance(env.ctx, {
      type: "VAT_BIN",
      title: "VAT registration",
      number: "000123456-0101",
    });
    await compliance.createCompliance(env.ctx, {
      type: "TRADE_LICENSE",
      title: "Trade licence",
      number: "TRAD/DNCC/123",
      expiryDate: addDays(today(), 200),
    });
    const branded = await make();
    expect(branded.toString("latin1")).toContain("/Subtype /Image");
    const lines = pdfLines(branded);
    expect(lines).toContain("BIN: 000123456-0101");
    expect(lines).toContain("Trade licence: TRAD/DNCC/123");
    expect(lines).toContain("Extras");
  });
});
