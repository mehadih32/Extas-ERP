import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { decodePDFRawStream, PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { amountInWords } from "@/lib/amount-words";
import { AppError } from "@/lib/errors";
import { formatInstantDay } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import * as compliance from "@/modules/compliance/compliance.service";
import * as printing from "@/modules/documents/print.service";
import { getFileForDownload, uploadRoot } from "@/modules/files/file.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as parties from "@/modules/parties/party.service";
import { createRole } from "@/modules/rbac/role.service";
import * as salesDocuments from "@/modules/sales/documents.service";
import * as orders from "@/modules/sales/order.service";
import * as quotations from "@/modules/sales/quotation.service";
import { DOCX_MIME } from "@/modules/templates/docx";
import { HTML_MIME } from "@/modules/templates/html";
import * as templates from "@/modules/templates/template.service";

import { png } from "../fixtures/images";
import { pdfLines } from "../fixtures/pdf";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const TZ = "Asia/Dhaka";

/**
 * A company with its owner, a Sales Executive, an Employee and a "Front desk"
 * role that may only print letters; a polo in Navy S / M with 10 pieces each,
 * the buyer Rahim Traders and a trade licence on file.
 */
async function setup(name = "Extras") {
  const { company, roles } = await makeCompany(name);
  const member = async (roleId: string, who: string) => {
    const user = await makeUser(`${who}@${company.slug}.test`);
    await addToCompany(user.id, company.id, roleId);
    return contextFor(user.id, company.id);
  };
  const admin = await member(roles.SUPER_ADMIN, "admin");
  const sales = await member(roles.SALES_EXECUTIVE, "sales");
  const staff = await member(roles.EMPLOYEE, "staff");
  const deskRole = await createRole(admin, {
    name: "Front desk",
    permissions: ["documents.letterhead"],
  });
  const desk = await member(deskRole.id, "desk");

  const sizes = [];
  for (const size of ["S", "M"]) sizes.push(await catalog.createSize(admin, { name: size }));
  const navy = await catalog.createColor(admin, { name: "Navy", hexCode: "#1F2A44" });
  const tops = await catalog.createCategory(admin, { name: "Tops" });
  const polo = await styles.createStyle(admin, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    wholesalePrice: 900,
  });
  await matrix.generateMatrix(admin, polo.id, {
    colorIds: [navy.id],
    sizeIds: sizes.map((s) => s.id),
  });
  const variants = await prisma.productVariant.findMany({
    where: { styleId: polo.id },
    include: { size: true },
  });
  const sku = (size: string) => variants.find((v) => v.size.name === size)!.id;
  for (const v of variants) {
    await stock.adjustStock(admin, {
      variantId: v.id,
      quantity: 10,
      type: "OPENING",
      unitCost: 500,
    });
  }
  const buyer = (
    await parties.createParty(admin, {
      kind: "BUYER",
      name: "Rahim Traders",
      contactPerson: "Abdur Rahim",
      address: "Mirpur 10, Dhaka",
      taxId: "BIN-0042",
    })
  ).party;
  await compliance.createCompliance(admin, { type: "TRADE_LICENSE", number: "TRAD/DNCC/123" });
  return { company, admin, sales, staff, desk, polo, sku, buyer };
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

/** Two lines: 300 polos in S / M at 650 and 500 tees at 300 (3,45,000 taka). */
const quote = (env: Env) =>
  quotations.createQuotation(env.admin, {
    partyId: env.buyer.id,
    validUntil: "2099-12-31",
    items: [
      {
        styleId: env.polo.id,
        description: "Pique polo with tipping",
        sizeBreakdown: { S: 100, M: 200 },
        unitPrice: 650,
      },
      { description: "Basic tee", quantity: 500, unitPrice: 300 },
    ],
    terms: "50% advance, balance before delivery.",
  });

/** Navy S x 2 and M x 4 at 900: 5,400 taka, invoiced at once. */
const sellPolo = (env: Env) =>
  orders.createOrder(env.admin, {
    channel: "WHOLESALE",
    partyId: env.buyer.id,
    lines: [
      { variantId: env.sku("S"), quantity: 2 },
      { variantId: env.sku("M"), quantity: 4 },
    ],
  });

// --- Word files -----------------------------------------------------------------------

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const run_ = (text: string, props = "") =>
  `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (...runs: string[]) => `<w:p>${runs.join("")}</w:p>`;
const cell = (text: string) => `<w:tc>${para(run_(text))}</w:tc>`;
const row = (...cells: string[]) => `<w:tr>${cells.map(cell).join("")}</w:tr>`;

function makeDocx(body: string): Buffer {
  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8(
        `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
      ),
      "word/document.xml": strToU8(
        `${XML_HEAD}<w:document ${W_NS}><w:body>${body}</w:body></w:document>`,
      ),
    }),
  );
}

