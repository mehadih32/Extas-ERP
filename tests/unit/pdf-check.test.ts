import PDFDocument from "pdfkit";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { bookFrame } from "@/modules/documents/book-frame";
import type { PrintDocument } from "@/modules/documents/model";
import { renderDocumentPdf } from "@/modules/documents/render";
import { fixIssue } from "@/modules/ai/full-check/texts";

import { madeByErp, pdfPages, pdfProblems } from "../../scripts/full-check/pdf-text.mjs";

/*
 * v6.4: the Full check reads the text of every PDF the ERP makes that it downloads
 * (scripts/full-check/pdf-text.mjs): no figure is ever cut short with "…", and a PDF
 * of more than one page has its page number on every page.
 */

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

/** A PDF drawn by hand with the ERP's PDF writer: each page's lines. */
function handMade(pages: string[][], producer: string | null = "Extas ERP"): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      autoFirstPage: false,
      compress: true,
      info: producer ? { Producer: producer, Creator: producer } : {},
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    for (const lines of pages) {
      doc.addPage();
      lines.forEach((line, i) =>
        doc
          .font("Helvetica")
          .fontSize(10)
          .text(line, 50, 60 + i * 20),
      );
    }
    doc.end();
  });
}

/** A booking of 30 fabric lines: more than one page. */
function booking(framed: boolean): PrintDocument {
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
        kind: "table",
        title: "Fabric",
        columns: [
          { label: "#", align: "right", weight: 0.4 },
          { label: "Fabric", weight: 3 },
          { label: "Quantity", align: "right" },
          { label: "Amount", align: "right" },
        ],
        rows: Array.from({ length: 60 }, (_, i) => ({
          cells: [String(i + 1), `Single pique, shade ${i + 1}`, "120 kg", "25,27,434.28"],
        })),
      },
    ],
    ...(framed
      ? {
          frame: bookFrame(
            {
              name: "Extas",
              phone: "+8801764751616",
              email: "info@extas.com.bd",
              address: "Dhaka",
              tagline: null,
            },
            {
              orientation: "landscape",
              docNo: "PO-2026-00007",
              buyerPo: "MB-1",
              date: "1 Nov 2026",
            },
          ),
        }
      : {}),
  } as PrintDocument;
}

describe("The Full check's look at the ERP's PDFs", () => {
  it("passes the ERP's own documents: every page numbered, no figure cut", async () => {
    for (const framed of [false, true]) {
      const pdf = await renderDocumentPdf(booking(framed));
      expect(madeByErp(pdf)).toBe(true);
      const pages = pdfPages(pdf);
      expect(pages.length).toBeGreaterThanOrEqual(2);
      expect(pages.flat().join("\n")).toContain("25,27,434.28");
      expect(pdfProblems(pdf)).toEqual([]);
    }
  });

  it('finds a figure cut short with "…" and a page without its page number', async () => {
    const pdf = await handMade([
      ["Batch summary", "Final payable to the factory 25,27,4…", "Page 1 of 2"],
      ["Signatures", "Prepared by"],
    ]);
    expect(pdfProblems(pdf)).toEqual([
      {
        what: "CUT_FIGURE",
        page: 1,
        detail: 'has a figure cut short with "…" on page 1',
        text: "Final payable to the factory 25,27,4…",
      },
      { what: "NO_PAGE_NUMBER", page: 2, detail: "has no page number on page 2" },
    ]);
    // A wrong number is no page number either.
    const wrong = await handMade([["Page 1 of 2"], ["Page 1 of 2"]]);
    expect(pdfProblems(wrong).map((p) => [p.what, p.page])).toEqual([["NO_PAGE_NUMBER", 2]]);
  });

  it("knows the page numbers of the booking book and the restore guide", async () => {
    const book = await handMade([["PAGE 1 OF 2"], ["PAGE 2 OF 2"]]);
    expect(pdfProblems(book)).toEqual([]);
    const guide = await handMade([["Page 1 / 2"], ["Page 2 / 2"]]);
    expect(pdfProblems(guide)).toEqual([]);
  });

  it("asks no page number of a one-page PDF, and leaves PDFs it did not make alone", async () => {
    expect(pdfProblems(await handMade([["Payment receipt", "Total 1,200.00"]]))).toEqual([]);
    const theirs = await handMade([["A buyer's tech pack 12…"], ["no number"]], null);
    expect(madeByErp(theirs)).toBe(false);
    expect(pdfProblems(theirs)).toEqual([]);
  });

  it("runs on every PDF the Full check downloads, and its issue says what is wrong", () => {
    const crawler = read("scripts/full-check/crawl.mjs");
    expect(crawler).toContain('from "./pdf-text.mjs"');
    expect(crawler).toContain("pdfProblems(bytes)");
    const { body } = fixIssue({
      problems: [
        {
          kind: "PDF",
          screen: "/production/bookings/cm4x1y2z3a4b5c6d7e8f9g0h1",
          pattern: "/production/bookings/[bookingId]",
          detail: [
            "GET /api/production/bookings/cm4x1y2z3a4b5c6d7e8f9g0h1/pdf has no page number on page 2",
            'GET /api/production/bookings/cm4x1y2z3a4b5c6d7e8f9g0h1/pdf has a figure cut short with "…" on page 3',
            "Final payable to Rahim 25,27,4…",
          ].join("\n"),
          ms: null,
        },
      ],
      site: "demo",
      at: "2026-10-16 05:00 UTC",
      runId: "run1",
      issue: 7,
    });
    expect(body).toContain("`GET /api/production/bookings/[id]/pdf has no page number on page 2`");
    expect(body).toContain(
      '`GET /api/production/bookings/[id]/pdf has a figure cut short with "…" on page 3`',
    );
    expect(body).not.toContain("Rahim");
    expect(body).not.toContain("25,27");
  });
});

describe("Printed words never look like a cut figure", () => {
  it('has no digit followed by "..." or "…" in the text the ERP prints', () => {
    // The Full check flags a digit then "…" or "..." as a figure cut short, so prose
    // writes "A-01, A-02 and so on" instead. Only code that cuts text on purpose may.
    const root = path.resolve(__dirname, "../..");
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? files(path.join(dir, e.name))
          : /\.(ts|tsx)$/.test(e.name)
            ? [path.join(dir, e.name)]
            : [],
      );
    const found = files(path.join(root, "src/modules"))
      .filter((f) => !f.includes(`${path.sep}help${path.sep}`))
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .map((line, i) => ({ line, at: `${path.relative(root, file)}:${i + 1}` }))
          // Words in quotes: a letter or space before the digit, so ids and code are left out.
          .filter(({ line }) => /["`][^"`]*[A-Za-z ][^"`]*\d(?:\.\.\.|…)[^"`]*["`]/.test(line))
          .map(({ at }) => at),
      );
    expect(found).toEqual([]);
  });
});
