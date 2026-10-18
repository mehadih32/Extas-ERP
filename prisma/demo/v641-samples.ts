import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

import { addDays, localDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import * as compliance from "@/modules/compliance/compliance.service";
import * as employees from "@/modules/hr/employee.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as parties from "@/modules/parties/party.service";
import * as orders from "@/modules/sales/order.service";
import * as templates from "@/modules/templates/template.service";

/*
 * The v6.4.1 samples on the demo site: one of each record that a Help guide
 * pictures on its own page, so the Help pictures can be taken from the demo
 * data (scripts/full-check/help-shots.mjs):
 *   - a plain tee in stock (opening stock, 150 a SKU) and three wholesale
 *     orders for two buyers, made through the sales services so the books,
 *     stock and the buyers' accounts are right:
 *       Dhaka Fashion House: an invoiced order, part paid, that leaves a
 *       previous due of 65,000, and a new order not invoiced yet (still
 *       editable, and its "Issue the invoice" offers the previous due);
 *       Chattogram Style Mart: an invoiced order of 300 pieces, 1,26,000,
 *       with 50,000 paid, that can still be revised (Smart Edit) or voided;
 *   - two employees: a merchandiser with an Employee login and a QC inspector
 *     without one (the "System access" card offers "Give a login");
 *   - a PDF invoice pad template with its tags placed;
 *   - a fire licence renewed once, its current term due for renewal.
 * Each part is made once: what is there already is left as it is, so the
 * loader can run again after a part failed.
 */

/** Notes on the sample orders: how each one is found again. */
export const V641_SAMPLE_ORDERS = {
  previousDue: "Sample order on the demo site: invoiced and part paid.",
  open: "Sample order on the demo site: not invoiced yet, can still be changed.",
  revise: "Sample order on the demo site: invoiced and part paid, can still be revised.",
} as const;
export const V641_SAMPLE_STYLE = "DM-TEE-01";
export const V641_SAMPLE_TEMPLATE = "Sample: invoice pad (PDF)";
export const V641_SAMPLE_LICENCE = "Fire licence (head office)";
export const V641_SAMPLE_EMPLOYEES = {
  withLogin: "Shirin Akter",
  withoutLogin: "Rafiqul Islam",
} as const;
/** The sample merchandiser's login: a reserved address that can never receive mail. */
export const V641_SAMPLE_LOGIN = "shirin.akter@demo.invalid";

const insensitive = (name: string) => ({ equals: name, mode: "insensitive" as const });

const SIZES = ["M", "L", "XL"] as const;
const COLOURS = [
  { name: "Black", hexCode: "#111111" },
  { name: "White", hexCode: "#FFFFFF" },
] as const;
type Sku = `${(typeof COLOURS)[number]["name"]} ${(typeof SIZES)[number]}`;

/** The tee: found again by its code, its opening stock added to any SKU with none. */
async function sampleTee(ctx: CompanyContext) {
  const companyId = ctx.company.id;
  let style = await prisma.style.findFirst({ where: { companyId, code: V641_SAMPLE_STYLE } });
  if (!style) {
    let category = await prisma.category.findFirst({
      where: { companyId, name: insensitive("T-Shirts") },
    });
    category ??= await catalog.createCategory(ctx, { name: "T-Shirts" });
    const sizeIds: string[] = [];
    for (const name of SIZES) {
      const found = await prisma.size.findFirst({ where: { companyId, name: insensitive(name) } });
      sizeIds.push(found?.id ?? (await catalog.createSize(ctx, { name })).id);
    }
    const colorIds: string[] = [];
    for (const colour of COLOURS) {
      const found = await prisma.color.findFirst({
        where: { companyId, name: insensitive(colour.name) },
      });
      colorIds.push(found?.id ?? (await catalog.createColor(ctx, colour)).id);
    }
    style = await styles.createStyle(ctx, {
      code: V641_SAMPLE_STYLE,
      name: "Crew-neck cotton tee",
      categoryId: category.id,
      fabric: "Single jersey 160 GSM, 100% cotton",
      retailPrice: 650,
      wholesalePrice: 420,
    });
    await matrix.generateMatrix(ctx, style.id, { colorIds, sizeIds });
  }
  const variants = await prisma.productVariant.findMany({
    where: { styleId: style.id },
    select: { id: true, color: { select: { name: true } }, size: { select: { name: true } } },
  });
  for (const v of variants) {
    if (
      await prisma.stockMovement.findFirst({ where: { variantId: v.id }, select: { id: true } })
    ) {
      continue;
    }
    await stock.adjustStock(ctx, {
      variantId: v.id,
      quantity: 150,
      type: "OPENING",
      unitCost: 260,
      note: "Sample opening stock on the demo site",
    });
  }
  const skuOf = new Map(
    variants.map((v) => [`${v.color.name} ${v.size.name.toUpperCase()}`.toLowerCase(), v.id]),
  );
  const sku = (name: Sku) => skuOf.get(name.toLowerCase())!;
  return { styleId: style.id, sku };
}

async function buyer(ctx: CompanyContext, name: string, extra: Record<string, unknown>) {
  const found = await prisma.party.findFirst({
    where: { companyId: ctx.company.id, kind: "BUYER", name },
    select: { id: true },
  });
  if (found) return found.id;
  return (await parties.createParty(ctx, { kind: "BUYER", name, ...extra })).party.id;
}

/** The three wholesale orders; each made once, found again by its notes. */
async function sampleOrders(ctx: CompanyContext) {
  const tee = await sampleTee(ctx);
  const dhaka = await buyer(ctx, "Dhaka Fashion House", {
    country: "Bangladesh",
    paymentTermsDays: 30,
    tradePayment: "BANK_TRANSFER",
  });
  const chattogram = await buyer(ctx, "Chattogram Style Mart", {
    country: "Bangladesh",
    paymentTermsDays: 30,
    tradePayment: "BANK_TRANSFER",
  });
  const quantities = (rows: Array<[Sku, number]>) =>
    Object.fromEntries(rows.map(([name, n]) => [tee.sku(name), n]));
  const made: string[] = [];
  const order = async (notes: string, input: Record<string, unknown>) => {
    const found = await prisma.salesOrder.findFirst({
      where: { companyId: ctx.company.id, notes },
      select: { number: true },
    });
    if (found) return;
    const created = await orders.createOrder(ctx, { channel: "WHOLESALE", notes, ...input });
    made.push(created.number);
  };

  // 250 pieces at 420 = 105,000, 40,000 paid: 65,000 still due.
  await order(V641_SAMPLE_ORDERS.previousDue, {
    partyId: dhaka,
    matrix: [
      {
        styleId: tee.styleId,
        unitPrice: 420,
        quantities: quantities([
          ["Black M", 50],
          ["Black L", 50],
          ["Black XL", 25],
          ["White M", 50],
          ["White L", 50],
          ["White XL", 25],
        ]),
      },
    ],
    payment: { amount: 40_000, method: "BANK_TRANSFER", reference: "Sample bank transfer" },
  });
  // 200 pieces at 450 = 90,000, not invoiced: its invoice can carry the 65,000.
  await order(V641_SAMPLE_ORDERS.open, {
    partyId: dhaka,
    matrix: [
      {
        styleId: tee.styleId,
        unitPrice: 450,
        quantities: quantities([
          ["Black M", 40],
          ["Black L", 40],
          ["Black XL", 20],
          ["White M", 40],
          ["White L", 40],
          ["White XL", 20],
        ]),
      },
    ],
    documents: { invoice: false },
  });
  // 300 pieces at 420 = 1,26,000, 50,000 paid: part paid, so it can be revised.
  await order(V641_SAMPLE_ORDERS.revise, {
    partyId: chattogram,
    matrix: [
      {
        styleId: tee.styleId,
        unitPrice: 420,
        quantities: quantities([
          ["Black M", 50],
          ["Black L", 50],
          ["Black XL", 50],
          ["White M", 50],
          ["White L", 50],
          ["White XL", 50],
        ]),
      },
    ],
    payment: { amount: 50_000, method: "BANK_TRANSFER", reference: "Sample bank transfer" },
  });
  return made;
}

/** The merchandiser with an Employee login and the QC inspector without one. */
async function sampleEmployees(ctx: CompanyContext, today: string) {
  const made: string[] = [];
  const employee = async (name: string, input: Record<string, unknown>) => {
    const found = await prisma.employee.findFirst({
      where: { companyId: ctx.company.id, name },
      select: { id: true, userId: true },
    });
    if (found) return found;
    const created = await employees.createEmployee(ctx, { name, ...input });
    made.push(name);
    return { id: created.id, userId: null };
  };
  const merchandiser = await employee(V641_SAMPLE_EMPLOYEES.withLogin, {
    designation: "Merchandiser",
    department: "Merchandising",
    joinDate: addDays(today, -420),
    salary: 35_000,
    salaryMethod: "BANK_TRANSFER",
  });
  if (!merchandiser.userId) {
    // The temporary password is not kept or printed: nobody signs in as her.
    await employees.grantPortalAccess(ctx, merchandiser.id, { email: V641_SAMPLE_LOGIN });
  }
  await employee(V641_SAMPLE_EMPLOYEES.withoutLogin, {
    designation: "QC Inspector",
    department: "Quality",
    joinDate: addDays(today, -200),
    salary: 22_000,
    salaryMethod: "CASH",
  });
  return made;
}

/** A blank A4 invoice pad: the company's name, the labels and the item table. */
async function invoicePad(companyName: string) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.12, 0.31, 0.47);
  const grey = rgb(0.45, 0.45, 0.45);
  // The company's name from its record, made smaller to fit the width (the standard
  // PDF font has no Bengali, so only plain letters are kept).
  const name = companyName.replace(/[^\x20-\x7E]/g, "").trim();
  const nameSize = Math.min(18, (515 / Math.max(bold.widthOfTextAtSize(name, 1), 1)) * 0.98);
  page.drawText(name, { x: 40, y: 795, size: nameSize, font: bold, color: navy });
  page.drawLine({ start: { x: 40, y: 782 }, end: { x: 555, y: 782 }, thickness: 1.5, color: navy });
  const title = "COMMERCIAL INVOICE";
  const titleX = 555 - bold.widthOfTextAtSize(title, 12);
  page.drawText(title, { x: titleX, y: 764, size: 12, font: bold, color: navy });
  page.drawText("Buyer:", { x: 40, y: 740, size: 10, font: bold });
  page.drawText("Invoice No.:", { x: 340, y: 740, size: 10, font: bold });
  page.drawText("Date:", { x: 340, y: 720, size: 10, font: bold });
  page.drawRectangle({ x: 40, y: 640, width: 515, height: 20, color: navy });
  const head = { y: 646, size: 10, font: bold, color: rgb(1, 1, 1) };
  page.drawText("Description", { x: 46, ...head });
  page.drawText("Qty", { x: 385, ...head });
  page.drawText("Unit price", { x: 500, ...head });
  // The item rows print 1.25 times their text size apart: a box, not ruled lines.
  page.drawRectangle({
    x: 40,
    y: 230,
    width: 515,
    height: 410,
    borderColor: grey,
    borderWidth: 0.6,
  });
  page.drawLine({
    start: { x: 340, y: 230 },
    end: { x: 340, y: 640 },
    thickness: 0.4,
    color: grey,
  });
  page.drawLine({
    start: { x: 420, y: 230 },
    end: { x: 420, y: 640 },
    thickness: 0.4,
    color: grey,
  });
  page.drawText("Total:", { x: 345, y: 200, size: 11, font: bold });
  page.drawText("Authorised signature", { x: 40, y: 90, size: 9, font, color: grey });
  page.drawLine({ start: { x: 40, y: 105 }, end: { x: 200, y: 105 }, thickness: 0.6 });
  return Buffer.from(await pdf.save());
}