const QUOTATION_DOCX = makeDocx(
  [
    para(run_("{CompanyName} | Trade licence {CompanyTradeLicense} | {Today}")),
    para(run_("Quotation {QuotationNo}", "<w:b/>")),
    para(run_("To: {Buy"), run_("erName} ({Customer})")),
    para(run_("Attn: {BuyerContactPerson}")),
    "<w:tbl>",
    row("No", "Item", "Sizes", "Qty", "Price", "Amount"),
    row(
      "{ItemNo}",
      "{ItemDescription}",
      "{ItemSizes}",
      "{ItemQty}",
      "{ItemUnitPrice}",
      "{ItemAmount}",
    ),
    "</w:tbl>",
    para(run_("Total: {TotalAmount}")),
    para(run_("{AmountInWords}")),
    para(run_("{Terms}{Mystery}")),
  ].join(""),
);

/** The text of each paragraph of a filled Word file's body. */
function docxText(bytes: Buffer): string[] {
  const xml = strFromU8(unzipSync(new Uint8Array(bytes))["word/document.xml"]!);
  return xml
    .split("</w:p>")
    .slice(0, -1)
    .map((p) =>
      [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
        .map((m) => m[1]!.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"))
        .join(""),
    );
}

// --- PDF files ------------------------------------------------------------------------

async function blankPdf(pages: number): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = pdf.addPage([595.28, 841.89]);
    page.drawText(`Challan pad page ${i + 1}`, { x: 40, y: 800, size: 14 });
  }
  return Buffer.from(await pdf.save());
}

/** The text written on a page of a filled PDF template (the layer laid over it). */
function overlayText(pdf: PDFDocument, pageIndex: number): string {
  const resources = pdf.getPages()[pageIndex]!.node.Resources();
  const forms = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  if (!forms) return "";
  return forms
    .keys()
    .map((key) => {
      const stream = forms.lookup(key);
      if (!(stream instanceof PDFRawStream)) return "";
      const content = Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
      return [...content.matchAll(/<([0-9a-f]+)>/gi)]
        .map((m) => Buffer.from(m[1]!, "hex").toString("latin1"))
        .join("");
    })
    .join("");
}

const download = (ctx: CompanyContext, documentId: string) =>
  printing.downloadDocument(ctx, documentId);

