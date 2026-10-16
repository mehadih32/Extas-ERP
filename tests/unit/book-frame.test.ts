import { describe, expect, it } from "vitest";

import { bookFrame, contactLine, parseOrientation } from "@/modules/documents/book-frame";
import type { PrintDocument } from "@/modules/documents/model";
import { renderDocumentPdf } from "@/modules/documents/render";
import { DEFAULT_TAGLINE } from "@/modules/documents/tagline";
import { SWATCH_ROW_HEIGHT, swatchListBlocks } from "@/modules/production/swatch-list";

import { pageCount, pdfLines, pdfTextBlocks } from "../fixtures/pdf";

const COMPANY = {
  name: "Extas",
  phone: "+8801764751616",
  email: "info@extas.com.bd",
  address: "House-17, Road-08\nNikunja-02, Dhaka",
  tagline: null,
};

const MM = 72 / 25.4;

/** A booking in the book frame: one fabric table, then the swatch list on a page of its own. */
function sampleBook(orientation: "landscape" | "portrait"): PrintDocument {
  return {
    type: "BOOKING",
    title: "Fabric & Trims Booking",
    reference: "PO-2026-00007",
    letterhead: {
      name: "Extas",
      legalName: null,
      contacts: [],
      footer: "Extas",
      primaryColor: "#0B3D2E",
      accentColor: "#BE1434",
    },
    meta: [],
    parties: [],
    signatures: [],
    blocks: [
      {
        kind: "section",
        title: "Fabric & Trims Booking · Square Knit Fabrics",
        label: "Booking · PO-2026-00007",
      },
      {
        kind: "parties",
        parties: [{ heading: "Supplier", lines: ["Square Knit Fabrics", "Gazipur"] }],
      },
      {
        kind: "table",
        title: "Fabric",
        columns: [
          { label: "#", align: "right", weight: 0.4 },
          { label: "Fabric", weight: 3 },
          { label: "Quantity", align: "right" },
        ],
        rows: Array.from({ length: 30 }, (_, i) => ({
          cells: [String(i + 1), `Single pique, shade ${i + 1}`, "120 kg"],
          shaded: i % 2 === 1,
        })),
      },
      ...swatchListBlocks(
        "Square Knit Fabrics",
        [
          { label: "A-01 · Navy", quantity: 171, unit: "KG" },
          { label: "A-02 · White", quantity: 114, unit: "KG" },
        ],
        "BDT",
      ),
    ],
    frame: bookFrame(COMPANY, {
      orientation,
      docNo: "PO-2026-00007",
      buyerPo: "MB-2026-00001",
      date: "15 Oct 2026",
    }),
  };
}

const mediaBox = (pdf: Buffer) =>
  /\/MediaBox \[([\d. ]+)\]/.exec(pdf.toString("latin1"))![1]!.split(" ").map(Number);

describe("the book frame's settings", () => {
  it("reads the orientation from a download link, and nothing else", () => {
    expect(parseOrientation("Landscape")).toBe("landscape");
    expect(parseOrientation(" portrait ")).toBe("portrait");
    expect(parseOrientation("sideways")).toBeNull();
    expect(parseOrientation(null)).toBeNull();
  });

  it("prints the company's own contacts and tagline, the default when it has none", () => {
    expect(contactLine(COMPANY)).toBe(
      "EXTAS | +8801764751616 | info@extas.com.bd | House-17, Road-08, Nikunja-02, Dhaka",
    );
    expect(contactLine({ name: "Shop Two", phone: null, email: null, address: null })).toBe(
      "SHOP TWO",
    );
    const header = {
      orientation: "portrait",
      docNo: "BB-1",
      buyerPo: "PO 7",
      date: "1 Nov 2026",
    } as const;
    const frame = bookFrame(COMPANY, header);
    expect(frame.tagline).toBe(DEFAULT_TAGLINE);
    expect(frame.fields.map((f) => f.label)).toEqual([
      "Doc no",
      "Buyer · PO",
      "Date",
      "Prepared by",
    ]);
    expect(frame.fields.at(-1)!.value).toBe("");
    expect(bookFrame({ ...COMPANY, tagline: "Knitwear for export" }, header).tagline).toBe(
      "Knitwear for export",
    );
  });
});