/** The invoice pad, uploaded as a PDF template with its tags placed on the page. */
async function sampleTemplate(ctx: CompanyContext) {
  const found = await prisma.documentTemplate.findFirst({
    where: { companyId: ctx.company.id, name: V641_SAMPLE_TEMPLATE },
    select: { id: true, placeholders: { select: { id: true }, take: 1 } },
  });
  if (found?.placeholders.length) return null;
  const id =
    found?.id ??
    (
      await templates.uploadTemplate(
        ctx,
        { name: V641_SAMPLE_TEMPLATE, documentType: "COMMERCIAL_INVOICE" },
        { fileName: "invoice pad.pdf", bytes: await invoicePad(ctx.company.name) },
      )
    ).id;
  // Top-left corners in points, from the top of the page.
  await templates.setPlaceholders(ctx, id, {
    placeholders: [
      { tag: "{BuyerName}", page: 1, x: 78, y: 92, fontSize: 10 },
      { tag: "{InvoiceNo}", page: 1, x: 405, y: 92, fontSize: 10, bold: true },
      { tag: "{InvoiceDate}", page: 1, x: 405, y: 112, fontSize: 10 },
      { tag: "{ItemDescription}", page: 1, x: 46, y: 210, fontSize: 10, width: 285 },
      { tag: "{ItemQuantity}", page: 1, x: 345, y: 210, fontSize: 10, width: 60, align: "right" },
      { tag: "{ItemUnitPrice}", page: 1, x: 425, y: 210, fontSize: 10, width: 120, align: "right" },
      {
        tag: "{TotalAmount}",
        page: 1,
        x: 425,
        y: 630,
        fontSize: 11,
        bold: true,
        width: 120,
        align: "right",
      },
    ],
  });
  return V641_SAMPLE_TEMPLATE;
}

