import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { decodePDFRawStream, degrees, PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { fileResponse } from "@/lib/download";
import { createPdf, textWidth } from "@/lib/pdf";
import {
  DOCX_MIME,
  docxTags,
  fillDocx,
  openDocx,
  TemplateFileError,
} from "@/modules/templates/docx";
import { checkHtml, decodeHtml, fillHtml, HTML_MIME, htmlTags } from "@/modules/templates/html";
import {
  fillImageTemplate,
  fillPdfTemplate,
  type Placement,
  readImageTemplate,
  readPdfTemplate,
  renderOverlay,
} from "@/modules/templates/overlay";
import {
  applyFormat,
  elementRanges,
  makeResolver,
  type Resolver,
  type TagMapping,
  type TemplateData,
} from "@/modules/templates/resolve";
import { catalogFor, defaultPath, findTags, parseTagInput } from "@/modules/templates/tags";

import { png } from "../fixtures/images";
import { pageCount, pdfLines, pdfTextBlocks } from "../fixtures/pdf";

/** Why the template file was refused ("(accepted)" when it was not). */
async function refusal(check: () => unknown): Promise<string> {
  try {
    await check();
  } catch (error) {
    if (error instanceof TemplateFileError) return error.message;
    throw error;
  }
  return "(accepted)";
}

const DATA: TemplateData = {
  values: {
    "company.name": "Extras",
    "document.today": "3 Oct 2026",
    "buyer.name": "Rahim Traders",
    "buyer.address": "12 <Road> & Sons\nDhaka",
    "buyer.contactPerson": "Mr\u0007 Karim",
    "quotation.number": "QT-2026-0001",
    "amount.total": "1,200.00",
    "document.totalQuantity": "300",
    "document.notes": "Deliver before Eid; pack in cartons of 50",
  },
  items: [
    { "item.no": "1", "item.description": "Polo shirt", "item.quantity": "100" },
    { "item.no": "2", "item.description": "T-shirt", "item.quantity": "200" },
  ],
};

const MAPPINGS = new Map<string, TagMapping>([
  ["Customer", { path: "buyer.name", format: "upper" }],
  ["Mystery", { path: null, format: null }],
]);

const quotationResolver = (data: TemplateData = DATA): Resolver =>
  makeResolver(MAPPINGS, "QUOTATION", data);

describe("tags", () => {
  it("finds {Tag}, {{Tag}} and { Tag } once each, in order", () => {
    expect(
      findTags(
        "Dear {BuyerName}, invoice {{ InvoiceNo }} for { Total }. {BuyerName} {1abc} {Not-A-Tag} {}",
      ),
    ).toEqual(["BuyerName", "InvoiceNo", "Total"]);
  });

  it("reads a tag typed in any of its forms", () => {
    expect(parseTagInput("{BuyerName}")).toBe("BuyerName");
    expect(parseTagInput(" {{ BuyerName }} ")).toBe("BuyerName");
    expect(parseTagInput("BuyerName")).toBe("BuyerName");
    expect(parseTagInput("Buyer Name")).toBeNull();
    expect(parseTagInput("{Buyer-Name}")).toBeNull();
    expect(parseTagInput("{1st}")).toBeNull();
  });

  it("knows what each tag means for each document, whatever its case", () => {
    expect(defaultPath("BuyerName", "QUOTATION")).toBe("buyer.name");
    expect(defaultPath("buyername", "QUOTATION")).toBe("buyer.name");
    expect(defaultPath("CustomerName", "LETTERHEAD")).toBe("buyer.name");
    expect(defaultPath("GrandTotal", "COMMERCIAL_INVOICE")).toBe("amount.total");
    expect(defaultPath("InvoiceNo", "QUOTATION")).toBeNull();
    // A delivery challan carries no prices.
    expect(defaultPath("TotalAmount", "DELIVERY_CHALLAN")).toBeNull();
    expect(defaultPath("Whatever", "QUOTATION")).toBeNull();
  });

  it("lists the tags each document can fill", () => {
    const challan = catalogFor("DELIVERY_CHALLAN");
    expect(challan.find((t) => t.tag === "{ChallanNo}")).toMatchObject({
      alsoAs: ["{ChallanNumber}"],
      path: "challan.number",
      item: false,
    });
    expect(challan.find((t) => t.tag === "{ItemQuantity}")?.item).toBe(true);
    expect(challan.some((t) => t.path.startsWith("amount.") || t.path === "item.unitPrice")).toBe(
      false,
    );
    const letter = catalogFor("LETTERHEAD");
    expect(letter.every((t) => /^(company|buyer|document)\./.test(t.path))).toBe(true);
    expect(letter.some((t) => t.item)).toBe(false);
  });
});

describe("tag values", () => {
  const resolver = quotationResolver();

  it("uses the template's own mapping, then the catalog, else prints nothing", () => {
    expect(resolver.value("BuyerName")).toBe("Rahim Traders");
    expect(resolver.value("Customer")).toBe("RAHIM TRADERS");
    expect(resolver.value("Mystery")).toBe("");
    expect(resolver.value("Unknown")).toBe("");
    expect(resolver.value("InvoiceNo")).toBe("");
  });

  it("gives one line's value in a row, and every line elsewhere", () => {
    expect(resolver.isItem("ItemQty")).toBe(true);
    expect(resolver.isItem("BuyerName")).toBe(false);
    expect(resolver.value("ItemDescription", DATA.items[1])).toBe("T-shirt");
    expect(resolver.value("ItemDescription")).toBe("Polo shirt\nT-shirt");
  });

  it("changes the letter case only when asked", () => {
    expect(applyFormat("Dhaka", "upper")).toBe("DHAKA");
    expect(applyFormat("Dhaka", "lower")).toBe("dhaka");
    expect(applyFormat("Dhaka", "title")).toBe("Dhaka");
    expect(applyFormat("Dhaka", null)).toBe("Dhaka");
  });

  it("pairs nested elements and ignores stray closing tags", () => {
    const text = "<tr>a<tr>b</tr>c</tr></tr>";
    expect(elementRanges(text, /<tr>/g, /<\/tr>/g)).toEqual([
      { start: 5, end: 15 },
      { start: 0, end: 21 },
    ]);
  });
});

// --- Word templates ------------------------------------------------------------------

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const CONTENT_TYPES = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

const run = (text: string, props = "") =>
  `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (...runs: string[]) => `<w:p>${runs.join("")}</w:p>`;
const cell = (...runs: string[]) => `<w:tc>${para(...runs)}</w:tc>`;
const row = (...cells: string[]) => `<w:tr>${cells.join("")}</w:tr>`;

function makeDocx(
  body: string,
  parts: Record<string, string | Uint8Array> = {},
  types = CONTENT_TYPES,
): Buffer {
  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8(types),
      "word/document.xml": strToU8(
        `${XML_HEAD}<w:document ${W_NS}><w:body>${body}</w:body></w:document>`,
      ),
      ...Object.fromEntries(
        Object.entries(parts).map(([path, data]) => [
          path,
          typeof data === "string" ? strToU8(data) : data,
        ]),
      ),
    }),
  );
}

const STYLES = `${XML_HEAD}<w:styles ${W_NS}><w:style w:styleId="{NotATag}"/></w:styles>`;

/** A quotation letter: tags split over runs, an item table, a header. */
const quotationDocx = () =>
  makeDocx(
    [
      para(
        run("Dear {Buy", "<w:b/>"),
        '<w:proofErr w:type="spellStart"/>',
        run("erName}"),
        run(", total {TotalAmount}."),
      ),
      "<w:tbl>",
      row(cell(run("No")), cell(run("Item")), cell(run("Qty"))),
      row(
        cell(run("{ItemNo}")),
        cell(run("{ItemDescription}")),
        cell(run("{Item"), run("Quantity}")),
      ),
      row(cell(run("Total")), cell(run("")), cell(run("{TotalQuantity}"))),
      "</w:tbl>",
      para(run("Items: {ItemDescription}")),
      para(run("Address: {BuyerAddress}")),
      para(run("Attn: {BuyerContactPerson} / {Customer} / {Mystery}{Unknown}")),
      para(run("{Split")),
      para(run("Tag}")),
    ].join(""),
    {
      "word/header1.xml": `${XML_HEAD}<w:hdr ${W_NS}>${para(run("{Company"), run("Na"), run("me} | {Today}"))}</w:hdr>`,
      "word/styles.xml": STYLES,
    },
  );

const unzip = (bytes: Buffer) => unzipSync(new Uint8Array(bytes));
const part = (bytes: Buffer, path: string) => strFromU8(unzip(bytes)[path]!);

const xmlText = (text: string) =>
  text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** The text of each paragraph, with Word line breaks as "\n". */
function paragraphs(xml: string): string[] {
  return xml
    .split("</w:p>")
    .slice(0, -1)
    .map((p) =>
      [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:br\/>/g)]
        .map((m) => (m[0] === "<w:br/>" ? "\n" : xmlText(m[1]!)))
        .join(""),
    );
}

describe("Word templates", () => {
  it("finds the tags in the body and headers, even split over several runs", () => {
    expect(docxTags(quotationDocx())).toEqual([
      "BuyerName",
      "TotalAmount",
      "ItemNo",
      "ItemDescription",
      "ItemQuantity",
      "TotalQuantity",
      "BuyerAddress",
      "BuyerContactPerson",
      "Customer",
      "Mystery",
      "Unknown",
      "CompanyName",
      "Today",
    ]);
  });

  it("fills every tag, repeats the item row per line and keeps the formatting", () => {
    const source = quotationDocx();
    const filled = fillDocx(source, quotationResolver(), DATA.items);
    const xml = part(filled, "word/document.xml");
    expect(paragraphs(xml)).toEqual([
      "Dear Rahim Traders, total 1,200.00.",
      "No",
      "Item",
      "Qty",
      "1",
      "Polo shirt",
      "100",
      "2",
      "T-shirt",
      "200",
      "Total",
      "",
      "300",
      "Items: Polo shirt\nT-shirt",
      "Address: 12 <Road> & Sons\nDhaka",
      "Attn: Mr Karim / RAHIM TRADERS / ",
      "{Split",
      "Tag}",
    ]);
    // The value takes the formatting of the run the tag started in.
    expect(xml).toContain(
      '<w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Dear Rahim Traders</w:t>',
    );
    expect(xml).toContain("12 &lt;Road&gt; &amp; Sons</w:t><w:br/>");
    expect(xml.match(/<w:tr>/g)).toHaveLength(4);
    expect(paragraphs(part(filled, "word/header1.xml"))).toEqual(["Extras | 3 Oct 2026"]);
    // Everything else is kept as it was.
    const before = unzip(source);
    const after = unzip(filled);
    expect(after["word/styles.xml"]).toEqual(before["word/styles.xml"]);
    expect(after["[Content_Types].xml"]).toEqual(before["[Content_Types].xml"]);
    // The result is a Word file again.
    expect(() => openDocx(filled)).not.toThrow();
  });

  it("drops the item row when the document has no lines", () => {
    const xml = part(fillDocx(quotationDocx(), quotationResolver(), []), "word/document.xml");
    expect(xml.match(/<w:tr>/g)).toHaveLength(2);
  });

  it("never reads tags inside the values it writes", () => {
    const sneaky = quotationResolver({
      ...DATA,
      values: { ...DATA.values, "buyer.name": "{CompanyName}" },
    });
    const xml = part(fillDocx(quotationDocx(), sneaky, DATA.items), "word/document.xml");
    expect(paragraphs(xml)[0]).toBe("Dear {CompanyName}, total 1,200.00.");
  });

  it("refuses files that are not plain Word documents", async () => {
    expect(await refusal(() => docxTags(Buffer.from("not a zip at all")))).toMatch(/damaged/);
    const notWord = Buffer.from(zipSync({ "content.xml": strToU8("<office/>") }));
    expect(await refusal(() => docxTags(notWord))).toMatch(/not a Word document/);
    const withMacros = makeDocx(para(run("{BuyerName}")), {
      "word/vbaProject.bin": new Uint8Array([1, 2, 3]),
    });
    expect(await refusal(() => docxTags(withMacros))).toMatch(/macros/);
    const docm = makeDocx(
      para(run("{BuyerName}")),
      {},
      CONTENT_TYPES.replace(
        "wordprocessingml.document.main+xml",
        "application/vnd.ms-word.document.macroEnabled.main+xml",
      ),
    );
    expect(await refusal(() => docxTags(docm))).toMatch(/macros/);
    const crowded = makeDocx(
      para(run("x")),
      Object.fromEntries(Array.from({ length: 2_000 }, (_, i) => [`word/media/${i}.txt`, "x"])),
    );
    expect(await refusal(() => docxTags(crowded))).toMatch(/too large/);
  });
});

// --- HTML templates ------------------------------------------------------------------

const QUOTE_HTML = `<!doctype html><html><head><style>td { border: 1px solid #000 }</style></head><body>
<h1 title="{BuyerName}">Quotation {QuotationNo}</h1>
<p>Dear {{ BuyerName }},<br>{BuyerAddress}</p>
<table><tr><th>No</th><th>Item</th></tr><tr><td>{ItemNo}</td><td>{ItemDescription}</td></tr><tr><td>Total</td><td>{TotalAmount}</td></tr></table>
<p>All items: {ItemDescription}</p>
</body></html>`;

describe("HTML templates", () => {
  it("finds the tags", () => {
    expect(htmlTags(QUOTE_HTML)).toEqual([
      "BuyerName",
      "QuotationNo",
      "BuyerAddress",
      "ItemNo",
      "ItemDescription",
      "TotalAmount",
    ]);
  });

  it("fills the tags with escaped values and repeats the item row", () => {
    const quoted = quotationResolver({
      ...DATA,
      values: { ...DATA.values, "buyer.name": `Rahim "R" Traders` },
    });
    const html = fillHtml(QUOTE_HTML, quoted, DATA.items);
    expect(html).toContain('<h1 title="Rahim &quot;R&quot; Traders">Quotation QT-2026-0001</h1>');
    expect(html).toContain(
      "<p>Dear Rahim &quot;R&quot; Traders,<br>12 &lt;Road&gt; &amp; Sons<br>Dhaka</p>",
    );
    expect(html).toContain(
      "<tr><td>1</td><td>Polo shirt</td></tr><tr><td>2</td><td>T-shirt</td></tr><tr><td>Total</td><td>1,200.00</td></tr>",
    );
    expect(html).toContain("<p>All items: Polo shirt<br>T-shirt</p>");
    expect(html).toContain("<style>td { border: 1px solid #000 }</style>");
  });

  it("repeats only the innermost row of nested tables", () => {
    const html =
      "<table><tr><td>Lines:<table><tr><td>{ItemDescription}</td></tr></table></td></tr></table>";
    expect(fillHtml(html, quotationResolver(), DATA.items)).toBe(
      "<table><tr><td>Lines:<table><tr><td>Polo shirt</td></tr><tr><td>T-shirt</td></tr></table></td></tr></table>",
    );
  });

  it("never reads tags inside the values it writes", () => {
    const sneaky = quotationResolver({
      ...DATA,
      values: { ...DATA.values, "buyer.name": "{CompanyName}<script>" },
    });
    expect(fillHtml("<p>{BuyerName}</p>", sneaky, [])).toBe("<p>{CompanyName}&lt;script&gt;</p>");
  });

  it("refuses anything that could run", async () => {
    const cases: Array<[string, RegExp]> = [
      ["<p>Hi</p><script>alert(1)</script>", /scripts/],
      ["<p>Hi</p><SCRIPT src=x>", /scripts/],
      ['<img src="x" onerror="alert(1)">', /event handlers/],
      ["<body onload=alert(1)>", /event handlers/],
      ["<svg/onload=alert(1)>", /event handlers/],
      ['<a href="javascript:alert(1)">x</a>', /javascript: links/],
      ['<a href="jav&#x61;script:alert(1)">x</a>', /javascript: links/],
      ['<a href="&#106;avascript&colon;alert(1)">x</a>', /javascript: links/],
      ['<a href="java\tscript:alert(1)">x</a>', /javascript: links/],
      ['<div style="background: url(javascript:alert(1))">x</div>', /javascript: links/],
      ['<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>', /embedded HTML pages/],
      ['<iframe src="https://example.com"></iframe>', /frames or objects/],
      ['<object data="x.swf"></object>', /frames or objects/],
      ['<form action="/x"><input name="a"></form>', /form fields/],
      ['<meta http-equiv="refresh" content="0;url=https://example.com">', /meta http-equiv/],
      ['<base href="https://example.com/">', /<base> tag/],
      ["just some text", /does not look like an HTML page/],
      [`<p>${"a".repeat(1_000_001)}</p>`, /up to 1 MB/],
    ];
    for (const [html, why] of cases) expect(await refusal(() => checkHtml(html))).toMatch(why);
  });

  it("accepts plain documents", async () => {
    const plain = [
      "<p>Payment on delivery = 50%</p>",
      '<p class="online" data-on="1">Bank: <a href="https://extras.test/terms">terms</a></p>',
      '<img src="data:image/png;base64,iVBORw0KGgo=" alt="logo">',
      "<td style=\"font-family: 'Noto Sans Bengali'\">মোট {TotalAmount}</td>",
    ];
    for (const html of plain) expect(await refusal(() => checkHtml(html))).toBe("(accepted)");
  });

  it("reads uploaded pages as UTF-8 text", () => {
    expect(decodeHtml(Buffer.from("\uFEFF<html><body>{BuyerName}</body></html>"))).toBe(
      "<html><body>{BuyerName}</body></html>",
    );
    expect(decodeHtml(Buffer.from([0x3c, 0x70, 0x3e, 0xff, 0xfe]))).toBeNull();
    expect(decodeHtml(Buffer.from("Dear {BuyerName}"))).toBeNull();
  });
});

// --- PDF and image templates -----------------------------------------------------------

const A4 = { width: 595.28, height: 841.89 };
/** Helvetica's top of the letters, as a share of the size. */
const ASCENT = 0.718;

const place = (name: string, extra: Partial<Placement> = {}): Placement => ({
  name,
  page: 1,
  x: 100,
  y: 50,
  fontSize: 10,
  bold: false,
  align: "left",
  width: null,
  ...extra,
});

async function samplePdf(sizes: Array<[number, number]>, rotate = 0): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (const [width, height] of sizes) {
    const page = pdf.addPage([width, height]);
    page.drawText("Order form", { x: 40, y: height - 60, size: 14 });
    if (rotate) page.setRotation(degrees(rotate));
  }
  return Buffer.from(await pdf.save());
}

/** The text drawn by the forms laid over a page of a saved PDF (empty when none). */
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

async function widthOf(text: string, font: string, size: number) {
  const doc = await createPdf({ autoFirstPage: false });
  return textWidth(doc, text, { font, size });
}

describe("PDF templates", () => {
  it("reads each page's size", async () => {
    const pdf = await samplePdf([
      [A4.width, A4.height],
      [612, 792],
    ]);
    expect(await readPdfTemplate(pdf)).toEqual([A4, { width: 612, height: 792 }]);
    // What is printed is the crop box.
    const cropped = await PDFDocument.load(pdf);
    cropped.getPages()[1]!.setCropBox(36, 36, 540, 720);
    expect(await readPdfTemplate(Buffer.from(await cropped.save()))).toEqual([
      A4,
      { width: 540, height: 720 },
    ]);
  });

  it("refuses PDFs it cannot write on", async () => {
    expect(await refusal(() => readPdfTemplate(Buffer.from("%PDF-1.7 nothing here")))).toMatch(
      /cannot be read|no pages/,
    );
    const turned = await samplePdf([[A4.width, A4.height]], 90);
    expect(await refusal(() => readPdfTemplate(turned))).toMatch(/rotated/);
    const long = await samplePdf(Array.from({ length: 21 }, () => [A4.width, A4.height]));
    expect(await refusal(() => readPdfTemplate(long))).toMatch(/up to 20 pages/);
  });

  it("writes each value at its place, from the top-left of the page", async () => {
    const total = "1,200.00";
    const overlay = await renderOverlay(
      [{ page: 1, size: A4 }],
      [
        place("BuyerName"),
        place("TotalAmount", { x: 400, y: 100, width: 100, align: "right", bold: true }),
        place("Customer", { x: 0, y: 300, width: A4.width, align: "center" }),
        place("BuyerAddress", { x: 60, y: 150 }),
        place("ItemDescription", { x: 50, y: 200 }),
        place("Notes", { x: 10, y: 400, width: 60 }),
        place("Mystery", { y: 500 }),
        place("ItemQuantity", { page: 2 }),
      ],
      quotationResolver(),
      "Quotation QT-2026-0001",
    );
    expect(pageCount(overlay)).toBe(1);
    const blocks = pdfTextBlocks(overlay);
    const block = (text: string) => blocks.find((b) => b.text === text)!;
    expect(blocks.map((b) => b.text)).toEqual([
      "Rahim Traders",
      total,
      "RAHIM TRADERS",
      "12 <Road> & Sons",
      "Dhaka",
      "Polo shirt",
      "T-shirt",
      expect.stringMatching(/^Deliver.*…$/),
    ]);
    expect(block("Rahim Traders")).toMatchObject({ font: "Helvetica", x: 100 });
    expect(block("Rahim Traders").y).toBeCloseTo(A4.height - 50 - 10 * ASCENT, 2);
    expect(block(total).font).toBe("Helvetica-Bold");
    expect(block(total).x).toBeCloseTo(500 - (await widthOf(total, "Helvetica-Bold", 10)), 2);
    expect(block("RAHIM TRADERS").x).toBeCloseTo(
      (A4.width - (await widthOf("RAHIM TRADERS", "Helvetica", 10))) / 2,
      2,
    );
    // Each further line is 1.25 times the size lower.
    expect(block("12 <Road> & Sons").y - block("Dhaka").y).toBeCloseTo(12.5, 2);
    expect(block("Polo shirt").y - block("T-shirt").y).toBeCloseTo(12.5, 2);
    expect(block("Polo shirt").x).toBe(50);
  });

  it("writes Bengali values in Bengali", async () => {
    const bengali = makeResolver(new Map(), "QUOTATION", {
      values: { "buyer.name": "রহিম ট্রেডার্স" },
      items: [],
    });
    const overlay = await renderOverlay(
      [{ page: 1, size: A4 }],
      [place("BuyerName")],
      bengali,
      "x",
    );
    expect(pdfLines(overlay)).toEqual(["রহিম ট্রেডার্স"]);
  });

  it("lays the values over the template's own pages", async () => {
    const template = await samplePdf([
      [A4.width, A4.height],
      [612, 792],
    ]);
    const filled = await fillPdfTemplate(
      template,
      [place("BuyerName", { page: 2 }), place("TotalAmount", { page: 9 })],
      quotationResolver(),
      "Quotation QT-2026-0001",
    );
    const pdf = await PDFDocument.load(filled);
    expect(pdf.getTitle()).toBe("Quotation QT-2026-0001");
    expect(pdf.getPages().map((p) => p.getSize())).toEqual([A4, { width: 612, height: 792 }]);
    expect(overlayText(pdf, 0)).toBe("");
    expect(overlayText(pdf, 1)).toBe("Rahim Traders");
    // The template's own drawing is still there.
    expect(pdf.getPages()[1]!.node.Contents()).toBeDefined();
  });

  it("leaves a template with nothing placed as it was", async () => {
    const template = await samplePdf([[A4.width, A4.height]]);
    const pdf = await PDFDocument.load(
      await fillPdfTemplate(template, [], quotationResolver(), "Blank"),
    );
    expect(pdf.getPageCount()).toBe(1);
    expect(overlayText(pdf, 0)).toBe("");
  });
});

describe("image templates", () => {
  it("prints the picture A4 wide, or A4 landscape when wider than tall", () => {
    const upright = readImageTemplate(png({ width: 200, height: 283 }));
    expect(upright.image).toMatchObject({ mimeType: "image/png", width: 200, height: 283 });
    expect(upright.page).toEqual({
      width: A4.width,
      height: Math.round(((A4.width * 283) / 200) * 100) / 100,
    });
    const wide = readImageTemplate(png({ width: 300, height: 150 }));
    expect(wide.page).toEqual({
      width: 841.89,
      height: Math.round(((841.89 * 150) / 300) * 100) / 100,
    });
  });

  it("refuses files that are not usable pictures", () => {
    expect(() => readImageTemplate(Buffer.from("not a picture"))).toThrow(TemplateFileError);
    expect(() => readImageTemplate(png({ width: 6000, height: 10 }))).toThrow(TemplateFileError);
  });

  it("makes a one-page PDF of the picture with the values on it", async () => {
    const image = png({ width: 200, height: 283 });
    const { page } = readImageTemplate(image);
    const pdf = await fillImageTemplate(
      image,
      page,
      [place("BuyerName", { x: 50, y: 60 }), place("TotalAmount", { page: 2 })],
      quotationResolver(),
      "Quotation QT-2026-0001",
    );
    expect(pageCount(pdf)).toBe(1);
    expect(pdf.toString("latin1")).toMatch(/\/Subtype \/Image/);
    expect(pdfLines(pdf)).toEqual(["Rahim Traders"]);
  });
});

describe("filled files as downloads", () => {
  const file = (fileName: string, mimeType: string) => ({
    fileName,
    mimeType,
    bytes: Buffer.from("x"),
  });

  it("opens PDFs in the browser when asked, and always saves Word and HTML files, sandboxed", () => {
    const pdf = fileResponse(file("Quotation.pdf", "application/pdf"), "inline");
    expect(pdf.headers.get("Content-Disposition")).toBe("inline; filename*=UTF-8''Quotation.pdf");
    expect(pdf.headers.get("Content-Security-Policy")).toBeNull();
    for (const mimeType of [HTML_MIME, DOCX_MIME, "image/svg+xml"]) {
      const response = fileResponse(file("Quotation (1).html", mimeType), "inline");
      expect(response.headers.get("Content-Disposition")).toBe(
        "attachment; filename*=UTF-8''Quotation%20%281%29.html",
      );
      expect(response.headers.get("Content-Security-Policy")).toBe("sandbox");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
  });
});