describe("the fabric swatch list", () => {
  it("gives each style and colour a row tall enough to paste a swatch, and a total row", () => {
    const [section, table] = swatchListBlocks(
      "Square Knit",
      [
        { label: "A-01 · Navy", quantity: 171.5, unit: "KG" },
        { label: "B-01 · Black", quantity: 18.2, unit: "KG" },
        { label: "C-01 · Sky", quantity: 120, unit: "YARD" },
      ],
      "BDT",
    );
    expect(section).toMatchObject({ kind: "section", label: "Swatch list" });
    if (table?.kind !== "table") throw new Error("no table");
    expect(table.columns.map((c) => c.label)).toEqual([
      "SL No.",
      "Swatch paste area",
      "Style · colour",
      "Quantity",
      "No. of rolls",
      "Cutting report",
    ]);
    expect(table.rows).toHaveLength(4);
    expect(table.rows[0]!.height).toBeCloseTo(15 * MM);
    expect(table.rows[0]!.cells.slice(0, 3)).toEqual(["1", "", "A-01 · Navy"]);
    expect(table.rows.at(-1)).toMatchObject({ style: "total" });
    expect(table.rows.at(-1)!.cells[1]).toBe("TOTAL SQUARE KNIT FABRIC");
    expect(table.rows.at(-1)!.cells[3]).toMatch(/^189\.7 kg \+ 120 y/);
    expect(table.rows.at(-1)!.cells[4]).toBe("____ - Roll");
    expect(SWATCH_ROW_HEIGHT).toBeCloseTo(42.52, 1);
    expect(swatchListBlocks("Square Knit", [], "BDT")).toEqual([]);
  });
});

describe("book-frame PDFs", () => {
  it("prints landscape A4 with the header, navy tables and the footer on every page", async () => {
    const pdf = await renderDocumentPdf(sampleBook("landscape"), { compress: false });
    expect(mediaBox(pdf)).toEqual([0, 0, 841.89, 595.28]);
    const pages = pageCount(pdf);
    expect(pages).toBeGreaterThanOrEqual(3);
    const lines = pdfLines(pdf);
    for (const text of [
      "Extas",
      DEFAULT_TAGLINE,
      "Fabric & Trims Booking",
      "DOC NO",
      "BUYER · PO",
      "PREPARED BY",
      "PO-2026-00007",
      "MB-2026-00001",
      "Fabric & Trims Booking · Square Knit Fabrics",
      "SUPPLIER",
      "FABRIC",
      "QUANTITY",
      "SWATCH PASTE AREA",
      "TOTAL SQUARE KNIT FABRICS FABRIC",
      "____ - Roll",
    ]) {
      expect(lines).toContain(text);
    }
    const contact = contactLine(COMPANY);
    expect(lines).toContain(`${contact} • PAGE 1 OF ${pages}`);
    expect(lines).toContain(`${contact} • PAGE ${pages} OF ${pages}`);
    // The header names the part each page is in.
    expect(lines.filter((l) => l === "BOOKING · PO-2026-00007").length).toBe(pages - 1);
    expect(lines).toContain("SWATCH LIST");
    // The swatch list starts on a page of its own.
    expect(lines.filter((l) => l === "Fabric swatch list · Square Knit Fabrics")).toHaveLength(1);
    // Nothing is printed in the binding strip at the top (PDF heights count from the bottom).
    const height = 595.28;
    for (const block of pdfTextBlocks(pdf)) expect(block.y).toBeLessThan(height - 15 * MM);
    // Navy (#1F4E79) headers, rules and titles.
    expect(pdf.toString("latin1")).toContain(
      "0.12156862745098039 0.3058823529411765 0.4745098039215686 scn",
    );
  });

  it("prints portrait A4 the same way when it is picked", async () => {
    const pdf = await renderDocumentPdf(sampleBook("portrait"), { compress: false });
    expect(mediaBox(pdf)).toEqual([0, 0, 595.28, 841.89]);
    const lines = pdfLines(pdf);
    const pages = pageCount(pdf);
    expect(lines).toContain(`${contactLine(COMPANY)} • PAGE ${pages} OF ${pages}`);
    for (const block of pdfTextBlocks(pdf)) expect(block.y).toBeLessThan(841.89 - 15 * MM);
  });
});