/** Last year's fire licence, renewed once; the current term runs out in 40 days. */
async function sampleLicence(ctx: CompanyContext, today: string) {
  if (
    await prisma.complianceDocument.findFirst({
      where: { companyId: ctx.company.id, title: V641_SAMPLE_LICENCE },
      select: { id: true },
    })
  ) {
    return null;
  }
  const first = await compliance.createCompliance(ctx, {
    type: "FIRE_LICENSE",
    title: V641_SAMPLE_LICENCE,
    number: "FL-DHK-04417",
    issuingAuthority: "Fire Service and Civil Defence, Dhaka",
    issueDate: addDays(today, -690),
    expiryDate: addDays(today, -326),
    alertDaysBefore: 60,
    notes: "Sample licence on the demo site.",
  });
  const current = await compliance.renewCompliance(ctx, first.id, {
    issueDate: addDays(today, -325),
    expiryDate: addDays(today, 40),
    number: "FL-DHK-05231",
    notes: "Sample licence on the demo site: due for renewal.",
  });
  return current.id;
}

export async function loadV641Samples(ctx: CompanyContext) {
  const today = localDay(new Date(), ctx.company.timezone);
  return {
    orders: await sampleOrders(ctx),
    employees: await sampleEmployees(ctx, today),
    template: await sampleTemplate(ctx),
    licence: (await sampleLicence(ctx, today)) ? V641_SAMPLE_LICENCE : null,
  };
}
