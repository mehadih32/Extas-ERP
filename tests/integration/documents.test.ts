import { access, mkdtemp, readdir, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addDays, localDay, nextDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { formatDay } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import * as logos from "@/modules/companies/logo.service";
import * as compliance from "@/modules/compliance/compliance.service";
import { buildDocument, drCr } from "@/modules/documents/builders";
import { type Block, type PrintDocument, TICK } from "@/modules/documents/model";
import * as printing from "@/modules/documents/print.service";
import { printRequestSchema } from "@/modules/documents/schemas";
import { uploadRoot } from "@/modules/files/file.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as ledger from "@/modules/parties/ledger.service";
import * as parties from "@/modules/parties/party.service";
import * as documents from "@/modules/sales/documents.service";
import * as orders from "@/modules/sales/order.service";
import * as payments from "@/modules/sales/payment.service";
import * as proformas from "@/modules/sales/proforma.service";
import * as quotations from "@/modules/sales/quotation.service";
import * as refunds from "@/modules/sales/refund.service";

import { png } from "../fixtures/images";
import { pdfLines } from "../fixtures/pdf";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const ROLES = [
  "SUPER_ADMIN",
  "SALES_EXECUTIVE",
  "ACCOUNTS",
  "WAREHOUSE_TEAM",
  "PRODUCTION_MANAGER",
  "EMPLOYEE",
] as const;

/**
 * A company with letterhead details, one person per built-in role, the brand
 * "Extras Men" with a polo (Navy / White x S M L XL, 10 pcs each, wholesale 900)
 * and a tee with no stock, and the buyer Rahim Traders.
 */
async function setup(name = "Extras") {
  const { company, roles } = await makeCompany(name);
  await prisma.company.update({
    where: { id: company.id },
    data: {
      legalName: `${name} Fashion Ltd.`,
      address: "House 12, Road 5, Dhanmondi\nDhaka 1205",
      phone: "01711-000000",
      website: `${company.slug}.test`,
    },
  });
  const as = {} as Record<(typeof ROLES)[number], CompanyContext>;
  for (const role of ROLES) {
    const user = await makeUser(`${role.toLowerCase()}@${company.slug}.test`);
    await addToCompany(user.id, company.id, roles[role]);
    as[role] = await contextFor(user.id, company.id);
  }
  const ctx = as.SUPER_ADMIN;

  const sizes = [];
  for (const size of ["S", "M", "L", "XL"])
    sizes.push(await catalog.createSize(ctx, { name: size }));
  const navy = await catalog.createColor(ctx, { name: "Navy", hexCode: "#1F2A44" });
  const white = await catalog.createColor(ctx, { name: "White", hexCode: "#FFFFFF" });
  const tops = await catalog.createCategory(ctx, { name: "Tops" });
  const brand = await catalog.createBrand(ctx, { name: "Extras Men" });
  const polo = await styles.createStyle(ctx, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    brandId: brand.id,
    retailPrice: 1450,
    wholesalePrice: 900,
  });
  await matrix.generateMatrix(ctx, polo.id, {
    colorIds: [navy.id, white.id],
    sizeIds: sizes.map((s) => s.id),
  });
  const tee = await styles.createStyle(ctx, {
    code: "EX-TS-002",
    name: "Basic Tee",
    categoryId: tops.id,
    brandId: brand.id,
    wholesalePrice: 400,
  });
  await matrix.generateMatrix(ctx, tee.id, {
    colorIds: [white.id],
    sizeIds: [sizes[0]!.id, sizes[1]!.id],
  });
  const variants = await prisma.productVariant.findMany({
    where: { styleId: polo.id },
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
      contactPerson: "Abdur Rahim",
      phone: "01711223344",
      address: "Mirpur 10, Dhaka",
      taxId: "BIN-0042",
      paymentTermsDays: 30,
    })
  ).party;
  return { as, ctx, company, brand, polo, tee, tops, sku, buyer };
}

type Env = Awaited<ReturnType<typeof setup>>;

