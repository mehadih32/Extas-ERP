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