/** A booking frame document holding only `blocks`, under a company named `name`. */
function framed(
  blocks: PrintDocument["blocks"],
  company: Partial<typeof COMPANY> = {},
  preparedBy: string | null = "Rahima Akter",
  orientation: "landscape" | "portrait" = "landscape",
): PrintDocument {
  const doc = sampleBook(orientation);
  return {
    ...doc,
    letterhead: { ...doc.letterhead, name: company.name ?? COMPANY.name },
    blocks,
    frame: bookFrame(
      { ...COMPANY, ...company },
      {
        orientation,
        docNo: "PO-2026-00007",
        buyerPo: "MB-2026-00001",
        date: "15 Oct 2026",
        preparedBy,
      },
    ),
  };
}

/** A colour-by-size table: a text column, then one right-aligned column per size and a total. */
function sizeTable(sizes: number, figure: (row: number, size: number) => string) {
  const labels = Array.from({ length: sizes }, (_, i) => `Size ${i + 1}`);
  return {
    kind: "table" as const,
    title: "Quantities",
    columns: [
      { label: "Colour", weight: 2 },
      ...labels.map((label) => ({ label, align: "right" as const })),
      { label: "Total", align: "right" as const },
    ],
    rows: Array.from({ length: 3 }, (_, r) => ({
      cells: [
        `Colour ${r + 1}`,
        ...labels.map((_, s) => figure(r, s)),
        figure(r, sizes).replace(/^/, "9"),
      ],
    })),
  };
}

describe("figures in a booking table are never cut (v6.3)", () => {
  it("shrinks the text so twelve sizes of five-figure quantities print whole", async () => {
    const table = sizeTable(12, (r, s) => `${12 + r},${String(345 + s).padStart(3, "0")}`);
    const pdf = await renderDocumentPdf(framed([table]), { compress: false });
    const lines = pdfLines(pdf);
    expect(lines.join("\n")).not.toContain("…");
    for (const row of table.rows) for (const cell of row.cells) expect(lines).toContain(cell);
    // One table: nothing had to be split.
    expect(lines.filter((l) => l.startsWith("QUANTITIES"))).toEqual(["QUANTITIES"]);
  });

  it("splits the sizes over more tables, each with the colour again, when even the smallest text is too big", async () => {
    const table = sizeTable(30, (r, s) => `${100 + r},${String(100 + s).padStart(3, "0")}.50`);
    const pdf = await renderDocumentPdf(framed([table]), { compress: false });
    const lines = pdfLines(pdf);
    expect(lines.join("\n")).not.toContain("…");
    for (const row of table.rows) for (const cell of row.cells) expect(lines).toContain(cell);
    const continued = lines.filter((l) => l.startsWith("QUANTITIES (CONTINUED: SIZE "));
    expect(continued.length).toBeGreaterThanOrEqual(1);
    // Every part repeats the colours.
    expect(lines.filter((l) => l === "Colour 1").length).toBe(continued.length + 1);
  });

  it("wraps a column heading that is wider than its column, never cutting it", async () => {
    // The collar matrix with 14 size groups printed "GARMENT COL…" (found in the release samples).
    const base = sizeTable(14, (r, s) => `${10 + r},${String(100 + s).padStart(3, "0")}`);
    const table = {
      ...base,
      columns: [
        { label: "Garment colour", weight: 2 },
        { label: "Collar colour", weight: 2.2 },
        ...base.columns.slice(1),
      ],
      rows: base.rows.map((r) => ({ ...r, cells: [r.cells[0]!, "Navy", ...r.cells.slice(1)] })),
    };
    const pdf = await renderDocumentPdf(framed([table]), { compress: false });
    const lines = pdfLines(pdf);
    expect(lines.join("\n")).not.toContain("…");
    expect(lines.join("\n")).toMatch(/GARMENT\s+COLOUR|GARMENT[\s\S]*COLOUR/);
    for (const row of table.rows) for (const cell of row.cells) expect(lines).toContain(cell);
  });

  it("leaves a table that already fits at the usual size", async () => {
    const table = sizeTable(4, () => "120");
    const pdf = await renderDocumentPdf(framed([table]), { compress: false });
    const lines = pdfLines(pdf);
    expect(lines.filter((l) => l.startsWith("QUANTITIES"))).toEqual(["QUANTITIES"]);
    expect(lines).toContain("SIZE 4");
  });
});