/** Navy S / M / L / XL = 2 / 4 / 4 / 2 at 900: 12 pieces, 10,800 taka, invoiced at once. */
const sellPolo = (env: Env) =>
  orders.createOrder(env.ctx, {
    channel: "WHOLESALE",
    partyId: env.buyer.id,
    matrix: [
      {
        styleId: env.polo.id,
        quantities: {
          [env.sku("Navy", "S")]: 2,
          [env.sku("Navy", "M")]: 4,
          [env.sku("Navy", "L")]: 4,
          [env.sku("Navy", "XL")]: 2,
        },
      },
    ],
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

const build = (ctx: CompanyContext, request: unknown, now = new Date()) =>
  buildDocument(ctx, printRequestSchema.parse(request), now);

const tables = (model: PrintDocument) =>
  model.blocks.filter((b): b is Extract<Block, { kind: "table" }> => b.kind === "table");

/** Everything printed on the page, as one string (column widths left out). */
const printedText = (model: PrintDocument) =>
  JSON.stringify(model, (key, value: unknown) => (key === "weight" ? undefined : value));

const notes = (model: PrintDocument) =>
  model.blocks.flatMap((b) => (b.kind === "note" ? [b.text] : []));

/** The figure cards as [label, value, hint]. */
const figures = (model: PrintDocument) =>
  model.blocks.flatMap((b) =>
    b.kind === "figures" ? b.figures.map((f) => [f.label, f.value, f.hint ?? ""]) : [],
  );

const linesOf = async (ctx: CompanyContext, documentId: string) =>
  pdfLines((await printing.downloadDocument(ctx, documentId)).bytes);

/** PDF files kept on disk for a company, by folder (documents, logos...). */
async function storedFiles(companyId: string, folder: string) {
  const dir = path.join(uploadRoot(), companyId, folder);
  const entries = await readdir(dir, { recursive: true }).catch(() => [] as string[]);
  return entries.filter((name) => /\.(pdf|png|jpg)$/.test(name));
}

run("printed documents", () => {
  let uploads: string;

  beforeEach(async () => {
    await resetDb();
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-documents-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(uploads, { recursive: true, force: true });
  });

  it("prints each document on the letterhead and keeps the PDF", async () => {
    const env = await setup();
    const seller = env.as.SALES_EXECUTIVE;
    const today = localDay(new Date(), env.company.timezone);

    // Quotation
    const q = await quotations.createQuotation(env.ctx, {
      partyId: env.buyer.id,
      validUntil: "2099-12-31",
      items: [
        {
          categoryId: env.tops.id,
          styleId: env.polo.id,
          description: "Pique polo with tipping",
          fabric: "100% cotton pique",
          sizeBreakdown: { S: 100, M: 200, L: 200, XL: 100 },
          unitPrice: 650,
        },
      ],
      stylingRules: [{ area: "Placket", instruction: "No black border on the placket" }],
      discount: 1500,
      terms: "50% advance, balance before delivery.",
    });
    const quotation = await printing.printDocument(seller, { type: "QUOTATION", id: q.id });
    expect(quotation).toMatchObject({
      type: "QUOTATION",
      typeLabel: "Quotation",
      title: `Quotation ${q.number}`,
      referenceType: "Quotation",
      referenceId: q.id,
      party: { id: env.buyer.id, name: "Rahim Traders" },
      downloadable: true,
      fileName: `Extras - Quotation ${q.number}.pdf`,
      generatedBy: { id: seller.user.id },
      reused: false,
    });
    const file = await printing.downloadDocument(seller, quotation.id);
    expect(file).toMatchObject({ mimeType: "application/pdf", fileName: quotation.fileName });
    expect(file.bytes.length).toBe(quotation.sizeBytes);
    let lines = pdfLines(file.bytes);
    for (const text of [
      "Extras",
      "EXTRAS FASHION LTD.",
      "Dhaka 1205",
      "QUOTATION",
      q.number,
      "VALID UNTIL",
      "31 Dec 2099",
      "PREPARED FOR",
      "Rahim Traders",
      "Attn: Abdur Rahim",
      "BIN / Tax ID: BIN-0042",
      "Pique polo with tipping",
      "Style: EX-PL-001 Classic Polo · Category: Tops",
      "Fabric: 100% cotton pique",
      "Sizes: S 100 · M 200 · L 200 · XL 100",
      "3,90,000.00",
      "-1,500.00",
      "3,88,500.00",
      "STYLING INSTRUCTIONS",
      "Placket:",
      "No black border on the placket",
      "50% advance, balance before delivery.",
      "Authorised signature",
      "Extras Fashion Ltd. · extras.test",
    ]) {
      expect(lines).toContain(text);
    }
    expect(lines.some((l) => l.startsWith("In words: "))).toBe(true);

    // Kept as a file the app made, under the company's documents folder.
    const asset = await prisma.fileAsset.findFirstOrThrow({
      where: { generatedDocuments: { some: { id: quotation.id } } },
    });
    expect(asset.uploadedById).toBeNull();
    expect(asset.storagePath.startsWith(`${env.company.id}/documents/`)).toBe(true);
    expect(
      (
        await prisma.auditLog.findMany({
          where: { entityType: "GeneratedDocument", entityId: quotation.id },
          orderBy: { createdAt: "asc" },
        })
      ).map((a) => [a.action, a.userId, a.summary]),
    ).toEqual([
      ["EXPORT", seller.user.id, `Made PDF: Quotation ${q.number}`],
      ["EXPORT", seller.user.id, `Downloaded PDF: Quotation ${q.number}`],
    ]);

    // Proforma invoice with part of the advance received
    const pi = await proformas.convertQuotationToProforma(env.ctx, q.id);
    await payments.receivePayment(env.as.ACCOUNTS, {
      proformaId: pi.id,
      amount: 50000,
      method: "BANK_TRANSFER",
      reference: "DBBL-7781",
    });
    const proforma = await printing.printDocument(seller, { type: "PROFORMA_INVOICE", id: pi.id });
    expect(proforma).toMatchObject({
      title: `Proforma invoice ${pi.number}`,
      referenceType: "ProformaInvoice",
    });
    lines = await linesOf(seller, proforma.id);
    for (const text of [
      "PROFORMA INVOICE",
      pi.number,
      q.number,
      "BILL TO",
      "BIN / Tax ID: BIN-0042",
      "Style: EX-PL-001 Classic Polo · Category: Tops",
      "Advance (30%)",
      "1,16,550.00",
      "50,000.00",
      "66,550.00",
      "3,38,500.00",
      "PAYMENTS RECEIVED",
      "Bank transfer",
      "DBBL-7781",
      "Production starts when the advance is received.",
    ]) {
      expect(lines).toContain(text);
    }

    // Commercial invoice with a payment
    const order = await sellPolo(env);
    const invoiceNumber = order.invoice!.number;
    await payments.receivePayment(env.as.ACCOUNTS, {
      orderId: order.id,
      amount: 4000,
      method: "BKASH",
      reference: "TRX123",
    });
    const invoice = await printing.printDocument(seller, {
      type: "COMMERCIAL_INVOICE",
      id: order.invoice!.id,
    });
    expect(invoice).toMatchObject({
      title: `Invoice ${invoiceNumber}`,
      referenceType: "Invoice",
      referenceId: order.invoice!.id,
      fileName: `Extras - Invoice ${invoiceNumber}.pdf`,
    });
    lines = await linesOf(seller, invoice.id);
    for (const text of [
      "COMMERCIAL INVOICE",
      invoiceNumber,
      order.number,
      "Classic Polo – Navy / S",
      "EX-PL-001-NAVY-S",
      "900.00",
      "3,600.00",
      "10,800.00",
      "4,000.00",
      "6,800.00",
      "bKash",
      "TRX123",
      "Customer signature",
      "Authorised signature",
    ]) {
      expect(lines).toContain(text);
    }
    expect(lines).not.toContain("PAID");

    // Delivery challan: quantities only
    const challan = await documents.createDeliveryChallan(env.ctx, order.id, {
      vehicleNo: "DHA-GA-11-2233",
      driverName: "Karim",
      driverPhone: "01800000000",
    });
    const challanDoc = await printing.printDocument(env.as.WAREHOUSE_TEAM, {
      type: "DELIVERY_CHALLAN",
      id: challan.id,
    });
    expect(challanDoc).toMatchObject({
      title: `Delivery challan ${challan.number}`,
      referenceType: "DeliveryChallan",
      party: { id: env.buyer.id },
    });
    lines = await linesOf(env.as.WAREHOUSE_TEAM, challanDoc.id);
    for (const text of [
      "DELIVERY CHALLAN",
      challan.number,
      "DELIVER TO",
      "Mirpur 10, Dhaka",
      "EX-PL-001-NAVY-M",
      "Total pieces",
      "12",
      "DHA-GA-11-2233",
      "Karim, 01800000000",
      "Received by (name, signature & date)",
    ]) {
      expect(lines).toContain(text);
    }
    expect(lines.filter((l) => /\d\.\d{2}\b/.test(l))).toEqual([]); // no prices at all

    // Statement of account: the advance, the invoice and its payment
    const balance = await ledger.getPartyBalance(env.ctx, env.buyer.id);
    expect(balance.toFixed(2)).toBe("-43200.00");
    const statement = await printing.printDocument(env.as.ACCOUNTS, {
      type: "LEDGER_STATEMENT",
      partyId: env.buyer.id,
    });
    expect(statement).toMatchObject({
      title: "Statement: Rahim Traders (All transactions)",
      fileName: "Extras - Statement Rahim Traders (All transactions).pdf",
      referenceType: "Party",
      referenceId: env.buyer.id,
      periodFrom: null,
      periodTo: today,
      options: { from: null, to: null },
    });
    lines = await linesOf(env.as.ACCOUNTS, statement.id);
    for (const text of [
      "STATEMENT OF ACCOUNT",
      `Rahim Traders (${env.buyer.code})`,
      "All transactions",
      "CLOSING BALANCE",
      drCr(balance, "BDT"),
      "43,200.00 Cr",
      "Extras owes Rahim Traders 43,200.00 BDT.",
      "TRANSACTIONS",
      "Closing balance",
    ]) {
      expect(lines).toContain(text);
    }

    // Stock availability sheet for the brand
    const sheet = await printing.printDocument(env.as.PRODUCTION_MANAGER, {
      type: "STOCK_AVAILABILITY",
      brandId: env.brand.id,
    });
    expect(sheet).toMatchObject({
      title: `Stock availability: Extras Men (${formatDay(today)})`,
      referenceType: "Brand",
      referenceId: env.brand.id,
      party: null,
      options: { brandId: env.brand.id, styleIds: null, warehouseId: null, includeEmpty: false },
    });
    lines = await linesOf(env.as.PRODUCTION_MANAGER, sheet.id);
    for (const text of [
      "STOCK AVAILABILITY",
      "Brand: Extras Men · 68 pieces",
      "All warehouses",
      "EX-PL-001 · CLASSIC POLO",
      "Navy",
      "68",
      "1 style with nothing in stock is left out.",
    ]) {
      expect(lines).toContain(text);
    }
    expect(lines.filter((l) => /\d\.\d{2}\b/.test(l))).toEqual([]);

    // The blank letterhead pad
    const pad = await printing.printDocument(env.as.ACCOUNTS, { type: "LETTERHEAD" });
    expect(pad).toMatchObject({
      type: "LETTERHEAD",
      title: "Blank letterhead",
      referenceType: null,
      party: null,
      fileName: "Extras - Blank letterhead.pdf",
    });
    lines = await linesOf(env.as.ACCOUNTS, pad.id);
    expect(lines).toContain("Extras");
    expect(lines).toContain("Extras Fashion Ltd. · extras.test");
    expect(lines.some((l) => /Page|signature/i.test(l))).toBe(false);

    expect(await storedFiles(env.company.id, "documents")).toHaveLength(7);
  });

  it("reuses the kept PDF until something printed on it changes", async () => {
    const env = await setup();
    const order = await sellPolo(env);
    const invoiceId = order.invoice!.id;
    const request = { type: "COMMERCIAL_INVOICE", id: invoiceId };

    const first = await printing.printDocument(env.ctx, request);
    const again = await printing.printDocument(env.as.SALES_EXECUTIVE, request);
    expect(again).toMatchObject({
      id: first.id,
      reused: true,
      generatedBy: { id: env.ctx.user.id },
    });
    expect(await storedFiles(env.company.id, "documents")).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { entityType: "GeneratedDocument" } })).toBe(1);

    // A payment changes the invoice: a new PDF, and the earlier one stays on record.
    await payments.receivePayment(env.as.ACCOUNTS, {
      orderId: order.id,
      amount: 10800,
      method: "CASH",
    });
    const paid = await printing.printDocument(env.ctx, request);
    expect(paid).toMatchObject({ reused: false });
    expect(paid.id).not.toBe(first.id);
    expect(await linesOf(env.ctx, paid.id)).toContain("PAID");
    expect(await linesOf(env.ctx, first.id)).not.toContain("PAID");
    const listed = await printing.listDocuments(env.ctx, { referenceId: invoiceId });
    expect(listed.items.map((d) => d.id)).toEqual([paid.id, first.id]);

    // A kept file that went missing is made again for the same record.
    const asset = await prisma.fileAsset.findFirstOrThrow({
      where: { generatedDocuments: { some: { id: paid.id } } },
    });
    await unlink(path.join(uploadRoot(), asset.storagePath));
    const gone = await expectAppError(printing.downloadDocument(env.ctx, paid.id), "NOT_FOUND");
    expect(gone.message).toMatch(/Print the document again/);
    const remade = await printing.printDocument(env.ctx, request);
    expect(remade).toMatchObject({ id: paid.id, reused: false });
    expect(await prisma.fileAsset.findUnique({ where: { id: asset.id } })).toBeNull();
    expect(await linesOf(env.ctx, paid.id)).toContain("PAID");
    expect(
      (
        await prisma.auditLog.findMany({
          where: { entityId: paid.id, summary: { startsWith: "Made PDF" } },
          orderBy: { createdAt: "asc" },
        })
      ).map((a) => a.summary),
    ).toEqual([
      `Made PDF: Invoice ${order.invoice!.number}`,
      `Made PDF again (the kept copy was missing): Invoice ${order.invoice!.number}`,
    ]);

    // The same document printed twice at the same moment is kept once.
    const both = await Promise.all([
      printing.printDocument(env.ctx, { type: "LETTERHEAD" }),
      printing.printDocument(env.as.ACCOUNTS, { type: "LETTERHEAD" }),
    ]);
    expect(both[0].id).toBe(both[1].id);
    expect(both.map((d) => d.reused).sort()).toEqual([false, true]);
    expect(await prisma.generatedDocument.count({ where: { documentType: "LETTERHEAD" } })).toBe(1);
    const kept = await prisma.fileAsset.count({
      where: { companyId: env.company.id, storagePath: { contains: "/documents/" } },
    });
    expect(await storedFiles(env.company.id, "documents")).toHaveLength(kept);

    // Voiding marks the next print.
    const second = await sellPolo(env);
    await documents.voidInvoice(env.ctx, second.invoice!.id, { reason: "Wrong price agreed" });
    const voided = await build(env.ctx, { type: "COMMERCIAL_INVOICE", id: second.invoice!.id });
    expect(voided.model.stamp).toEqual({ text: "Void", tone: "danger" });
  });

  it("lets each role print only what it may see on screen", async () => {
    const env = await setup();
    const { as } = env;
    const order = await sellPolo(env);
    const invoiceId = order.invoice!.id;
    const challan = await documents.createDeliveryChallan(env.ctx, order.id);

    for (const request of [
      { type: "COMMERCIAL_INVOICE", id: invoiceId },
      { type: "LETTERHEAD" },
      { type: "STOCK_AVAILABILITY", brandId: env.brand.id },
      { type: "LEDGER_STATEMENT", partyId: env.buyer.id },
    ]) {
      await expectAppError(printing.printDocument(as.EMPLOYEE, request), "FORBIDDEN");
    }
    await expectAppError(printing.listDocuments(as.EMPLOYEE, {}), "FORBIDDEN");

    // The warehouse prints challans and stock sheets, not statements or the pad.
    await printing.printDocument(as.WAREHOUSE_TEAM, { type: "DELIVERY_CHALLAN", id: challan.id });
    await printing.printDocument(as.WAREHOUSE_TEAM, {
      type: "STOCK_AVAILABILITY",
      styleIds: [env.polo.id],
    });
    const denied = await expectAppError(
      printing.printDocument(as.WAREHOUSE_TEAM, {
        type: "LEDGER_STATEMENT",
        partyId: env.buyer.id,
      }),
      "FORBIDDEN",
    );
    expect(denied.message).toBe("You do not have permission to print statements.");
    await expectAppError(
      printing.printDocument(as.WAREHOUSE_TEAM, { type: "LETTERHEAD" }),
      "FORBIDDEN",
    );

    // Production prints stock sheets and the pad, never sales documents.
    const invoiceDoc = await printing.printDocument(as.SALES_EXECUTIVE, {
      type: "COMMERCIAL_INVOICE",
      id: invoiceId,
    });
    await expectAppError(
      printing.printDocument(as.PRODUCTION_MANAGER, { type: "COMMERCIAL_INVOICE", id: invoiceId }),
      "FORBIDDEN",
    );
    await printing.printDocument(as.PRODUCTION_MANAGER, { type: "LETTERHEAD" });
    await expectAppError(printing.getDocument(as.PRODUCTION_MANAGER, invoiceDoc.id), "FORBIDDEN");
    await expectAppError(
      printing.downloadDocument(as.PRODUCTION_MANAGER, invoiceDoc.id),
      "FORBIDDEN",
    );
    await expectAppError(
      printing.listDocuments(as.PRODUCTION_MANAGER, { type: "COMMERCIAL_INVOICE" }),
      "FORBIDDEN",
    );
    const seen = await printing.listDocuments(as.PRODUCTION_MANAGER, {});
    expect(new Set(seen.items.map((d) => d.type))).toEqual(
      new Set(["STOCK_AVAILABILITY", "LETTERHEAD"]),
    );

    // Accounts prints statements, not stock sheets.
    await printing.printDocument(as.ACCOUNTS, { type: "LEDGER_STATEMENT", partyId: env.buyer.id });
    await expectAppError(
      printing.printDocument(as.ACCOUNTS, { type: "STOCK_AVAILABILITY", brandId: env.brand.id }),
      "FORBIDDEN",
    );

    // The Sales Executive sees all five; only company.settings changes the logo.
    expect((await printing.listDocuments(as.SALES_EXECUTIVE, {})).items).toHaveLength(5);
    await expectAppError(
      logos.uploadCompanyLogo(as.SALES_EXECUTIVE, {
        fileName: "logo.png",
        bytes: png({ width: 10, height: 10 }),
      }),
      "FORBIDDEN",
    );
    await expectAppError(logos.removeCompanyLogo(as.ACCOUNTS), "FORBIDDEN");
    await expectAppError(logos.getCompanyLogo(as.EMPLOYEE), "NOT_FOUND");
  });

  it("keeps each company's documents to itself", async () => {
    const a = await setup("Extras");
    const b = await setup("Fabric Apparel");
    const order = await sellPolo(a);
    const doc = await printing.printDocument(a.ctx, {
      type: "COMMERCIAL_INVOICE",
      id: order.invoice!.id,
    });
    await expectAppError(
      printing.printDocument(b.ctx, { type: "COMMERCIAL_INVOICE", id: order.invoice!.id }),
      "NOT_FOUND",
    );
    await expectAppError(printing.getDocument(b.ctx, doc.id), "NOT_FOUND");
    await expectAppError(printing.downloadDocument(b.ctx, doc.id), "NOT_FOUND");
    expect((await printing.listDocuments(b.ctx, {})).items).toEqual([]);
    await expectAppError(
      printing.printDocument(b.ctx, { type: "LEDGER_STATEMENT", partyId: a.buyer.id }),
      "NOT_FOUND",
    );
    await expectAppError(
      printing.printDocument(b.ctx, { type: "STOCK_AVAILABILITY", styleIds: [a.polo.id] }),
      "NOT_FOUND",
    );
    await expectAppError(
      printing.printDocument(b.ctx, { type: "STOCK_AVAILABILITY", brandId: a.brand.id }),
      "NOT_FOUND",
    );
    // Each company's pad carries its own letterhead.
    const padA = await printing.printDocument(a.ctx, { type: "LETTERHEAD" });
    const padB = await printing.printDocument(b.ctx, { type: "LETTERHEAD" });
    expect(padB.id).not.toBe(padA.id);
    expect(await linesOf(b.ctx, padB.id)).toContain("Fabric Apparel");
    expect(await storedFiles(b.company.id, "documents")).toHaveLength(1);
  });

  it("totals the statement from the ledger, for any period", async () => {
    const env = await setup();
    const order = await sellPolo(env);
    await payments.receivePayment(env.as.ACCOUNTS, {
      orderId: order.id,
      amount: 4000,
      method: "CASH",
    });
    const now = new Date();
    const today = localDay(now, env.company.timezone);

    const whole = await build(env.ctx, { type: "LEDGER_STATEMENT", partyId: env.buyer.id }, now);
    const figures = whole.model.blocks.find((b) => b.kind === "figures");
    expect(figures?.kind === "figures" && figures.figures.map((f) => [f.label, f.value])).toEqual([
      ["Opening balance", "0.00"],
      ["Total debit", "10,800.00"],
      ["Total credit", "4,000.00"],
      ["Closing balance", "6,800.00 Dr"],
    ]);
    expect(drCr(await ledger.getPartyBalance(env.ctx, env.buyer.id), "BDT")).toBe("6,800.00 Dr");
    const balance = whole.model.blocks.find((b) => b.kind === "text");
    expect(balance?.kind === "text" && balance.paragraphs).toEqual([
      "Rahim Traders owes Extras 6,800.00 BDT.",
      "2 transactions in this period, listed date by date on the following pages.",
    ]);
    const [transactions] = tables(whole.model);
    expect(transactions!.rows.map((r) => r.cells.slice(3))).toEqual([
      ["10,800.00", "", "10,800.00 Dr"],
      ["", "4,000.00", "6,800.00 Dr"],
      ["10,800.00", "4,000.00", "6,800.00 Dr"],
    ]);
    expect(transactions!.rows.at(-1)).toMatchObject({ style: "total" });
    expect(whole.model.blocks.some((b) => b.kind === "pageBreak")).toBe(true);

    // A period: the balance brought forward opens the list.
    const period = await build(
      env.ctx,
      { type: "LEDGER_STATEMENT", partyId: env.buyer.id, from: today, to: today },
      now,
    );
    expect(period.record).toMatchObject({
      title: `Statement: Rahim Traders (${formatDay(today)} – ${formatDay(today)})`,
      options: { from: today, to: today },
    });
    expect(period.record.periodFrom?.toISOString().slice(0, 10)).toBe(today);
    expect(tables(period.model)[0]!.rows[0]).toMatchObject({
      cells: [formatDay(today), "", "Opening balance", "", "", "0.00"],
      style: "subtotal",
    });

    // After the last entry: only the balance, no transaction pages.
    const later = await build(
      env.ctx,
      { type: "LEDGER_STATEMENT", partyId: env.buyer.id, from: nextDay(today) },
      now,
    );
    expect(tables(later.model)).toEqual([]);
    expect(later.model.blocks.some((b) => b.kind === "pageBreak")).toBe(false);
    const quiet = later.model.blocks.find((b) => b.kind === "text");
    expect(quiet?.kind === "text" && quiet.paragraphs[1]).toBe(
      "There are no transactions in this period.",
    );

    await expectAppError(
      build(env.ctx, {
        type: "LEDGER_STATEMENT",
        partyId: env.buyer.id,
        from: nextDay(today),
        to: today,
      }),
      "VALIDATION",
    );
    await expectAppError(
      printing.printDocument(env.ctx, { type: "LEDGER_STATEMENT", partyId: "missing" }),
      "NOT_FOUND",
    );
  });

  it("shows sellable pieces on the stock sheet, without prices", async () => {
    const env = await setup();
    await sellPolo(env); // sets aside Navy 2 / 4 / 4 / 2
    await matrix.updateVariant(env.ctx, env.sku("White", "XL"), { isActive: false });

    const sheet = await build(env.ctx, { type: "STOCK_AVAILABILITY", brandId: env.brand.id });
    const [polo, ...others] = tables(sheet.model);
    expect(others).toEqual([]); // the tee has nothing to sell
    expect(polo!.title).toBe("EX-PL-001 · Classic Polo");
    expect(polo!.columns.map((c) => c.label)).toEqual(["Colour", "S", "M", "L", "XL", "Total"]);
    expect(polo!.rows.map((r) => r.cells)).toEqual([
      ["Navy", "8", "6", "6", "8", "28"],
      ["White", "10", "10", "10", "–", "30"],
      ["Total", "18", "16", "16", "8", "58"],
    ]);
    expect(polo!.rows[0]!.swatch).toBe("#1F2A44");
    expect(sheet.model.subtitle).toBe("Brand: Extras Men · 58 pieces");
    expect(notes(sheet.model)).toContain("1 style with nothing in stock is left out.");
    expect(printedText(sheet.model)).not.toMatch(/\d\.\d{2}|900|1450|1,450/);

    // Asked for: empty styles too.
    const all = await build(env.ctx, {
      type: "STOCK_AVAILABILITY",
      brandId: env.brand.id,
      includeEmpty: true,
    });
    const tee = tables(all.model)[1]!;
    expect(tee.title).toBe("EX-TS-002 · Basic Tee");
    expect(tee.rows.map((r) => r.cells)).toEqual([
      ["White", "0", "0", "0"],
      ["Total", "0", "0", "0"],
    ]);

    // One warehouse: the new store has nothing yet.
    const store = await stock.createWarehouse(env.ctx, { name: "Uttara store" });
    const single = await build(env.ctx, {
      type: "STOCK_AVAILABILITY",
      styleIds: [env.polo.id],
      warehouseId: store.id,
    });
    expect(single.model.meta).toContainEqual({ label: "Warehouse", value: "Uttara store" });
    expect(tables(single.model)[0]!.rows.at(-1)!.cells).toEqual(["Total", "0", "0", "0", "0", "0"]);
    expect(single.record).toMatchObject({ referenceType: "Style", referenceId: env.polo.id });

    await expectAppError(build(env.ctx, { type: "STOCK_AVAILABILITY" }), "VALIDATION");
    await expectAppError(
      build(env.ctx, { type: "STOCK_AVAILABILITY", brandId: "missing" }),
      "NOT_FOUND",
    );
    await expectAppError(
      build(env.ctx, { type: "STOCK_AVAILABILITY", styleIds: [env.polo.id], warehouseId: "nope" }),
      "NOT_FOUND",
    );
    const other = await catalog.createBrand(env.ctx, { name: "Extras Kids" });
    await expectAppError(
      build(env.ctx, { type: "STOCK_AVAILABILITY", styleIds: [env.polo.id], brandId: other.id }),
      "NOT_FOUND",
    );
    await prisma.style.createMany({
      data: Array.from({ length: 101 }, (_, i) => ({
        companyId: env.company.id,
        categoryId: env.tops.id,
        brandId: other.id,
        code: `KD-${String(i).padStart(3, "0")}`,
        name: `Kids style ${i}`,
      })),
    });
    const many = await expectAppError(
      build(env.ctx, { type: "STOCK_AVAILABILITY", brandId: other.id }),
      "VALIDATION",
    );
    expect(many.message).toMatch(/more than 100 styles/);
  });

  it("prints the challan without prices", async () => {
    const env = await setup();
    const order = await sellPolo(env);
    const challan = await documents.createDeliveryChallan(env.ctx, order.id, {
      receivedBy: "Abdur Rahim",
    });
    const built = await build(env.ctx, { type: "DELIVERY_CHALLAN", id: challan.id });
    const [items] = tables(built.model);
    expect(items!.columns.map((c) => c.label)).toEqual([
      "#",
      "SKU",
      "Item",
      "Colour",
      "Size",
      "Qty (pcs)",
    ]);
    expect(items!.rows.at(-1)!.cells).toEqual(["", "", "Total pieces", "", "", "12"]);
    expect(notes(built.model)).toContain("Received by: Abdur Rahim");
    expect(printedText(built.model)).not.toMatch(/\d\.\d{2}|10,800|900/);
  });

  it("keeps the letterhead logo checked, replaced and removed cleanly", async () => {
    const env = await setup();
    const first = png({ width: 120, height: 40 });
    const uploaded = await logos.uploadCompanyLogo(env.ctx, {
      fileName: "C:\\fakepath\\logo.png",
      bytes: first,
    });
    expect(uploaded).toMatchObject({
      fileName: "logo.png",
      mimeType: "image/png",
      sizeBytes: first.length,
      width: 120,
      height: 40,
    });
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: env.company.id },
      include: { logoFile: true },
    });
    expect(company.logoFile).toMatchObject({ id: uploaded.id, uploadedById: env.ctx.user.id });
    expect(company.logoFile!.storagePath.startsWith(`${env.company.id}/logos/`)).toBe(true);
    expect((await logos.getCompanyLogo(env.as.EMPLOYEE)).bytes.equals(first)).toBe(true);

    // Printed on the letterhead from now on.
    const pad = await printing.printDocument(env.ctx, { type: "LETTERHEAD" });
    const padPdf = (await printing.downloadDocument(env.ctx, pad.id)).bytes;
    expect(padPdf.toString("latin1")).toContain("/Subtype /Image");

    // Replacing it removes the old file; the next print shows the new logo.
    const replaced = await logos.uploadCompanyLogo(env.ctx, {
      fileName: "logo-2.png",
      bytes: png({ width: 60, height: 60, colorType: 2 }),
    });
    expect(await prisma.fileAsset.findUnique({ where: { id: uploaded.id } })).toBeNull();
    await expect(access(path.join(uploadRoot(), company.logoFile!.storagePath))).rejects.toThrow();
    const newPad = await printing.printDocument(env.ctx, { type: "LETTERHEAD" });
    expect(newPad.id).not.toBe(pad.id);
    expect(newPad.reused).toBe(false);

    // A refused file changes nothing.
    const refused = await expectAppError(
      logos.uploadCompanyLogo(env.ctx, { fileName: "logo.gif", bytes: Buffer.from("GIF89a") }),
      "VALIDATION",
    );
    expect(refused.message).toBe("Use a PNG or JPG image.");
    expect(await storedFiles(env.company.id, "logos")).toHaveLength(1);

    // A logo file changed on disk is left off rather than drawn unchecked.
    const current = await prisma.fileAsset.findUniqueOrThrow({ where: { id: replaced.id } });
    await writeFile(path.join(uploadRoot(), current.storagePath), Buffer.from("tampered"));
    expect(await logos.loadPrintLogo(env.company.id)).toBeNull();
    const plain = await printing.printDocument(env.ctx, { type: "LETTERHEAD" });
    expect(plain.reused).toBe(false);
    const plainPdf = (await printing.downloadDocument(env.ctx, plain.id)).bytes;
    expect(plainPdf.toString("latin1")).not.toContain("/Subtype /Image");

    // Removing it: the pad without a logo is the one already kept.
    expect(await logos.removeCompanyLogo(env.ctx)).toEqual({ removed: true });
    expect(
      (await prisma.company.findUniqueOrThrow({ where: { id: env.company.id } })).logoFileId,
    ).toBeNull();
    await expectAppError(logos.getCompanyLogo(env.ctx), "NOT_FOUND");
    expect(await storedFiles(env.company.id, "logos")).toEqual([]);
    expect(await logos.removeCompanyLogo(env.ctx)).toEqual({ removed: false });
    expect(await printing.printDocument(env.ctx, { type: "LETTERHEAD" })).toMatchObject({
      id: plain.id,
      reused: true,
    });
    // Printed copies keep the logo they were made with.
    expect((await printing.downloadDocument(env.ctx, pad.id)).bytes.equals(padPdf)).toBe(true);

    expect(
      (
        await prisma.auditLog.findMany({
          where: { entityType: "Company", entityId: env.company.id, summary: { contains: "logo" } },
          orderBy: { createdAt: "asc" },
        })
      ).map((a) => a.summary),
    ).toEqual([
      "Added the letterhead logo: logo.png (120 × 40 px)",
      "Changed the letterhead logo: logo-2.png (60 × 60 px)",
      "Removed the letterhead logo (logo-2.png)",
    ]);
  });

  it("lists, pages and limits printed documents", async () => {
    const env = await setup();
    const order = await sellPolo(env);
    const challan = await documents.createDeliveryChallan(env.ctx, order.id);
    for (const request of [
      { type: "COMMERCIAL_INVOICE", id: order.invoice!.id },
      { type: "DELIVERY_CHALLAN", id: challan.id },
      { type: "LEDGER_STATEMENT", partyId: env.buyer.id },
      { type: "STOCK_AVAILABILITY", brandId: env.brand.id },
      { type: "LETTERHEAD" },
    ]) {
      await printing.printDocument(env.ctx, request);
    }
    const page1 = await printing.listDocuments(env.ctx, { take: "2" });
    expect(page1.items.map((d) => d.type)).toEqual(["LETTERHEAD", "STOCK_AVAILABILITY"]);
    const page2 = await printing.listDocuments(env.ctx, { take: 2, cursor: page1.nextCursor });
    expect(page2.items.map((d) => d.type)).toEqual(["LEDGER_STATEMENT", "DELIVERY_CHALLAN"]);
    const page3 = await printing.listDocuments(env.ctx, { take: 2, cursor: page2.nextCursor });
    expect(page3.items.map((d) => d.type)).toEqual(["COMMERCIAL_INVOICE"]);
    expect(page3.nextCursor).toBeUndefined();

    const forBuyer = await printing.listDocuments(env.ctx, { partyId: env.buyer.id });
    expect(forBuyer.items.map((d) => d.type).sort()).toEqual([
      "COMMERCIAL_INVOICE",
      "DELIVERY_CHALLAN",
      "LEDGER_STATEMENT",
    ]);
    const statements = await printing.listDocuments(env.ctx, { type: "LEDGER_STATEMENT" });
    expect(statements.items).toHaveLength(1);
    expect(await printing.getDocument(env.ctx, statements.items[0]!.id)).toMatchObject({
      type: "LEDGER_STATEMENT",
      typeLabel: "Statement of account",
    });
    await expectAppError(printing.getDocument(env.ctx, "missing"), "NOT_FOUND");
    await expectAppError(
      printing.printDocument(env.ctx, { type: "QUOTATION", id: "missing" }),
      "NOT_FOUND",
    );
    await expect(printing.printDocument(env.ctx, { type: "PAYSLIP", id: "x" })).rejects.toThrow();

    // Thirty prints a minute per person, counting the six asked for above.
    for (let i = 0; i < 24; i++) await printing.printDocument(env.ctx, { type: "LETTERHEAD" });
    await expectAppError(printing.printDocument(env.ctx, { type: "LETTERHEAD" }), "RATE_LIMITED");
    await printing.printDocument(env.as.ACCOUNTS, { type: "LETTERHEAD" });
  });

  it("prints the packing list by carton, with tick boxes for picking and no prices", async () => {
    const env = await setup();
    const order = await sellPolo(env);
    const list = await documents.createPackingList(env.ctx, order.id, {
      cartons: 2,
      grossWeightKg: 8.5,
      notes: "Fold each polo with tissue.",
      items: [
        { variantId: env.sku("Navy", "M"), quantity: 4, cartonNo: "10" },
        { variantId: env.sku("Navy", "S"), quantity: 2, cartonNo: "2" },
        { variantId: env.sku("Navy", "L"), quantity: 4, cartonNo: "2" },
        { variantId: env.sku("Navy", "XL"), quantity: 2 },
      ],
    });
    const listItems = (await documents.getPackingListDocument(env.ctx, list.id)).items;
    const small = listItems.find((i) => i.variant.sku === "EX-PL-001-NAVY-S")!;
    await documents.setPickedItems(env.ctx, list.id, { itemIds: [small.id], isPicked: true });

    const built = await build(env.ctx, { type: "PACKING_LIST", id: list.id });
    expect(built.model).toMatchObject({
      type: "PACKING_LIST",
      title: "Packing List",
      reference: list.number,
      signatures: ["Packed by", "Checked by", "Authorised signature"],
    });
    expect(built.model.meta).toEqual([
      { label: "Packing list no.", value: list.number },
      { label: "Date", value: formatDay(localDay(new Date(), env.company.timezone)) },
      { label: "Order no.", value: order.number },
      { label: "Cartons", value: "2" },
      { label: "Gross weight", value: "8.50 kg" },
      { label: "Picked", value: "2 of 12 pcs" },
    ]);
    expect(built.model.parties[0]).toMatchObject({ heading: "Deliver to" });
    expect(built.model.parties[0]!.lines).toContain("Mirpur 10, Dhaka");
    const [items] = tables(built.model);
    expect(items!.columns.map((c) => c.label)).toEqual([
      "Carton",
      "SKU",
      "Item",
      "Colour",
      "Size",
      "Qty (pcs)",
      "Picked",
    ]);
    expect(items!.columns.at(-1)).toMatchObject({ align: "center", check: true });
    // By carton in counting order (2 before 10), loose pieces last, each carton totalled.
    expect(items!.rows.map((r) => [r.style ?? "normal", ...r.cells])).toEqual([
      ["normal", "2", "EX-PL-001-NAVY-S", "Classic Polo", "Navy", "S", "2", TICK],
      ["normal", "2", "EX-PL-001-NAVY-L", "Classic Polo", "Navy", "L", "4", ""],
      ["subtotal", "", "", "Carton 2 total", "", "", "6", ""],
      ["normal", "10", "EX-PL-001-NAVY-M", "Classic Polo", "Navy", "M", "4", ""],
      ["subtotal", "", "", "Carton 10 total", "", "", "4", ""],
      ["normal", "Loose", "EX-PL-001-NAVY-XL", "Classic Polo", "Navy", "XL", "2", ""],
      ["subtotal", "", "", "Loose pieces", "", "", "2", ""],
      ["total", "", "", "Total pieces", "", "", "12", ""],
    ]);
    expect(printedText(built.model)).not.toMatch(/10,800|3,600|900\b/);
    expect(built.record).toEqual({
      title: `Packing list ${list.number}`,
      referenceType: "PackingList",
      referenceId: list.id,
      partyId: env.buyer.id,
    });

    // The warehouse prints it.
    const printed = await printing.printDocument(env.as.WAREHOUSE_TEAM, {
      type: "PACKING_LIST",
      id: list.id,
    });
    expect(printed).toMatchObject({
      type: "PACKING_LIST",
      typeLabel: "Packing list",
      title: `Packing list ${list.number}`,
      referenceType: "PackingList",
      referenceId: list.id,
      party: { id: env.buyer.id },
      fileName: `Extras - Packing list ${list.number}.pdf`,
      reused: false,
    });
    const lines = await linesOf(env.as.WAREHOUSE_TEAM, printed.id);
    for (const text of [
      "PACKING LIST",
      list.number,
      order.number,
      "DELIVER TO",
      "Rahim Traders",
      "8.50 kg",
      "2 of 12 pcs",
      "Picked",
      "EX-PL-001-NAVY-XL",
      "Carton 2 total",
      "Loose pieces",
      "Total pieces",
      "Fold each polo with tissue.",
      "A ticked box means the line is picked. This packing list carries no prices.",
      "Packed by",
      "Checked by",
      "Authorised signature",
    ]) {
      expect(lines).toContain(text);
    }
    expect(lines.some((l) => l.includes("?"))).toBe(false); // tick boxes are drawn

    // Picking the rest changes the page: a new PDF.
    await documents.setPickedItems(env.ctx, list.id, {
      itemIds: listItems.map((i) => i.id),
      isPicked: true,
    });
    const picked = await printing.printDocument(env.as.WAREHOUSE_TEAM, {
      type: "PACKING_LIST",
      id: list.id,
    });
    expect(picked.reused).toBe(false);
    expect(await linesOf(env.as.WAREHOUSE_TEAM, picked.id)).toContain("12 of 12 pcs");

    // Without cartons: numbered lines and one total.
    const second = await sellPolo(env);
    const plain = await documents.createPackingList(env.ctx, second.id);
    const plainBuilt = await build(env.ctx, { type: "PACKING_LIST", id: plain.id });
    const [plainItems] = tables(plainBuilt.model);
    expect(plainItems!.columns[0]).toEqual({ label: "#", align: "right", weight: 0.45 });
    expect(plainItems!.rows.map((r) => [r.style ?? "normal", r.cells[0]])).toEqual([
      ["normal", "1"],
      ["normal", "2"],
      ["normal", "3"],
      ["normal", "4"],
      ["total", ""],
    ]);
    expect(plainBuilt.model.meta.map((m) => m.label)).toEqual([
      "Packing list no.",
      "Date",
      "Order no.",
      "Picked",
    ]);

    // A walk-in customer's packing list goes to the name and address on the order.
    const walkIn = await orders.createOrder(env.ctx, {
      channel: "POS",
      customerName: "Karim Uddin",
      customerPhone: "01900000000",
      shippingAddress: "Road 3, Uttara, Dhaka",
      lines: [{ variantId: env.sku("White", "M"), quantity: 2 }],
      documents: { packingList: true },
    });
    const walkInList = await build(env.ctx, { type: "PACKING_LIST", id: walkIn.packingList!.id });
    expect(walkInList.model.parties[0]!.lines).toEqual([
      "Karim Uddin",
      "01900000000",
      "Road 3, Uttara, Dhaka",
    ]);
    expect(walkInList.record.partyId).toBeNull();

    await expectAppError(
      printing.printDocument(env.as.PRODUCTION_MANAGER, { type: "PACKING_LIST", id: list.id }),
      "FORBIDDEN",
    );
    await expectAppError(build(env.ctx, { type: "PACKING_LIST", id: "missing" }), "NOT_FOUND");
    const other = await setup("Fabric Apparel");
    await expectAppError(
      printing.printDocument(other.ctx, { type: "PACKING_LIST", id: list.id }),
      "NOT_FOUND",
    );
  });

  it("prints money receipts with the amount in words and the balance as of each receipt", async () => {
    const env = await setup();
    const seller = env.as.SALES_EXECUTIVE;
    const today = localDay(new Date(), env.company.timezone);

    // A proforma for 100 polos at 650 (65,000 taka), its 30% advance paid in two parts.
    const q = await quotations.createQuotation(env.ctx, {
      partyId: env.buyer.id,
      validUntil: "2099-12-31",
      items: [
        {
          categoryId: env.tops.id,
          styleId: env.polo.id,
          description: "Pique polo",
          sizeBreakdown: { M: 50, L: 50 },
          unitPrice: 650,
        },
      ],
    });
    const pi = await proformas.convertQuotationToProforma(env.ctx, q.id);
    const first = (
      await payments.receivePayment(env.as.ACCOUNTS, {
        proformaId: pi.id,
        amount: 10000,
        method: "BANK_TRANSFER",
        reference: "DBBL-7781",
        notes: "First part of the advance",
      })
    ).payment;
    const firstPrint = await printing.printDocument(seller, {
      type: "PAYMENT_RECEIPT",
      id: first.id,
    });
    expect(firstPrint).toMatchObject({
      type: "PAYMENT_RECEIPT",
      typeLabel: "Money receipt",
      title: `Money receipt ${first.number}`,
      referenceType: "Payment",
      referenceId: first.id,
      party: { id: env.buyer.id },
      fileName: `Extras - Money receipt ${first.number}.pdf`,
      reused: false,
    });
    let lines = await linesOf(seller, firstPrint.id);
    for (const text of [
      "MONEY RECEIPT",
      first.number,
      "PAYMENT METHOD",
      "Bank transfer",
      "BANK REFERENCE",
      "DBBL-7781",
      "PROFORMA NO.",
      pi.number,
      "RECEIVED WITH THANKS FROM",
      "Rahim Traders",
      "BIN / Tax ID: BIN-0042",
      "Particulars",
      `Advance against proforma invoice ${pi.number}`,
      "10,000.00",
      "In words: Taka Ten Thousand Only",
      "PROFORMA TOTAL",
      "65,000.00",
      "ADVANCE (30%)",
      "19,500.00",
      "TOTAL RECEIVED",
      "Up to this receipt",
      "ADVANCE DUE",
      "9,500.00",
      "Balance due 55,000.00",
      "First part of the advance",
      "Received by",
      "Authorised signature",
    ]) {
      expect(lines).toContain(text);
    }
    expect((await payments.getPaymentReceipt(seller, first.id)).receivedToDate?.toFixed(2)).toBe(
      "10000.00",
    );

    // The rest of the advance, by cheque.
    const second = (
      await payments.receivePayment(env.as.ACCOUNTS, {
        proformaId: pi.id,
        amount: 9500,
        method: "CHEQUE",
        reference: "CHQ-004512",
      })
    ).payment;
    const secondBuilt = await build(seller, { type: "PAYMENT_RECEIPT", id: second.id });
    expect(figures(secondBuilt.model)).toEqual([
      ["Proforma total", "65,000.00", pi.number],
      ["Advance (30%)", "19,500.00", ""],
      ["Total received", "19,500.00", "Up to this receipt"],
      ["Advance due", "0.00", "Balance due 45,500.00"],
    ]);
    expect(secondBuilt.model.meta).toContainEqual({ label: "Cheque no.", value: "CHQ-004512" });
    expect(secondBuilt.model.blocks.find((b) => b.kind === "totals")).toEqual({
      kind: "totals",
      rows: [{ label: "Received (BDT)", value: "9,500.00", strong: true }],
      words: "Taka Nine Thousand Five Hundred Only",
    });
    expect(notes(secondBuilt.model)).toEqual([
      "Paid by cheque: this receipt holds once the cheque is cleared.",
    ]);
    // The first receipt still shows where things stood when it was paid: the kept copy.
    expect(
      await printing.printDocument(seller, { type: "PAYMENT_RECEIPT", id: first.id }),
    ).toMatchObject({ id: firstPrint.id, reused: true });

    // Against an invoiced order, by bKash.
    const order = await sellPolo(env);
    const paid = (
      await payments.receivePayment(env.as.ACCOUNTS, {
        orderId: order.id,
        amount: 4000,
        method: "BKASH",
        reference: "TRX123",
      })
    ).payment;
    const orderBuilt = await build(seller, { type: "PAYMENT_RECEIPT", id: paid.id });
    expect(orderBuilt.model.meta).toEqual([
      { label: "Receipt no.", value: paid.number },
      { label: "Date", value: formatDay(today) },
      { label: "Payment method", value: "bKash" },
      { label: "Transaction ID", value: "TRX123" },
      { label: "Order no.", value: order.number },
      { label: "Invoice no.", value: order.invoice!.number },
    ]);
    expect(tables(orderBuilt.model)[0]!.rows).toEqual([
      { cells: [`Payment against invoice ${order.invoice!.number}`, "4,000.00"] },
    ]);
    expect(figures(orderBuilt.model)).toEqual([
      ["Order total", "10,800.00", order.number],
      ["Total received", "4,000.00", "Up to this receipt"],
      ["Balance due", "6,800.00", "After this receipt"],
    ]);
    expect(notes(orderBuilt.model)).toEqual([]);
    expect(orderBuilt.record).toEqual({
      title: `Money receipt ${paid.number}`,
      referenceType: "Payment",
      referenceId: paid.id,
      partyId: env.buyer.id,
    });

    // An advance on an order not invoiced yet.
    const unbilled = await orders.createOrder(env.ctx, {
      channel: "WHOLESALE",
      partyId: env.buyer.id,
      lines: [{ variantId: env.sku("White", "S"), quantity: 5 }],
      documents: { invoice: false },
    });
    const advance = (
      await payments.receivePayment(env.as.ACCOUNTS, {
        orderId: unbilled.id,
        amount: 1500,
        method: "CASH",
      })
    ).payment;
    const advanceBuilt = await build(seller, { type: "PAYMENT_RECEIPT", id: advance.id });
    expect(tables(advanceBuilt.model)[0]!.rows[0]!.cells).toEqual([
      `Advance against order ${unbilled.number}`,
      "1,500.00",
    ]);
    expect(advanceBuilt.model.meta.map((m) => m.label)).toEqual([
      "Receipt no.",
      "Date",
      "Payment method",
      "Order no.",
    ]);
    expect(figures(advanceBuilt.model).at(-1)).toEqual([
      "Balance due",
      "3,000.00",
      "After this receipt",
    ]);

    // On account: no order to show a balance for.
    const onAccount = (
      await payments.receivePayment(env.as.ACCOUNTS, {
        partyId: env.buyer.id,
        amount: 3000,
        method: "CASH",
      })
    ).payment;
    const accountBuilt = await build(seller, { type: "PAYMENT_RECEIPT", id: onAccount.id });
    expect(tables(accountBuilt.model)[0]!.rows[0]!.cells).toEqual([
      "Payment on account",
      "3,000.00",
    ]);
    expect(figures(accountBuilt.model)).toEqual([]);
    expect(accountBuilt.model.meta.map((m) => m.label)).toEqual([
      "Receipt no.",
      "Date",
      "Payment method",
    ]);

    // A walk-in customer at the counter.
    const walkIn = await orders.createOrder(env.ctx, {
      channel: "POS",
      customerName: "Karim Uddin",
      customerPhone: "01900000000",
      shippingAddress: "Road 3, Uttara, Dhaka",
      lines: [{ variantId: env.sku("White", "M"), quantity: 2 }],
    });
    const counter = (
      await payments.receivePayment(env.as.ACCOUNTS, {
        orderId: walkIn.id,
        amount: 2900,
        method: "NAGAD",
        reference: "NGD-55",
      })
    ).payment;
    const counterPrint = await printing.printDocument(seller, {
      type: "PAYMENT_RECEIPT",
      id: counter.id,
    });
    expect(counterPrint.party).toBeNull();
    lines = await linesOf(seller, counterPrint.id);
    for (const text of [
      "Karim Uddin",
      "01900000000",
      "Road 3, Uttara, Dhaka",
      "Nagad",
      "TRANSACTION ID",
      "NGD-55",
      "In words: Taka Two Thousand Nine Hundred Only",
      "BALANCE DUE",
      "0.00",
    ]) {
      expect(lines).toContain(text);
    }

    // Money paid out to a supplier is not a sales receipt.
    const cash = await prisma.ledgerAccount.findFirstOrThrow({
      where: { companyId: env.company.id },
    });
    const supplierPayment = await prisma.payment.create({
      data: {
        companyId: env.company.id,
        number: "PAY-TEST-0001",
        direction: "PAID",
        method: "CASH",
        amount: 500,
        accountId: cash.id,
      },
    });
    await expectAppError(payments.getPaymentReceipt(seller, supplierPayment.id), "NOT_FOUND");
    await expectAppError(
      build(seller, { type: "PAYMENT_RECEIPT", id: supplierPayment.id }),
      "NOT_FOUND",
    );

    // Who may print receipts follows who sees sales.
    const denied = await expectAppError(
      printing.printDocument(env.as.PRODUCTION_MANAGER, { type: "PAYMENT_RECEIPT", id: paid.id }),
      "FORBIDDEN",
    );
    expect(denied.message).toBe("You do not have permission to print money receipts.");
    await printing.printDocument(env.as.ACCOUNTS, { type: "PAYMENT_RECEIPT", id: paid.id });
    const other = await setup("Fabric Apparel");
    await expectAppError(
      printing.printDocument(other.ctx, { type: "PAYMENT_RECEIPT", id: paid.id }),
      "NOT_FOUND",
    );
  });

  it("prints refund vouchers, credit notes and cancellation charges, and refunds on what they came off", async () => {
    const env = await setup();
    const seller = env.as.SALES_EXECUTIVE;
    const accounts = env.as.ACCOUNTS;
    const today = formatDay(localDay(new Date(), env.company.timezone));

    // A proforma for 100 polos at 650 (65,000 taka): its 19,500 advance paid, 2,500 paid back.
    const q = await quotations.createQuotation(env.ctx, {
      partyId: env.buyer.id,
      validUntil: "2099-12-31",
      items: [
        {
          categoryId: env.tops.id,
          styleId: env.polo.id,
          description: "Pique polo",
          sizeBreakdown: { M: 50, L: 50 },
          unitPrice: 650,
        },
      ],
    });
    const pi = await proformas.convertQuotationToProforma(env.ctx, q.id);
    await payments.receivePayment(accounts, {
      proformaId: pi.id,
      amount: 19500,
      method: "BANK_TRANSFER",
      reference: "DBBL-7781",
    });
    const back = await refunds.refundBuyer(accounts, {
      proformaId: pi.id,
      kind: "CASH",
      method: "BKASH",
      amount: 2500,
      reason: "Fewer pieces agreed",
      reference: "TRX-RF-1",
      notes: "Sent to the buyer's bKash",
    });
    const voucher = await printing.printDocument(seller, { type: "REFUND_VOUCHER", id: back.id });
    expect(voucher).toMatchObject({
      type: "REFUND_VOUCHER",
      typeLabel: "Refund voucher",
      title: `Refund voucher ${back.number}`,
      referenceType: "Refund",
      referenceId: back.id,
      party: { id: env.buyer.id },
      fileName: `Extras - Refund voucher ${back.number}.pdf`,
      reused: false,
    });
    const lines = await linesOf(seller, voucher.id);
    for (const text of [
      "REFUND VOUCHER",
      back.number,
      "PAID BY",
      "bKash",
      "TRANSACTION ID",
      "TRX-RF-1",
      "PROFORMA NO.",
      pi.number,
      "PAID TO",
      "Rahim Traders",
      `Refund of the advance paid on proforma invoice ${pi.number}`,
      "Reason: Fewer pieces agreed",
      "2,500.00",
      "In words: Taka Two Thousand Five Hundred Only",
      "PROFORMA TOTAL",
      "65,000.00",
      "PAID BEFORE",
      "19,500.00",
      "PAID AFTER",
      "17,000.00",
      "Sent to the buyer's bKash",
      "Received by",
      "Authorised signature",
    ]) {
      expect(lines).toContain(text);
    }
    const built = await build(seller, { type: "REFUND_VOUCHER", id: back.id });
    expect(built.model.meta).toEqual([
      { label: "Voucher no.", value: back.number },
      { label: "Date", value: today },
      { label: "Paid by", value: "bKash" },
      { label: "Transaction ID", value: "TRX-RF-1" },
      { label: "Proforma no.", value: pi.number },
    ]);
    expect(built.model.blocks.find((b) => b.kind === "totals")).toEqual({
      kind: "totals",
      rows: [{ label: "Paid back (BDT)", value: "2,500.00", strong: true }],
      words: "Taka Two Thousand Five Hundred Only",
    });
    expect(figures(built.model)).toEqual([
      ["Proforma total", "65,000.00", pi.number],
      ["Paid before", "19,500.00", "Received, less earlier refunds"],
      ["Paid after", "17,000.00", "Less this voucher"],
    ]);

    // The proforma shows the advance net of the refund, and the refund under its payments.
    let proformaBuilt = await build(seller, { type: "PROFORMA_INVOICE", id: pi.id });
    const proformaTotals = proformaBuilt.model.blocks.find((b) => b.kind === "totals");
    expect(proformaTotals?.rows.filter((r) => r.label.startsWith("Advance"))).toEqual([
      { label: "Advance (30%)", value: "19,500.00" },
      { label: "Advance received, less refunds", value: "17,000.00" },
      { label: "Advance due", value: "2,500.00", strong: true },
    ]);
    expect(tables(proformaBuilt.model).find((t) => t.title === "Refunds")?.rows).toEqual([
      { cells: [today, back.number, "Paid back (bKash)", "2,500.00"] },
    ]);

    // The next receipt counts the refund in what was received so far.
    const topUp = (
      await payments.receivePayment(accounts, {
        proformaId: pi.id,
        amount: 2500,
        method: "CASH",
      })
    ).payment;
    expect(figures((await build(seller, { type: "PAYMENT_RECEIPT", id: topUp.id })).model)).toEqual(
      [
        ["Proforma total", "65,000.00", pi.number],
        ["Advance (30%)", "19,500.00", ""],
        ["Total received", "19,500.00", "Up to this receipt, less 2,500.00 refunded"],
        ["Advance due", "0.00", "Balance due 45,500.00"],
      ],
    );

    // Kept as credit on the buyer's account: a credit note.
    const credit = await refunds.refundBuyer(accounts, {
      proformaId: pi.id,
      kind: "CREDIT",
      amount: 1000,
      reason: "Kept for the next order",
    });
    const creditBuilt = await build(seller, { type: "REFUND_VOUCHER", id: credit.id });
    expect(creditBuilt.model.title).toBe("Credit Note");
    expect(creditBuilt.model.parties[0]!.heading).toBe("Credited to");
    expect(creditBuilt.model.meta.map((m) => m.label)).toEqual([
      "Voucher no.",
      "Date",
      "Proforma no.",
    ]);
    expect(tables(creditBuilt.model)[0]!.rows[0]!.cells).toEqual([
      `The advance paid on proforma invoice ${pi.number}, kept as credit on the buyer's account`,
      "1,000.00",
    ]);
    expect(figures(creditBuilt.model).slice(1)).toEqual([
      ["Paid before", "19,500.00", "Received, less earlier refunds"],
      ["Paid after", "18,500.00", "Less this voucher"],
    ]);
    expect(notes(creditBuilt.model)).toEqual([
      "This credit stays on the buyer's account and counts against what they owe on later invoices.",
    ]);
    expect(creditBuilt.model.signatures).toEqual(["Authorised signature"]);
    expect(creditBuilt.record.title).toBe(`Credit note ${credit.number}`);
    proformaBuilt = await build(seller, { type: "PROFORMA_INVOICE", id: pi.id });
    expect(
      tables(proformaBuilt.model)
        .find((t) => t.title === "Refunds")
        ?.rows.map((r) => r.cells[2]),
    ).toEqual(["Paid back (bKash)", "Credit on account"]);

    // An invoiced order cancelled with a cancellation charge kept.
    const order = await sellPolo(env);
    await payments.receivePayment(accounts, { orderId: order.id, amount: 4000, method: "CASH" });
    const cancelled = await orders.cancelOrder(env.ctx, order.id, {
      reason: "Buyer cancelled",
      settle: { kind: "FORFEIT" },
    });
    const charge = cancelled.refunds[0]!;
    const chargeBuilt = await build(seller, { type: "REFUND_VOUCHER", id: charge.id });
    expect(chargeBuilt.model.title).toBe("Cancellation Charge");
    expect(chargeBuilt.model.meta.map((m) => m.label)).toEqual([
      "Voucher no.",
      "Date",
      "Order no.",
    ]);
    expect(tables(chargeBuilt.model)[0]!.rows).toEqual([
      {
        cells: [
          `Cancellation charge kept from the money paid on order ${order.number}`,
          "4,000.00",
        ],
        details: ["Reason: Order cancelled: Buyer cancelled"],
      },
    ]);
    expect(chargeBuilt.model.blocks.find((b) => b.kind === "totals")?.rows).toEqual([
      { label: "Kept (BDT)", value: "4,000.00", strong: true },
    ]);
    expect(figures(chargeBuilt.model)).toEqual([
      ["Order total", "10,800.00", order.number],
      ["Paid before", "4,000.00", "Received, less earlier refunds"],
      ["Paid after", "0.00", "Less this voucher"],
    ]);
    // The voided invoice still shows what was paid on it, not the charge kept after its void.
    const voidInvoice = await build(seller, { type: "COMMERCIAL_INVOICE", id: order.invoice!.id });
    expect(voidInvoice.model.stamp).toEqual({ text: "Void", tone: "danger" });
    expect(tables(voidInvoice.model).find((t) => t.title === "Refunds")).toBeUndefined();

    // A voided refund prints with a void stamp and its reason.
    const mistake = await refunds.refundBuyer(accounts, {
      partyId: env.buyer.id,
      kind: "CASH",
      method: "CASH",
      amount: 500,
      reason: "Paid out of the credit",
    });
    await refunds.voidRefund(accounts, mistake.id, { reason: "Buyer never collected it" });
    const voidBuilt = await build(seller, { type: "REFUND_VOUCHER", id: mistake.id });
    expect(voidBuilt.model.stamp).toEqual({ text: "Void", tone: "danger" });
    expect(notes(voidBuilt.model)).toEqual(["Voided: Buyer never collected it"]);
    expect(figures(voidBuilt.model)).toEqual([]); // credit on account: no proforma or order
    expect(tables(voidBuilt.model)[0]!.rows[0]!.cells[0]).toBe(
      "Refund of credit on the buyer's account",
    );

    // Who may print refunds follows who sees sales.
    await expectAppError(
      printing.printDocument(env.as.PRODUCTION_MANAGER, { type: "REFUND_VOUCHER", id: back.id }),
      "FORBIDDEN",
    );
    const other = await setup("Fabric Apparel");
    await expectAppError(
      printing.printDocument(other.ctx, { type: "REFUND_VOUCHER", id: back.id }),
      "NOT_FOUND",
    );
  });

  it("prints the BIN and trade licence number from the licence records on every document", async () => {
    const env = await setup();
    const today = localDay(new Date(), env.company.timezone);
    const order = await sellPolo(env);
    const packingList = await documents.createPackingList(env.ctx, order.id);
    const challan = await documents.createDeliveryChallan(env.ctx, order.id);
    const payment = (
      await payments.receivePayment(env.as.ACCOUNTS, {
        orderId: order.id,
        amount: 1000,
        method: "CASH",
      })
    ).payment;

    // Nothing on file: the letterhead is as before.
    const before = await printing.printDocument(env.ctx, { type: "LETTERHEAD" });
    const plain = await build(env.ctx, { type: "LETTERHEAD" });
    expect(plain.model.letterhead.registrations).toBeUndefined();
    expect((await linesOf(env.ctx, before.id)).some((l) => /BIN|licence/.test(l))).toBe(false);

    const bin = await compliance.createCompliance(env.ctx, {
      type: "VAT_BIN",
      number: "000123456-0101",
      issuingAuthority: "National Board of Revenue",
    });
    const licence = await compliance.createCompliance(env.ctx, {
      type: "TRADE_LICENSE",
      number: "TRAD/DNCC/123",
      issueDate: addDays(today, -300),
      expiryDate: addDays(today, 65),
    });
    const both = ["BIN: 000123456-0101", "Trade licence: TRAD/DNCC/123"];
    for (const request of [
      { type: "COMMERCIAL_INVOICE", id: order.invoice!.id },
      { type: "PACKING_LIST", id: packingList.id },
      { type: "DELIVERY_CHALLAN", id: challan.id },
      { type: "PAYMENT_RECEIPT", id: payment.id },
      { type: "LEDGER_STATEMENT", partyId: env.buyer.id },
      { type: "STOCK_AVAILABILITY", brandId: env.brand.id },
      { type: "LETTERHEAD" },
    ]) {
      expect((await build(env.ctx, request)).model.letterhead.registrations).toEqual(both);
    }
    const invoicePdf = await printing.printDocument(env.ctx, {
      type: "COMMERCIAL_INVOICE",
      id: order.invoice!.id,
    });
    const invoiceLines = await linesOf(env.ctx, invoicePdf.id);
    for (const text of both) expect(invoiceLines).toContain(text);
    // The data behind the screens' print layouts carries them too.
    expect(
      (await documents.getInvoiceDocument(env.ctx, order.invoice!.id)).letterhead,
    ).toMatchObject({ bin: "000123456-0101", tradeLicense: "TRAD/DNCC/123" });

    // The pad with the numbers is a new PDF; printing it again reuses it.
    const numbered = await printing.printDocument(env.ctx, { type: "LETTERHEAD" });
    expect(numbered).toMatchObject({ reused: false });
    expect(numbered.id).not.toBe(before.id);
    const padLines = await linesOf(env.ctx, numbered.id);
    for (const text of both) expect(padLines).toContain(text);
    expect(await printing.printDocument(env.ctx, { type: "LETTERHEAD" })).toMatchObject({
      id: numbered.id,
      reused: true,
    });

    // Renewing the licence under the same number changes nothing on paper.
    const renewed = await compliance.renewCompliance(env.ctx, licence.id, {
      expiryDate: addDays(today, 430),
    });
    expect(await printing.printDocument(env.ctx, { type: "LETTERHEAD" })).toMatchObject({
      id: numbered.id,
      reused: true,
    });
    // A new number prints from then on.
    await compliance.renewCompliance(env.ctx, renewed.id, {
      expiryDate: addDays(today, 800),
      number: "TRAD/DNCC/456",
    });
    const renumbered = await printing.printDocument(env.ctx, { type: "LETTERHEAD" });
    expect(renumbered.reused).toBe(false);
    const renumberedLines = await linesOf(env.ctx, renumbered.id);
    expect(renumberedLines).toContain("Trade licence: TRAD/DNCC/456");
    expect(renumberedLines).not.toContain("Trade licence: TRAD/DNCC/123");

    // An archived record is off the letterhead.
    await compliance.archiveCompliance(env.ctx, bin.id);
    expect((await build(env.ctx, { type: "LETTERHEAD" })).model.letterhead.registrations).toEqual([
      "Trade licence: TRAD/DNCC/456",
    ]);

    // Another company prints its own numbers (none here).
    const other = await setup("Fabric Apparel");
    expect(
      (await build(other.ctx, { type: "LETTERHEAD" })).model.letterhead.registrations,
    ).toBeUndefined();
  });
});
