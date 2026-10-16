import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { buildDocument } from "@/modules/documents/builders";
import type { Block, PrintDocument } from "@/modules/documents/model";
import { firstPage } from "@/modules/documents/parts";
import * as printing from "@/modules/documents/print.service";
import { printRequestSchema } from "@/modules/documents/schemas";
import { storedFileExists } from "@/modules/files/file.service";
import * as employees from "@/modules/hr/employee.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as ledger from "@/modules/parties/ledger.service";
import * as parties from "@/modules/parties/party.service";
import * as documents from "@/modules/sales/documents.service";
import * as orders from "@/modules/sales/order.service";
import * as payments from "@/modules/sales/payment.service";
import * as screens from "@/modules/sales/screens.service";

import { pdfLines } from "../fixtures/pdf";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/**
 * A company with a polo (Navy / White x S M L XL, wholesale 900), 10 pcs of
 * each SKU at cost 500, the buyer Rahim Traders, a packer, and a Super Admin,
 * a Sales Executive and Accounts.
 */
async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const person = async (role: keyof typeof roles, email: string) => {
    const user = await makeUser(`${email}@${company.slug}.test`);
    await addToCompany(user.id, company.id, roles[role]);
    return contextFor(user.id, company.id);
  };
  const ctx = await person("SUPER_ADMIN", "admin");
  const salesCtx = await person("SALES_EXECUTIVE", "sales");
  const accountsCtx = await person("ACCOUNTS", "accounts");

  const sizes = [];
  for (const name of ["S", "M", "L", "XL"]) sizes.push(await catalog.createSize(ctx, { name }));
  const navy = await catalog.createColor(ctx, { name: "Navy", hexCode: "#1F2A44" });
  const white = await catalog.createColor(ctx, { name: "White", hexCode: "#FFFFFF" });
  const tops = await catalog.createCategory(ctx, { name: "Tops" });
  const style = await styles.createStyle(ctx, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    wholesalePrice: 900,
  });
  await matrix.generateMatrix(ctx, style.id, {
    colorIds: [navy.id, white.id],
    sizeIds: sizes.map((s) => s.id),
  });
  const variants = await prisma.productVariant.findMany({
    where: { styleId: style.id },
    include: { color: true, size: true },
  });
  const sku = (color: string, size: string) =>
    variants.find((v) => v.color.name === color && v.size.name === size)!.id;
  for (const v of variants) {
    await stock.adjustStock(ctx, { variantId: v.id, quantity: 10, type: "OPENING", unitCost: 500 });
  }
  const buyer = (
    await parties.createParty(ctx, {
      kind: "BUYER",
      name: "Rahim Traders",
      phone: "01711223344",
      paymentTermsDays: 30,
    })
  ).party;
  const packer = await employees.createEmployee(ctx, {
    name: "Karim Packer",
    joinDate: "2025-01-01",
    salary: 15000,
  });
  return { ctx, salesCtx, accountsCtx, company, style, sku, buyer, packer, variants };
}

type Env = Awaited<ReturnType<typeof setup>>;

/** Navy S / M / L / XL = 2 / 4 / 4 / 2 at 900 (12 pcs, 10,800), invoiced at once. */
const navyOrder = (env: Env, extra: Record<string, unknown> = {}) =>
  orders.createOrder(env.ctx, {
    channel: "WHOLESALE",
    partyId: env.buyer.id,
    matrix: [
      {
        styleId: env.style.id,
        quantities: {
          [env.sku("Navy", "S")]: 2,
          [env.sku("Navy", "M")]: 4,
          [env.sku("Navy", "L")]: 4,
          [env.sku("Navy", "XL")]: 2,
        },
      },
    ],
    ...extra,
  });

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

const build = (env: Env, invoiceId: string) =>
  buildDocument(
    env.ctx,
    printRequestSchema.parse({ type: "COMMERCIAL_INVOICE", id: invoiceId }),
    new Date(),
  );