describe("long names in the book frame wrap instead of being cut (v6.3)", () => {
  const LONG_NAME = "Extas Apparel Manufacturing Sourcing and Export Private Limited Company";
  const LONG_ADDRESS =
    "House-17, Road-08, Block C, Nikunja-02, Khilkhet, Dhaka 1229, Bangladesh, near the Jamuna Future Park gate 3";

  it("prints the page number whole and the company name and address in full", async () => {
    const company = {
      ...COMPANY,
      name: LONG_NAME,
      address: LONG_ADDRESS,
      email: "merchandising.department@extas.com.bd",
    };
    const doc = framed([{ kind: "text", title: "Note", paragraphs: ["One page."] }], company);
    const pdf = await renderDocumentPdf(doc, { compress: false });
    const lines = pdfLines(pdf);
    const all = lines.join("\n");
    expect(all).not.toContain("…");
    const pages = pageCount(pdf);
    expect(lines).toContain(`PAGE 1 OF ${pages}`);
    // The name and the contact line wrap to a second line, every word kept.
    const words = (s: string) => s.split(/\s+/).filter(Boolean);
    for (const word of words(LONG_NAME)) expect(all).toContain(word);
    for (const word of words(contactLine(company))) expect(all).toContain(word);
  });

  it("keeps a very long company name whole in portrait too (three lines)", async () => {
    // Found in the release samples: portrait's narrower header cut it on the second line.
    const name = "Extas Apparel Sourcing and Garment Manufacturing International Limited";
    const doc = framed(
      [{ kind: "text", title: "Note", paragraphs: ["One page."] }],
      { ...COMPANY, name },
      "Rahima Akter",
      "portrait",
    );
    const pdf = await renderDocumentPdf(doc, { compress: false });
    const all = pdfLines(pdf).join("\n");
    expect(all).not.toContain("…");
    for (const word of name.split(" ")) expect(all).toContain(word);
  });

  it("wraps a long buyer and order in the header's right column", async () => {
    const doc = framed([{ kind: "note", text: "x" }]);
    doc.frame!.fields[1]!.value =
      "Northern Lights Fashion Retail Group International · PO NLF-2026-0001234-A";
    const pdf = await renderDocumentPdf(doc, { compress: false });
    const all = pdfLines(pdf).join("\n");
    expect(all).not.toContain("…");
    for (const word of ["Northern", "International", "NLF-2026-0001234-A"])
      expect(all).toContain(word);
  });
});

describe("PREPARED BY names the person who made the booking (v6.3)", () => {
  it("prints the name beside a signature line", async () => {
    const pdf = await renderDocumentPdf(framed([{ kind: "note", text: "x" }]), {
      compress: false,
    });
    const lines = pdfLines(pdf);
    expect(lines).toContain("PREPARED BY");
    expect(lines).toContain("Rahima Akter");
    expect(
      bookFrame(COMPANY, {
        orientation: "portrait",
        docNo: "1",
        buyerPo: "",
        date: "",
        preparedBy: "  Karim ",
      }).fields.at(-1),
    ).toEqual({ label: "Prepared by", value: "Karim", sign: true });
  });

  it("leaves a line to write on when nobody is known", async () => {
    const pdf = await renderDocumentPdf(framed([{ kind: "note", text: "x" }], {}, null), {
      compress: false,
    });
    expect(pdfLines(pdf)).toContain("PREPARED BY");
    expect(pdfLines(pdf)).not.toContain("Rahima Akter");
  });
});