run("document templates", () => {
  let uploads: string;

  beforeEach(async () => {
    await resetDb();
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-templates-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(uploads, { recursive: true, force: true });
  });

  it("reads a Word template's tags, maps them and fills it with a quotation", async () => {
    const env = await setup();
    const q = await quote(env);
    const template = await templates.uploadTemplate(
      env.admin,
      { name: "Extras quotation", documentType: "QUOTATION", isDefault: "true" },
      { fileName: "quotation.docx", bytes: QUOTATION_DOCX },
    );
    expect(template).toMatchObject({
      format: "WORD",
      documentType: "QUOTATION",
      documentLabel: "Quotation",
      isDefault: true,
      isActive: true,
      source: { fileName: "quotation.docx", mimeType: DOCX_MIME, sizeBytes: QUOTATION_DOCX.length },
      pages: null,
      unmapped: ["{Customer}", "{Mystery}"],
    });
    const meaning = Object.fromEntries(template.placeholders.map((p) => [p.tag, p.sourcePath]));
    expect(meaning).toMatchObject({
      "{BuyerName}": "buyer.name",
      "{ItemQty}": "item.quantity",
      "{TotalAmount}": "amount.total",
      "{CompanyTradeLicense}": "company.tradeLicense",
    });
    expect(template.placeholders).toHaveLength(17);
    expect(
      (
        await prisma.auditLog.findFirstOrThrow({
          where: { entityType: "DocumentTemplate", entityId: template.id },
        })
      ).summary,
    ).toBe('Added Word template "Extras quotation" for quotations: 17 tags, 2 not recognised');

    // {Customer} prints the buyer's name in capitals; {Mystery} stays empty.
    const mapped = await templates.setPlaceholders(env.admin, template.id, {
      placeholders: [{ tag: "{Customer}", sourcePath: "buyer.name", format: "upper" }],
    });
    expect(mapped.unmapped).toEqual(["{Mystery}"]);
    expect(mapped.placeholders.find((p) => p.tag === "{Customer}")).toMatchObject({
      sourcePath: "buyer.name",
      label: "Buyer name",
      format: "upper",
      item: false,
    });
    const place = (placeholders: unknown[]) =>
      templates.setPlaceholders(env.admin, template.id, { placeholders });
    await expectAppError(
      place([{ tag: "{Customer}", sourcePath: "invoice.number" }]),
      "VALIDATION",
    );
    await expectAppError(place([{ tag: "{Missing}", sourcePath: "buyer.name" }]), "VALIDATION");
    await expectAppError(place([{ tag: "{Customer}" }, { tag: "Customer" }]), "VALIDATION");
    await expectAppError(place([{ tag: "{Not a tag}" }]), "VALIDATION");

    // The sales executive fills it with the quotation.
    const now = new Date();
    const filled = await templates.fillTemplate(
      env.sales,
      template.id,
      { id: q.id },
      undefined,
      now,
    );
    expect(filled).toMatchObject({
      type: "QUOTATION",
      title: `Quotation ${q.number} (Extras quotation)`,
      referenceType: "Quotation",
      referenceId: q.id,
      party: { id: env.buyer.id },
      template: { id: template.id, name: "Extras quotation", format: "WORD" },
      mimeType: DOCX_MIME,
      fileName: `Extras - Quotation ${q.number} (Extras quotation).docx`,
      reused: false,
    });
    const file = await download(env.sales, filled.id);
    expect(file.mimeType).toBe(DOCX_MIME);
    expect(docxText(file.bytes)).toEqual([
      `Extras | Trade licence TRAD/DNCC/123 | ${formatInstantDay(now, TZ)}`,
      `Quotation ${q.number}`,
      "To: Rahim Traders (RAHIM TRADERS)",
      "Attn: Abdur Rahim",
      ...["No", "Item", "Sizes", "Qty", "Price", "Amount"],
      ...["1", "Pique polo with tipping", "S 100 · M 200", "300", "650.00", "1,95,000.00"],
      ...["2", "Basic tee", "", "500", "300.00", "1,50,000.00"],
      "Total: 3,45,000.00",
      amountInWords(q.total, "BDT"),
      "50% advance, balance before delivery.",
    ]);
    // Kept with the printed documents; the same data again gives the same copy.
    expect(
      (await printing.listDocuments(env.sales, { type: "QUOTATION" })).items.map((d) => d.id),
    ).toContain(filled.id);
    const again = await templates.fillTemplate(
      env.sales,
      template.id,
      { id: q.id },
      undefined,
      now,
    );
    expect(again).toMatchObject({ id: filled.id, reused: true });
    // A changed mapping makes a new copy.
    await place([{ tag: "{Customer}", format: null }]);
    const changed = await templates.fillTemplate(
      env.sales,
      template.id,
      { id: q.id },
      undefined,
      now,
    );
    expect(changed.id).not.toBe(filled.id);
    expect(docxText((await download(env.sales, changed.id)).bytes)[2]).toBe(
      "To: Rahim Traders (Rahim Traders)",
    );
  });

  it("fills an HTML page with an invoice, escaping the data", async () => {
    const env = await setup();
    const html = [
      "<!doctype html><html><body>",
      "<h1>Invoice {InvoiceNo}</h1><p>{BuyerName}<br>{BuyerAddress}</p>",
      "<table><tr><th>Item</th><th>Qty</th><th>Amount</th></tr>",
      "<tr><td>{ItemDescription}</td><td>{ItemQuantity}</td><td>{ItemAmount}</td></tr></table>",
      "<p>Total {GrandTotal}, due {DueAmount}</p>",
      "</body></html>",
    ].join("");
    const template = await templates.createHtmlTemplate(env.admin, {
      name: "Simple invoice",
      documentType: "COMMERCIAL_INVOICE",
      html,
    });
    expect(template).toMatchObject({
      format: "HTML",
      unmapped: [],
      source: { fileName: "Simple invoice.html", mimeType: HTML_MIME },
    });
    await prisma.party.update({
      where: { id: env.buyer.id },
      data: { address: "Mirpur 10 <Block C>\nDhaka" },
    });
    const order = await sellPolo(env);
    const invoice = order.invoice!;
    const filled = await templates.fillTemplate(env.sales, template.id, { id: invoice.id });
    expect(filled).toMatchObject({
      type: "COMMERCIAL_INVOICE",
      referenceType: "Invoice",
      mimeType: HTML_MIME,
      fileName: `Extras - Invoice ${invoice.number} (Simple invoice).html`,
    });
    const page = (await download(env.sales, filled.id)).bytes.toString("utf8");
    expect(page).toContain(`<h1>Invoice ${invoice.number}</h1>`);
    expect(page).toContain("<p>Rahim Traders<br>Mirpur 10 &lt;Block C&gt;<br>Dhaka</p>");
    expect(page).toContain("<tr><td>Classic Polo – Navy / S</td><td>2</td><td>1,800.00</td></tr>");
    expect(page).toContain("<tr><td>Classic Polo – Navy / M</td><td>4</td><td>3,600.00</td></tr>");
    expect(page.match(/<tr>/g)).toHaveLength(3);
    expect(page).toContain("<p>Total 5,400.00, due 5,400.00</p>");

    // Editing the page reads its tags again.
    const edited = await templates.updateTemplate(env.admin, template.id, {
      html: html.replace(", due {DueAmount}", " after {Discount} discount"),
    });
    expect(edited.placeholders.map((p) => p.tag)).toContain("{Discount}");
    expect(edited.placeholders.map((p) => p.tag)).not.toContain("{DueAmount}");
    await expectAppError(
      templates.updateTemplate(env.admin, template.id, {
        html: `${html}<script>alert(1)</script>`,
      }),
      "VALIDATION",
    );
    await expectAppError(
      templates.createHtmlTemplate(env.admin, {
        name: "Sneaky",
        documentType: "QUOTATION",
        html: '<p onclick="steal()">{BuyerName}</p>',
      }),
      "VALIDATION",
    );
  });

  it("writes a delivery challan on a PDF form at the places given", async () => {
    const env = await setup();
    const form = await blankPdf(2);
    const template = await templates.uploadTemplate(
      env.admin,
      { name: "Printed challan pad", documentType: "DELIVERY_CHALLAN" },
      { fileName: "challan pad.pdf", bytes: form },
    );
    expect(template).toMatchObject({
      format: "PDF",
      pages: [
        { width: 595.28, height: 841.89 },
        { width: 595.28, height: 841.89 },
      ],
      placeholders: [],
    });
    const place = (placeholders: unknown[]) =>
      templates.setPlaceholders(env.admin, template.id, { placeholders });
    await expectAppError(place([{ tag: "{ChallanNo}" }]), "VALIDATION");
    await expectAppError(place([{ tag: "{ChallanNo}", page: 3, x: 10, y: 10 }]), "VALIDATION");
    await expectAppError(place([{ tag: "{ChallanNo}", page: 1, x: 900, y: 10 }]), "VALIDATION");
    // A challan carries no prices.
    await expectAppError(
      place([{ tag: "{Total}", sourcePath: "amount.total", page: 1, x: 10, y: 10 }]),
      "VALIDATION",
    );
    const placed = await place([
      { tag: "{ChallanNo}", page: 1, x: 400, y: 120, fontSize: 12, bold: true },
      { tag: "{BuyerName}", page: 1, x: 60, y: 160 },
      { tag: "{ItemDescription}", page: 1, x: 60, y: 260 },
      { tag: "{ItemQuantity}", page: 1, x: 400, y: 260, width: 100, align: "right" },
      { tag: "{Driver}", sourcePath: "challan.driverName", page: 2, x: 60, y: 700 },
    ]);
    expect(placed.placeholders.find((p) => p.tag === "{ChallanNo}")).toMatchObject({
      sourcePath: "challan.number",
      page: 1,
      x: 400,
      y: 120,
      fontSize: 12,
      bold: true,
      align: "left",
      width: null,
    });

    const order = await sellPolo(env);
    const challan = await salesDocuments.createDeliveryChallan(env.admin, order.id, {
      driverName: "Karim",
    });
    const filled = await templates.fillTemplate(env.sales, template.id, { id: challan.id });
    expect(filled).toMatchObject({
      type: "DELIVERY_CHALLAN",
      mimeType: "application/pdf",
      fileName: `Extras - Delivery challan ${challan.number} (Printed challan pad).pdf`,
    });
    const pdf = await PDFDocument.load((await download(env.sales, filled.id)).bytes);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getTitle()).toBe(`Delivery challan ${challan.number} (Printed challan pad)`);
    const first = overlayText(pdf, 0);
    for (const text of [challan.number, "Rahim Traders", "Classic Polo", "Navy / S", "Navy / M"]) {
      expect(first).toContain(text);
    }
    expect(overlayText(pdf, 1)).toBe("Karim");

    // Only a PDF can replace a PDF template; placed tags past the new last page go.
    await expectAppError(
      templates.replaceTemplateFile(env.admin, template.id, {
        fileName: "challan.docx",
        bytes: QUOTATION_DOCX,
      }),
      "VALIDATION",
    );
    const shorter = await templates.replaceTemplateFile(env.admin, template.id, {
      fileName: "challan pad v2.pdf",
      bytes: await blankPdf(1),
    });
    expect(shorter.pages).toHaveLength(1);
    expect(shorter.placeholders.map((p) => p.tag)).not.toContain("{Driver}");
  });

  it("prints letters on a scanned pad, to a buyer or blank", async () => {
    const env = await setup();
    const pad = png({ width: 200, height: 283 });
    const template = await templates.uploadTemplate(
      env.admin,
      { name: "Letter pad", documentType: "LETTERHEAD" },
      { fileName: "pad.png", bytes: pad },
    );
    expect(template).toMatchObject({
      format: "IMAGE",
      source: { mimeType: "image/png" },
      pages: [{ width: 595.28, height: Math.round(((595.28 * 283) / 200) * 100) / 100 }],
    });
    await templates.setPlaceholders(env.admin, template.id, {
      placeholders: [
        { tag: "{BuyerName}", page: 1, x: 60, y: 200 },
        { tag: "{Today}", page: 1, x: 400, y: 160 },
        { tag: "{CompanyBIN}", page: 1, x: 60, y: 800 },
      ],
    });
    const now = new Date();
    const letter = await templates.fillTemplate(
      env.sales,
      template.id,
      { partyId: env.buyer.id },
      undefined,
      now,
    );
    expect(letter).toMatchObject({
      title: "Letter to Rahim Traders (Letter pad)",
      referenceType: "Party",
      party: { id: env.buyer.id },
      mimeType: "application/pdf",
    });
    // No BIN on file yet, so that line stays empty.
    expect(pdfLines((await download(env.sales, letter.id)).bytes)).toEqual([
      "Rahim Traders",
      formatInstantDay(now, TZ),
    ]);
    const blank = await templates.fillTemplate(env.sales, template.id, {}, undefined, now);
    expect(blank).toMatchObject({ title: "Letterhead (Letter pad)", party: null });

    // The front desk prints letters, but may not look up buyers.
    await expectAppError(
      templates.fillTemplate(env.desk, template.id, { partyId: env.buyer.id }),
      "FORBIDDEN",
    );
    expect(await templates.fillTemplate(env.desk, template.id, {}, undefined, now)).toMatchObject({
      id: blank.id,
      reused: true,
    });
    await expectAppError(
      templates.uploadTemplate(
        env.admin,
        { name: "Too big", documentType: "LETTERHEAD" },
        { fileName: "huge.png", bytes: png({ width: 6000, height: 10 }) },
      ),
      "VALIDATION",
    );
  });

  it("keeps templates to managers, and active ones to whoever prints them", async () => {
    const env = await setup();
    const word = await templates.uploadTemplate(
      env.admin,
      { name: "Extras quotation", documentType: "QUOTATION", isDefault: "true" },
      { fileName: "quotation.docx", bytes: QUOTATION_DOCX },
    );
    const plain = await templates.createHtmlTemplate(env.admin, {
      name: "Plain quotation",
      documentType: "QUOTATION",
      html: "<p>{BuyerName}: {TotalAmount}</p>",
      isDefault: true,
    });
    const letter = await templates.createHtmlTemplate(env.admin, {
      name: "Plain letter",
      documentType: "LETTERHEAD",
      html: "<p>{CompanyName}</p>",
    });
    // One default per document type.
    const names = async (ctx: CompanyContext, query: Record<string, unknown> = {}) =>
      (await templates.listTemplates(ctx, query)).items.map((t) => [t.name, t.isDefault]);
    expect(await names(env.admin, { documentType: "QUOTATION" })).toEqual([
      ["Plain quotation", true],
      ["Extras quotation", false],
    ]);
    await templates.updateTemplate(env.admin, word.id, { isDefault: true });
    expect(await names(env.admin, { documentType: "QUOTATION" })).toEqual([
      ["Extras quotation", true],
      ["Plain quotation", false],
    ]);
    await expectAppError(
      templates.updateTemplate(env.admin, plain.id, { name: "Extras quotation" }),
      "CONFLICT",
    );

    // Sales sees the active sales templates; the front desk the letters; staff nothing.
    await templates.updateTemplate(env.admin, plain.id, { isActive: false });
    expect(await names(env.sales)).toEqual([
      ["Extras quotation", true],
      ["Plain letter", false],
    ]);
    expect(await names(env.desk)).toEqual([["Plain letter", false]]);
    await expectAppError(templates.listTemplates(env.staff), "FORBIDDEN");
    await expectAppError(templates.getTemplate(env.sales, plain.id), "NOT_FOUND");
    await expectAppError(templates.getTemplate(env.desk, word.id), "NOT_FOUND");
    await expectAppError(templates.fillTemplate(env.staff, letter.id, {}), "NOT_FOUND");
    const q = await quote(env);
    await expectAppError(templates.fillTemplate(env.admin, plain.id, { id: q.id }), "CONFLICT");
    await expectAppError(templates.fillTemplate(env.admin, word.id, {}), "VALIDATION");
    // Changing templates is for managers only.
    await expectAppError(
      templates.uploadTemplate(
        env.sales,
        { name: "Mine", documentType: "QUOTATION" },
        { fileName: "q.docx", bytes: QUOTATION_DOCX },
      ),
      "FORBIDDEN",
    );
    await expectAppError(
      templates.updateTemplate(env.sales, word.id, { name: "Mine" }),
      "FORBIDDEN",
    );
    await expectAppError(templates.deleteTemplate(env.sales, word.id), "FORBIDDEN");
    await expectAppError(templates.downloadTemplateSource(env.sales, word.id), "FORBIDDEN");
    const source = await templates.downloadTemplateSource(env.admin, word.id);
    expect(source).toEqual({
      fileName: "quotation.docx",
      mimeType: DOCX_MIME,
      bytes: QUOTATION_DOCX,
    });
    const asset = await prisma.documentTemplate.findUniqueOrThrow({ where: { id: word.id } });
    await expectAppError(getFileForDownload(env.sales, asset.fileId!), "FORBIDDEN");
    expect(
      templates.tagCatalog("DELIVERY_CHALLAN").tags.some((t) => t.tag === "{TotalAmount}"),
    ).toBe(false);

    // Another company sees none of it, nor can it fill this company's documents.
    const other = await setup("Other Co");
    await expectAppError(templates.getTemplate(other.admin, word.id), "NOT_FOUND");
    await expectAppError(templates.fillTemplate(other.admin, word.id, { id: q.id }), "NOT_FOUND");
    const theirs = await templates.uploadTemplate(
      other.admin,
      { name: "Extras quotation", documentType: "QUOTATION" },
      { fileName: "quotation.docx", bytes: QUOTATION_DOCX },
    );
    await expectAppError(templates.fillTemplate(other.admin, theirs.id, { id: q.id }), "NOT_FOUND");
  });

  it("refuses files that cannot be templates", async () => {
    const env = await setup();
    const upload = (fileName: string, bytes: Buffer, name = "Test") =>
      templates.uploadTemplate(env.admin, { name, documentType: "QUOTATION" }, { fileName, bytes });
    const why = async (fileName: string, bytes: Buffer) =>
      (await expectAppError(upload(fileName, bytes), "VALIDATION")).message;
    const oldWord = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(504),
    ]);
    expect(await why("old.doc", oldWord)).toMatch(/Old Word files/);
    expect(await why("notes.txt", Buffer.from("Dear {BuyerName}"))).toMatch(/Upload a Word file/);
    expect(await why("empty.docx", Buffer.alloc(0))).toMatch(/empty/);
    expect(await why("broken.docx", Buffer.from("PK\u0003\u0004 not really a zip"))).toMatch(
      /damaged/,
    );
    expect(
      await why("page.html", Buffer.from("<html><body><script>alert(1)</script></body></html>")),
    ).toMatch(/scripts/);
    expect(await why("form.pdf", Buffer.from("%PDF-1.7 nothing here"))).toMatch(
      /cannot be read|no pages/,
    );
    await upload("quotation.docx", QUOTATION_DOCX, "Taken");
    await expectAppError(upload("quotation.docx", QUOTATION_DOCX, "Taken"), "CONFLICT");
    // Nothing is left behind by the refused uploads.
    expect(await prisma.fileAsset.count({ where: { companyId: env.company.id } })).toBe(1);
  });

  it("keeps the mapping when a Word file is replaced, and the documents when it is deleted", async () => {
    const env = await setup();
    const template = await templates.uploadTemplate(
      env.admin,
      { name: "Extras quotation", documentType: "QUOTATION" },
      { fileName: "quotation.docx", bytes: QUOTATION_DOCX },
    );
    await templates.setPlaceholders(env.admin, template.id, {
      placeholders: [{ tag: "{Customer}", sourcePath: "buyer.name", format: "upper" }],
    });
    const q = await quote(env);
    const filled = await templates.fillTemplate(env.sales, template.id, { id: q.id });
    const first = await prisma.fileAsset.findUniqueOrThrow({
      where: {
        id: (await prisma.documentTemplate.findUniqueOrThrow({ where: { id: template.id } }))
          .fileId!,
      },
    });

    const v2 = makeDocx(para(run_("{CustomerName} {Customer} {NewTag}")));
    const replaced = await templates.replaceTemplateFile(env.admin, template.id, {
      fileName: "quotation v2.docx",
      bytes: v2,
    });
    expect(replaced.placeholders.map((p) => [p.tag, p.sourcePath, p.format])).toEqual([
      ["{Customer}", "buyer.name", "upper"],
      ["{CustomerName}", "buyer.name", null],
      ["{NewTag}", null, null],
    ]);
    expect(replaced.source.fileName).toBe("quotation v2.docx");
    expect(await prisma.fileAsset.count({ where: { id: first.id } })).toBe(0);
    await expect(access(path.join(uploadRoot(), first.storagePath))).rejects.toThrow();
    const refilled = await templates.fillTemplate(env.sales, template.id, { id: q.id });
    expect(refilled.id).not.toBe(filled.id);
    expect(docxText((await download(env.sales, refilled.id)).bytes)).toEqual([
      "Rahim Traders RAHIM TRADERS ",
    ]);

    const current = await prisma.documentTemplate.findUniqueOrThrow({ where: { id: template.id } });
    const file = await prisma.fileAsset.findUniqueOrThrow({ where: { id: current.fileId! } });
    expect(await templates.deleteTemplate(env.admin, template.id)).toEqual({
      id: template.id,
      deleted: true,
    });
    await expect(access(path.join(uploadRoot(), file.storagePath))).rejects.toThrow();
    // What was filled from it stays, and still downloads.
    const kept = await printing.getDocument(env.sales, filled.id);
    expect(kept).toMatchObject({ template: null, downloadable: true, mimeType: DOCX_MIME });
    expect((await download(env.sales, filled.id)).bytes.length).toBe(kept.sizeBytes);
  });
});