const kinds = (model: PrintDocument) => model.blocks.map((b) => b.kind);
const tables = (blocks: Block[]) =>
  blocks.filter((b): b is Extract<Block, { kind: "table" }> => b.kind === "table");

const balanceOf = async (env: Env, partyId: string) =>
  (await ledger.getPartyBalance(env.ctx, partyId)).toFixed(2);

/** An account's debits less its credits. */
async function accountNet(companyId: string, key: "SALES" | "COGS" | "INVENTORY") {
  const accounts = await ensureControlAccounts(companyId);
  const agg = await prisma.journalLine.aggregate({
    where: { accountId: accounts[key], entry: { companyId } },
    _sum: { debit: true, credit: true },
  });
  const zero = new Prisma.Decimal(0);
  return (agg._sum.debit ?? zero).minus(agg._sum.credit ?? zero).toFixed(2);
}

async function expectBooksBalanced(companyId: string) {
  const rows = await prisma.$queryRaw<Array<{ number: string }>>`
    SELECT je.number FROM "JournalEntry" je JOIN "JournalLine" jl ON jl."entryId" = je.id
    WHERE je."companyId" = ${companyId}
    GROUP BY je.id HAVING SUM(jl.debit) <> SUM(jl.credit)`;
  expect(rows).toEqual([]);
}

const cell = async (env: Env, variantId: string) =>
  (await stock.stockByVariant(env.ctx, [variantId])).get(variantId)!;

