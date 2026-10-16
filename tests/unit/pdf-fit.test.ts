import { describe, expect, it } from "vitest";

import type { Letterhead, PrintDocument } from "@/modules/documents/model";
import { renderDocumentPdf } from "@/modules/documents/render";
import type { ReportDocument } from "@/modules/reports/document";
import { renderPdf as renderReportPdf } from "@/modules/reports/render/pdf";

import { pdfLines } from "../fixtures/pdf";

/*
 * v6.4 B3: printed documents never cut a word or a figure with "…" when there is
 * room to show it whole. The batch summary's figure cards ("Taken back from
 * suppliers", "Net cost a good piece") and its last total ("Final payable to the
 * factory (CMS-…)") were cut, and so were the Report Builder's "Available" heading
 * and colours like "Bottle Green" in its stock tables.
 */

const LETTERHEAD: Letterhead = {
  name: "Extras",
  legalName: "Extras Fashion Ltd.",
  contacts: ["Dhaka 1205", "hello@extras.test"],
  footer: "Extras Fashion Ltd. · extras.test",
  primaryColor: "#0B3D2E",
  accentColor: "#BE1434",
};

function summary(blocks: PrintDocument["blocks"]): PrintDocument {
  return {
    type: "BATCH_SUMMARY",
    title: "Batch summary",
    reference: "MB-2026-00001",
    letterhead: LETTERHEAD,
    meta: [{ label: "Master batch", value: "MB-2026-00001" }],
    parties: [],
    blocks,
    signatures: [],
  } as PrintDocument;
}

const cut = (lines: string[]) => lines.filter((l) => l.endsWith("…"));

describe("printed documents fit their words", () => {
  it("wraps a long figure label onto a second line instead of cutting it", async () => {
    const pdf = await renderDocumentPdf(
      summary([
        {
          kind: "figures",
          figures: [
            { label: "Total cost", value: "25,27,434.28" },
            { label: "Cost a good piece", value: "425.14", hint: "Target 465.21" },
            { label: "Taken back from suppliers", value: "20,314.27" },
            { label: "Net cost a good piece", value: "421.72" },
          ],
        },
      ]),
      { compress: false },
    );
    const lines = pdfLines(pdf);
    expect(cut(lines)).toEqual([]);
    const text = lines.join(" ");
    for (const label of ["TAKEN BACK FROM SUPPLIERS", "NET COST A GOOD PIECE", "TOTAL COST"]) {
      for (const word of label.split(" ")) expect(text).toContain(word);
    }
    for (const value of ["25,27,434.28", "425.14", "20,314.27", "421.72", "Target 465.21"]) {
      expect(lines).toContain(value);
    }
  });

  it("shrinks a big figure before it would cut it", async () => {
    const pdf = await renderDocumentPdf(
      summary([
        {
          kind: "figures",
          figures: [
            { label: "Total cost", value: "12,34,56,78,90,123.45" },
            { label: "A", value: "1" },
            { label: "B", value: "2" },
            { label: "C", value: "3" },
          ],
        },
      ]),
      { compress: false },
    );
    const lines = pdfLines(pdf);
    expect(cut(lines)).toEqual([]);
    expect(lines).toContain("12,34,56,78,90,123.45");
  });

  it("widens the totals box so a long total's name shows whole", async () => {
    const pdf = await renderDocumentPdf(
      summary([
        {
          kind: "totals",
          rows: [
            { label: "Total CM", value: "5,61,839.00" },
            { label: "Less rejects over the allowance", value: "6,370.91" },
            {
              label: "Final payable to the factory (CMS-2026-00001)",
              value: "3,45,765.93",
              strong: true,
            },
          ],
        },
      ]),
      { compress: false },
    );
    const lines = pdfLines(pdf);
    expect(cut(lines)).toEqual([]);
    expect(lines).toContain("Final payable to the factory (CMS-2026-00001)");
    expect(lines).toContain("Less rejects over the allowance");
    expect(lines).toContain("3,45,765.93");
  });

  it("gives a report table's columns the room their words and figures need", async () => {
    const report: ReportDocument = {
      title: "Business report",
      company: {
        name: "Extras",
        legalName: "Extras Fashion Ltd.",
        address: "Dhaka 1205",
        phone: "01711-000000",
        email: "hello@extras.test",
        website: "extras.test",
        primaryColor: "#0B3D2E",
        accentColor: "#BE1434",
        currency: "BDT",
      },
      period: { period: "ONE_YEAR", from: "2025-10-17", to: "2026-10-16", label: "Past year" },
      generatedAt: "2026-10-16T09:04:00.000Z",
      generatedOn: "16 Oct 2026, 15:04",
      generatedBy: "Mehadi Hasan",
      timezone: "Asia/Dhaka",
      sections: [
        {
          key: "STOCK_ALERTS",
          title: "Stock alerts",
          subtitle: "Stock on 16 Oct 2026",
          figures: [],
          tables: [
            {
              title: "Dead and slow stock (90-day window)",
              columns: [
                { label: "SKU", kind: "text", weight: 2.4 },
                { label: "Product", kind: "text", weight: 2.2 },
                { label: "Color", kind: "text", weight: 1.1 },
                { label: "Size", kind: "text", weight: 0.7 },
                { label: "Status", kind: "text", weight: 0.8 },
                { label: "Available", kind: "int", weight: 0.9 },
                { label: "Sold (90 days)", kind: "int", weight: 1.1 },
                { label: "Last sold", kind: "day", weight: 1.3 },
                { label: "Days of cover", kind: "int", weight: 1 },
                { label: "Value (BDT)", kind: "money", weight: 1.4 },
              ],
              rows: [
                {
                  cells: [
                    "FSP-LC-BOTTLE-XXL",
                    "Lacoste Pique Polo",
                    "Bottle Green",
                    "XXL",
                    "Slow",
                    1035,
                    2,
                    "2026-09-25",
                    1035,
                    "1157708.99",
                  ],
                },
              ],
              empty: "No dead or slow stock.",
            },
          ],
          notes: [],
        },
      ],
    } as ReportDocument;
    const lines = pdfLines(await renderReportPdf(report, { compress: false }));
    expect(cut(lines)).toEqual([]);
    for (const text of ["Available", "Bottle Green", "Lacoste Pique Polo", "FSP-LC-BOTTLE-XXL"]) {
      expect(lines).toContain(text);
    }
  });
});
