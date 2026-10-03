/*
 * Tags in custom templates: {BuyerName}, {InvoiceNo}, {TotalAmount}... (double
 * braces {{BuyerName}} and spaces inside the braces work too). Each tag name
 * stands for a piece of data (its source path, e.g. "buyer.name"); the catalog
 * below lists every tag a document type can fill, with its default meaning.
 * A template may also use its own names ({Customer}) and map them to a source
 * path; tags with no meaning print empty.
 *
 * Item tags ({ItemDescription}, {ItemQuantity}...) belong to the document's
 * lines: in a table row they repeat the row once per line; anywhere else they
 * list every line, one per line of text.
 */

/** The documents a template can be made for. */
export const TEMPLATE_TYPES = [
  "QUOTATION",
  "PROFORMA_INVOICE",
  "COMMERCIAL_INVOICE",
  "DELIVERY_CHALLAN",
  "LETTERHEAD",
] as const;

export type TemplateType = (typeof TEMPLATE_TYPES)[number];

export const isTemplateType = (value: string): value is TemplateType =>
  (TEMPLATE_TYPES as readonly string[]).includes(value);

/** A tag in a template: {Name}, {{Name}} or { Name }. Names start with a letter. */
export const TAG_PATTERN =
  /\{\{\s*([A-Za-z][A-Za-z0-9_]{0,63})\s*\}\}|\{\s*([A-Za-z][A-Za-z0-9_]{0,63})\s*\}/g;

/** The tag name of a TAG_PATTERN match. */
export const tagName = (match: RegExpMatchArray | RegExpExecArray): string =>
  (match[1] ?? match[2])!;

/** How a tag is stored and shown: "{BuyerName}". */
export const tagLabel = (name: string) => `{${name}}`;

/** "{BuyerName}", "{{ BuyerName }}" or "BuyerName" as a bare name, or null when it is none. */
export function parseTagInput(value: string): string | null {
  const trimmed = value.trim();
  const bare = /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(trimmed) ? trimmed : null;
  if (bare) return bare;
  const match = new RegExp(`^(?:${TAG_PATTERN.source})$`).exec(trimmed);
  return match ? tagName(match) : null;
}

/** Every distinct tag name in a text, in order of first appearance. */
export function findTags(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(TAG_PATTERN)) names.add(tagName(match));
  return [...names];
}

export type CatalogEntry = {
  /** The tag name, and other names that mean the same ({Total} = {TotalAmount}). */
  names: readonly string[];
  /** Where the value comes from; "item." paths belong to the document's lines. */
  path: string;
  label: string;
  types: readonly TemplateType[];
};

const ALL = TEMPLATE_TYPES;
const SALES: readonly TemplateType[] = [
  "QUOTATION",
  "PROFORMA_INVOICE",
  "COMMERCIAL_INVOICE",
  "DELIVERY_CHALLAN",
];
const PRICED: readonly TemplateType[] = ["QUOTATION", "PROFORMA_INVOICE", "COMMERCIAL_INVOICE"];
const QUOTED: readonly TemplateType[] = ["QUOTATION", "PROFORMA_INVOICE"];
const DELIVERED: readonly TemplateType[] = ["COMMERCIAL_INVOICE", "DELIVERY_CHALLAN"];

const entry = (
  names: string | readonly string[],
  path: string,
  label: string,
  types: readonly TemplateType[],
): CatalogEntry => ({ names: typeof names === "string" ? [names] : names, path, label, types });