run("invoice PDF, picture and hub", () => {
  let uploads: string;

  beforeEach(async () => {
    await resetDb();
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-invoice-hub-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(uploads, { recursive: true, force: true });
  });

  it("prints the packing list as page 2 only when the order has one", async () => {
    const env = await setup();
    const plain = await navyOrder(env);
    const single = await build(env, plain.invoice!.id);
    // Page 1: lines by style and colour with their sizes, totals, signed at its foot.
    expect(kinds(single.model)).toEqual(["table", "totals", "signatures"]);
    expect(single.model.signatures).toEqual([]);
    expect(tables(single.model.blocks)[0]!.rows).toEqual([
      {
        cells: ["1", "Classic Polo – Navy", "12", "900.00", "10,800.00"],
        details: ["EX-PL-001 · Sizes: S 2 · M 4 · L 4 · XL 2"],
      },
    ]);
    expect(firstPage(single.model)).toEqual(single.model);

    const packed = await orders.createOrder(env.ctx, {
      channel: "WHOLESALE",
      partyId: env.buyer.id,
      totalCartons: 3,
      packedById: env.packer.id,
      matrix: [
        {
          styleId: env.style.id,
          quantities: {
            [env.sku("Navy", "S")]: 2,
            [env.sku("Navy", "M")]: 3,
            [env.sku("White", "M")]: 5,
            [env.sku("White", "XL")]: 1,
          },
        },
      ],
      documents: { invoice: true, packingList: true },
    });
    const list = await prisma.packingList.findUniqueOrThrow({ where: { orderId: packed.id } });
    const built = await build(env, packed.invoice!.id);
    expect(kinds(built.model)).toEqual([
      "table",
      "totals",
      "signatures",
      "pageBreak",
      "heading",
      "figures",
      "table",
      "note",
      "signatures",
    ]);
    const [, page2] = [built.model.blocks.slice(0, 3), built.model.blocks.slice(4)];
    expect(page2[0]).toMatchObject({ kind: "heading", title: "Packing List" });
    expect(page2[1]).toEqual({
      kind: "figures",
      figures: [
        { label: "Packing list no.", value: list.number },
        { label: "Total cartons", value: "3" },
        { label: "Packed by", value: "Karim Packer" },
        { label: "Total pieces", value: "11" },
      ],
    });
    // The size matrix: a row per colour, a column per size in size order, totals under.
    const matrixTable = tables(page2)[0]!;
    expect(matrixTable.title).toBe("EX-PL-001 · Classic Polo");
    expect(matrixTable.columns.map((c) => c.label)).toEqual([
      "Colour",
      "S",
      "M",
      "XL",
      "Total pcs",
    ]);
    expect(matrixTable.rows).toEqual([
      { cells: ["Navy", "2", "3", "–", "5"], swatch: "#1F2A44" },
      { cells: ["White", "–", "5", "1", "6"], swatch: "#FFFFFF" },
      { cells: ["Total", "2", "8", "1", "11"], style: "total" },
    ]);
    expect(page2.at(-1)).toEqual({ kind: "signatures", labels: ["Packed by", "Checked by"] });
    // Page 1 alone is what the picture shows.
    expect(kinds(firstPage(built.model))).toEqual(["table", "totals", "signatures"]);

    const printed = await printing.printDocument(env.ctx, {
      type: "COMMERCIAL_INVOICE",
      id: packed.invoice!.id,
    });
    const lines = pdfLines((await printing.downloadDocument(env.ctx, printed.id)).bytes);
    for (const text of [
      "COMMERCIAL INVOICE",
      "Customer signature",
      "PACKING LIST",
      "TOTAL CARTONS",
      "PACKED BY",
      "Karim Packer",
      "EX-PL-001 · CLASSIC POLO",
      "Checked by",
      `${packed.invoice!.number} · Page 2 of 2`,
    ]) {
      expect(lines).toContain(text);
    }
  });

  it("gives page 1 to draw as a picture, keeping nothing on the server", async () => {
    const env = await setup();
    const order = await navyOrder(env, { documents: { invoice: true, packingList: true } });
    const before = await prisma.fileAsset.count();
    const picture = await printing.documentPicture(env.salesCtx, {
      type: "COMMERCIAL_INVOICE",
      id: order.invoice!.id,
    });
    expect(picture.fileName).toBe(`Extras - Invoice ${order.invoice!.number}.jpg`);
    expect(picture.logo).toBeNull();
    expect(kinds(picture.model)).toEqual(["table", "totals", "signatures"]);
    expect(picture.model.reference).toBe(order.invoice!.number);
    expect(await prisma.fileAsset.count()).toBe(before);
    expect(await prisma.generatedDocument.count()).toBe(0);
    const logged = await prisma.auditLog.findFirst({
      where: { action: "EXPORT", entityId: order.invoice!.id },
    });
    expect(logged?.summary).toBe(
      `Made a picture of page 1 to share: Invoice ${order.invoice!.number}`,
    );

    await expectAppError(
      printing.documentPicture(env.ctx, { type: "LEDGER_STATEMENT", partyId: env.buyer.id }),
      "VALIDATION",
    );
  });

  it("revises an unpaid or part-paid invoice under the same number, and locks a paid one", async () => {
    const env = await setup();
    const order = await navyOrder(env, {
      documents: { invoice: true, packingList: true },
      payment: { amount: 3000, method: "CASH" },
    });
    const invoice = order.invoice!;
    const list = await prisma.packingList.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(order.status).toBe("PACKED");
    const lines = {
      matrix: [
        {
          styleId: env.style.id,
          quantities: {
            [env.sku("Navy", "S")]: 2,
            [env.sku("Navy", "M")]: 4,
            [env.sku("Navy", "L")]: 4,
            [env.sku("Navy", "XL")]: 2,
            [env.sku("White", "S")]: 3,
          },
        },
      ],
    };

    // Without saying so, an invoiced order is not edited (as before).
    const plain = await expectAppError(orders.updateOrder(env.ctx, order.id, lines), "CONFLICT");
    expect(plain.message).toBe(`Void invoice ${invoice.number} before editing the order.`);
    // Revising needs the invoice edit key, which Sales Executives do not have.
    await expectAppError(
      orders.updateOrder(env.salesCtx, order.id, { ...lines, reviseInvoice: true }),
      "FORBIDDEN",
    );

    const edited = await orders.updateOrder(env.ctx, order.id, { ...lines, reviseInvoice: true });
    expect(edited.total.toFixed(2)).toBe("13500.00");
    expect(edited.status).toBe("PACKED");
    const revised = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(revised).toMatchObject({
      number: invoice.number,
      revision: 1,
      status: "PARTIALLY_PAID",
    });
    expect(revised.revisedAt).not.toBeNull();
    expect(revised.total.toFixed(2)).toBe("13500.00");
    expect(revised.paidAmount.toFixed(2)).toBe("3000.00");
    expect(revised.dueAmount.toFixed(2)).toBe("10500.00");
    expect(await balanceOf(env, env.buyer.id)).toBe("10500.00");
    expect(await accountNet(env.company.id, "SALES")).toBe("-13500.00");
    // The sale was reversed on the invoice's own date and posted again.
    const entries = await prisma.journalEntry.findMany({
      where: { sourceType: "SALE", sourceId: invoice.id },
      orderBy: { number: "asc" },
    });
    expect(entries.map((e) => [e.isReversed, e.reversalOfId !== null])).toEqual([
      [true, false],
      [false, true],
      [false, false],
    ]);
    expect(entries[1]!.date.toISOString()).toBe(revised.issueDate.toISOString());
    // The packing list keeps its number with the new lines.
    const relisted = await prisma.packingList.findUniqueOrThrow({
      where: { orderId: order.id },
      include: { items: true },
    });
    expect(relisted.number).toBe(list.number);
    expect(relisted.items.reduce((s, i) => s + i.quantity, 0)).toBe(15);
    expect((await cell(env, env.sku("White", "S"))).reserved).toBe(3);
    const audit = await prisma.auditLog.findFirst({
      where: { action: "INVOICE_EDIT", entityId: invoice.id },
    });
    expect(audit?.summary).toBe(
      `Revised invoice ${invoice.number} (revision 1): 10800.00 to 13500.00`,
    );

    // The PDF says so.
    const built = await build(env, invoice.id);
    expect(built.model.title).toBe("Commercial Invoice (Revised)");
    expect(built.model.meta.map((m) => m.label)).toContain("Revised");
    expect(built.model.reference).toBe(invoice.number);

    // Never below what was paid.
    await expectAppError(
      orders.updateOrder(env.ctx, order.id, {
        matrix: [{ styleId: env.style.id, quantities: { [env.sku("Navy", "S")]: 1 } }],
        reviseInvoice: true,
      }),
      "VALIDATION",
    );

    // Paid in full: locked, on screen too.
    await payments.receivePayment(env.accountsCtx, {
      orderId: order.id,
      amount: 10500,
      method: "CASH",
    });
    const locked = await expectAppError(
      orders.updateOrder(env.ctx, order.id, { ...lines, reviseInvoice: true }),
      "CONFLICT",
    );
    expect(locked.message).toContain("fully paid");
    const screen = await screens.getInvoiceScreen(env.ctx, invoice.id);
    expect(screen.can.edit).toBe(false);
    expect(screen.notes.edit).toContain("fully paid");
    expect(screen.invoice.revision).toBe(1);
    await expectBooksBalanced(env.company.id);

    // A void re-issued is a new invoice: no longer revised.
    await documents.voidInvoice(env.ctx, invoice.id, { reason: "Start again" });
    const reissued = await documents.issueInvoice(env.ctx, order.id);
    expect(reissued.revision).toBe(0);
    expect(reissued.revisedAt).toBeNull();
  });

  it("refuses a due day before the invoice date, as the screen does (the same day is fine)", async () => {
    const env = await setup();
    const order = await navyOrder(env);
    await documents.voidInvoice(env.ctx, order.invoice!.id, { reason: "Start again" });
    const early = await expectAppError(
      documents.issueInvoice(env.ctx, order.id, {
        issueDate: new Date("2026-10-09T06:00:00Z"),
        dueDate: new Date("2026-10-03T06:00:00Z"),
      }),
      "VALIDATION",
    );
    expect(early.details?.dueDate?.[0]).toBe("Choose a day on or after the invoice date.");
    // 02:00 in Dhaka on the invoice's own day: earlier in the day, still the same day.
    const sameDay = await documents.issueInvoice(env.ctx, order.id, {
      issueDate: new Date("2026-10-09T06:00:00Z"),
      dueDate: new Date("2026-10-08T20:00:00Z"),
    });
    expect(sameDay.dueDate).toEqual(new Date("2026-10-08T20:00:00Z"));
  });

  it("voids and cancels after delivery: stock back at cost, sale and cost of goods reversed", async () => {
    const env = await setup();
    const opening = await accountNet(env.company.id, "INVENTORY");
    const order = await navyOrder(env, {
      documents: { invoice: true, packingList: true, deliveryChallan: true },
      payment: { amount: 4000, method: "CASH" },
    });
    expect(order.status).toBe("DELIVERED");
    expect((await cell(env, env.sku("Navy", "M"))).aGrade).toBe(6);
    // Later stock at another cost re-weights the average meanwhile.
    await stock.adjustStock(env.ctx, {
      variantId: env.sku("Navy", "M"),
      quantity: 6,
      type: "OPENING",
      unitCost: 700,
    });

    // Delivered goods are not taken back without asking, nor by a Sales Executive.
    await expectAppError(orders.cancelOrder(env.ctx, order.id, { reason: "Returned" }), "CONFLICT");
    await expectAppError(
      orders.cancelOrder(env.salesCtx, order.id, {
        reason: "Returned",
        returnDelivered: true,
      }),
      "FORBIDDEN",
    );

    const voided = await orders.voidOrCancelInvoice(env.ctx, order.invoice!.id, {
      reason: "Buyer sent everything back",
      cancelOrder: true,
      settle: { kind: "CREDIT" },
    });
    expect(voided.status).toBe("VOID");
    const after = await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("CANCELLED");
    for (const size of ["S", "M", "L", "XL"]) {
      const c = await cell(env, env.sku("Navy", size));
      expect(c.reserved, size).toBe(0);
    }
    expect((await cell(env, env.sku("Navy", "S"))).aGrade).toBe(10);
    expect((await cell(env, env.sku("Navy", "M"))).aGrade).toBe(16);
    const restocked = await prisma.stockMovement.findMany({
      where: { type: "RETURN_RESTOCK", referenceId: order.id },
    });
    expect(restocked.reduce((s, m) => s + m.quantity, 0)).toBe(12);
    expect(restocked.every((m) => m.unitCost?.toFixed(2) === "500.00")).toBe(true);
    // Navy M: 6 left at 500 and 6 more at 700 make 12 at 600; 4 back at 500 make 16 at 575.
    const navyM = await prisma.productVariant.findUniqueOrThrow({
      where: { id: env.sku("Navy", "M") },
    });
    expect(navyM.avgCost.toFixed(2)).toBe("575.00");
    expect(await accountNet(env.company.id, "COGS")).toBe("0.00");
    expect(await accountNet(env.company.id, "SALES")).toBe("0.00");
    // Opening stock plus the 6 pieces at 700.
    expect(await accountNet(env.company.id, "INVENTORY")).toBe((Number(opening) + 4200).toFixed(2));
    // The 4,000 paid stays as the buyer's credit.
    expect(await balanceOf(env, env.buyer.id)).toBe("-4000.00");
    const audit = await prisma.auditLog.findFirst({
      where: { action: "STATUS_CHANGE", entityId: order.id },
    });
    expect(audit?.summary).toContain("12 delivered pcs back in stock");
    await expectBooksBalanced(env.company.id);
  });

  it("frees only the undelivered pieces of a part-delivered order", async () => {
    const env = await setup();
    const order = await navyOrder(env);
    await documents.createDeliveryChallan(env.ctx, order.id, {
      items: [{ variantId: env.sku("Navy", "S"), quantity: 2 }],
    });
    expect((await cell(env, env.sku("Navy", "S"))).aGrade).toBe(8);
    expect((await cell(env, env.sku("Navy", "M"))).reserved).toBe(4);
    // Keeping the order: only the invoice is voided, as before.
    const kept = await orders.voidOrCancelInvoice(env.ctx, order.invoice!.id, {
      reason: "Wrong price agreed",
    });
    expect(kept.status).toBe("VOID");
    expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "PROCESSING",
    );
    expect((await cell(env, env.sku("Navy", "M"))).reserved).toBe(4);

    await orders.cancelOrder(env.ctx, order.id, { reason: "Buyer gave up", returnDelivered: true });
    expect(await cell(env, env.sku("Navy", "S"))).toMatchObject({ aGrade: 10, reserved: 0 });
    expect(await cell(env, env.sku("Navy", "M"))).toMatchObject({ aGrade: 10, reserved: 0 });
    await expectBooksBalanced(env.company.id);
  });

  it("shows the hub what each person may do", async () => {
    const env = await setup();
    const order = await navyOrder(env, {
      documents: { invoice: true, packingList: true },
      payment: { amount: 2000, method: "CASH" },
    });
    const owner = await screens.getInvoiceScreen(env.ctx, order.invoice!.id);
    expect(owner.can).toMatchObject({ edit: true, void: true, share: true, receive: true });
    expect(owner.voidChoice).toEqual({
      cancel: true,
      delivered: 0,
      held: "2000.00",
      settleKinds: ["CASH", "CREDIT", "FORFEIT"],
      note: null,
    });
    expect(owner.invoice.packingList).toMatchObject({ pieces: 12, packedBy: null });
    expect(owner.notes.edit).toBeNull();

    const seller = await screens.getInvoiceScreen(env.salesCtx, order.invoice!.id);
    expect(seller.can).toMatchObject({ edit: false, void: false, share: true, receive: false });
    expect(seller.voidChoice).toBeNull();
    expect(seller.notes.edit).toBeNull();

    // The edit form opens in revise mode for the owner only.
    const form = await screens.getOrderForm(env.ctx, { orderId: order.id });
    expect(form.order?.invoice).toEqual({
      number: order.invoice!.number,
      status: "PARTIALLY_PAID",
      revision: 0,
    });
    await expectAppError(screens.getOrderForm(env.salesCtx, { orderId: order.id }), "CONFLICT");
  });

  it("deletes kept sales PDFs after a day; printing again makes a fresh copy", async () => {
    const env = await setup();
    const order = await navyOrder(env);
    const invoice = await printing.printDocument(env.ctx, {
      type: "COMMERCIAL_INVOICE",
      id: order.invoice!.id,
    });
    const letterhead = await printing.printDocument(env.ctx, { type: "LETTERHEAD" });
    const kept = await prisma.generatedDocument.findUniqueOrThrow({
      where: { id: invoice.id },
      include: { file: true },
    });
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await prisma.fileAsset.updateMany({ data: { createdAt: old } });

    expect(await printing.purgeKeptSalesPdfs(new Date(Date.now() - 36 * 60 * 60 * 1000))).toBe(0);
    expect(await printing.purgeKeptSalesPdfs()).toBe(1);
    expect(await storedFileExists(kept.file!)).toBe(false);
    expect((await printing.getDocument(env.ctx, invoice.id)).downloadable).toBe(false);
    // Other documents keep their file.
    expect((await printing.getDocument(env.ctx, letterhead.id)).downloadable).toBe(true);

    const again = await printing.printDocument(env.ctx, {
      type: "COMMERCIAL_INVOICE",
      id: order.invoice!.id,
    });
    expect(again).toMatchObject({ id: invoice.id, reused: false, downloadable: true });
    expect(await printing.purgeKeptSalesPdfs()).toBe(0);
  });
});