export const TAG_CATALOG: readonly CatalogEntry[] = [
  // The company (every document)
  entry("CompanyName", "company.name", "Company name", ALL),
  entry("CompanyLegalName", "company.legalName", "Registered (legal) name", ALL),
  entry("CompanyAddress", "company.address", "Company address", ALL),
  entry("CompanyPhone", "company.phone", "Company phone", ALL),
  entry("CompanyEmail", "company.email", "Company email", ALL),
  entry("CompanyWebsite", "company.website", "Company website", ALL),
  entry("CompanyBIN", "company.bin", "VAT registration number (BIN)", ALL),
  entry("CompanyTIN", "company.tin", "Tax ID (TIN)", ALL),
  entry("CompanyTradeLicense", "company.tradeLicense", "Trade licence number", ALL),
  entry("CompanyIRC", "company.irc", "Import registration (IRC)", ALL),
  entry("CompanyERC", "company.erc", "Export registration (ERC)", ALL),
  entry("Today", "document.today", "Today's date", ALL),
  entry("Currency", "document.currency", "Currency (BDT)", ALL),
  // The buyer (a letter may be addressed to one too)
  entry(["BuyerName", "CustomerName"], "buyer.name", "Buyer name", ALL),
  entry("BuyerCode", "buyer.code", "Buyer code", ALL),
  entry("BuyerContactPerson", "buyer.contactPerson", "Buyer contact person", ALL),
  entry("BuyerPhone", "buyer.phone", "Buyer phone", ALL),
  entry("BuyerEmail", "buyer.email", "Buyer email", ALL),
  entry("BuyerAddress", "buyer.address", "Buyer address", ALL),
  entry("BuyerBIN", "buyer.taxId", "Buyer BIN / tax ID", ALL),
  // Numbers and dates
  entry(["DocumentNo", "DocumentNumber"], "document.number", "Document number", SALES),
  entry("Date", "document.date", "Document date", SALES),
  entry(["QuotationNo", "QuotationNumber"], "quotation.number", "Quotation number", QUOTED),
  entry("QuotationDate", "quotation.date", "Quotation date", ["QUOTATION"]),
  entry("ValidUntil", "quotation.validUntil", "Valid until", ["QUOTATION"]),
  entry(["ProformaNo", "ProformaNumber"], "proforma.number", "Proforma number", [
    "PROFORMA_INVOICE",
  ]),
  entry("ProformaDate", "proforma.date", "Proforma date", ["PROFORMA_INVOICE"]),
  entry(["InvoiceNo", "InvoiceNumber"], "invoice.number", "Invoice number", ["COMMERCIAL_INVOICE"]),
  entry("InvoiceDate", "invoice.date", "Invoice date", ["COMMERCIAL_INVOICE"]),
  entry("DueDate", "invoice.dueDate", "Payment due date", ["COMMERCIAL_INVOICE"]),
  entry(["OrderNo", "OrderNumber"], "order.number", "Order number", DELIVERED),
  entry(["ChallanNo", "ChallanNumber"], "challan.number", "Challan number", ["DELIVERY_CHALLAN"]),
  entry("ChallanDate", "challan.date", "Delivery date", ["DELIVERY_CHALLAN"]),
  entry("VehicleNo", "challan.vehicleNo", "Vehicle number", ["DELIVERY_CHALLAN"]),
  entry("DriverName", "challan.driverName", "Driver name", ["DELIVERY_CHALLAN"]),
  entry("DriverPhone", "challan.driverPhone", "Driver phone", ["DELIVERY_CHALLAN"]),
  entry("ReceivedBy", "challan.receivedBy", "Received by", ["DELIVERY_CHALLAN"]),
  entry("DeliveryAddress", "challan.deliveryAddress", "Delivery address", ["DELIVERY_CHALLAN"]),
  // Amounts
  entry("Subtotal", "amount.subtotal", "Subtotal", PRICED),
  entry("Discount", "amount.discount", "Discount", PRICED),
  entry("DeliveryCharge", "amount.deliveryCharge", "Delivery charge", ["COMMERCIAL_INVOICE"]),
  entry(["Tax", "VAT"], "amount.tax", "VAT / tax", PRICED),
  entry(["TotalAmount", "Total", "GrandTotal"], "amount.total", "Total amount", PRICED),
  entry("AmountInWords", "amount.words", "Total in words", PRICED),
  entry("PaidAmount", "amount.paid", "Amount paid", ["COMMERCIAL_INVOICE"]),
  entry("DueAmount", "amount.due", "Amount due", ["COMMERCIAL_INVOICE"]),
  entry("AdvancePercent", "proforma.advancePercent", "Advance percentage", ["PROFORMA_INVOICE"]),
  entry("AdvanceAmount", "proforma.advanceAmount", "Advance amount", ["PROFORMA_INVOICE"]),
  entry("AdvancePaid", "proforma.advancePaid", "Advance received", ["PROFORMA_INVOICE"]),
  entry("AdvanceDue", "proforma.advanceDue", "Advance still due", ["PROFORMA_INVOICE"]),
  entry("BalanceDue", "proforma.balanceDue", "Balance due", ["PROFORMA_INVOICE"]),
  entry("TotalQuantity", "document.totalQuantity", "Total pieces", SALES),
  entry("Terms", "document.terms", "Terms & conditions", QUOTED),
  entry("Notes", "document.notes", "Notes", ["QUOTATION", "DELIVERY_CHALLAN"]),
  // The document's lines
  entry("ItemNo", "item.no", "Line number", SALES),
  entry("ItemDescription", "item.description", "Item description", SALES),
  entry("ItemStyle", "item.style", "Style", SALES),
  entry("ItemSKU", "item.sku", "SKU", DELIVERED),
  entry(["ItemColor", "ItemColour"], "item.color", "Colour", SALES),
  entry("ItemSize", "item.size", "Size", DELIVERED),
  entry("ItemSizes", "item.sizes", "Size breakdown", QUOTED),
  entry("ItemFabric", "item.fabric", "Fabric", QUOTED),
  entry(["ItemQuantity", "ItemQty"], "item.quantity", "Quantity", SALES),
  entry("ItemUnitPrice", "item.unitPrice", "Unit price", PRICED),
  entry("ItemDiscount", "item.discount", "Line discount", ["COMMERCIAL_INVOICE"]),
  entry("ItemAmount", "item.amount", "Line amount", PRICED),
];

/** The tags a document type can fill. */
export function catalogFor(type: TemplateType) {
  return TAG_CATALOG.filter((e) => e.types.includes(type)).map((e) => ({
    tag: tagLabel(e.names[0]!),
    alsoAs: e.names.slice(1).map(tagLabel),
    path: e.path,
    label: e.label,
    /** Repeats per line of the document. */
    item: isItemPath(e.path),
  }));
}

export const isItemPath = (path: string | null | undefined) => Boolean(path?.startsWith("item."));

/** The source paths a document type can fill (to check a mapping). */
export function pathsFor(type: TemplateType): Set<string> {
  return new Set(TAG_CATALOG.filter((e) => e.types.includes(type)).map((e) => e.path));
}

/** What a tag name means for a document type by default (case does not matter), or null. */
export function defaultPath(name: string, type: TemplateType): string | null {
  const lower = name.toLowerCase();
  const found = TAG_CATALOG.find(
    (e) => e.types.includes(type) && e.names.some((n) => n.toLowerCase() === lower),
  );
  return found?.path ?? null;
}
