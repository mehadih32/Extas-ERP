import type { SystemRole } from "@prisma/client";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { buildXlsx, cleanXmlText, columnName, excelDate, sheetName } from "@/lib/xlsx";
import { insightsQuerySchema, preferencesSchema } from "@/modules/dashboard/schemas";
import { DEFAULT_ROLE_PERMISSIONS, type PermissionKey } from "@/modules/rbac/permissions";
import {
  allowedMetrics,
  hiddenExtras,
  listReportMetrics,
  mayOpenReport,
  type ReportShows,
  reportShows,
} from "@/modules/reports/catalog";
import {
  formatAmount,
  formatCell,
  formatRange,
  type ReportDocument,
  reportFileName,
} from "@/modules/reports/document";
import { renderExcel } from "@/modules/reports/render/excel";
import { pdfText, renderPdf } from "@/modules/reports/render/pdf";
import { generateReportSchema, reportQuerySchema } from "@/modules/reports/schemas";

/** The `can` of a person holding a built-in role's default permissions. */
const role = (name: SystemRole) => ({
  can: (p: PermissionKey) => DEFAULT_ROLE_PERMISSIONS[name].includes(p),
});

const ALL: ReportShows = { salesAmounts: true, financials: true, stock: true };
const NONE: ReportShows = { salesAmounts: false, financials: false, stock: false };

/** A report with a summary, 30 days of sales (with a total row) and 45 top sellers. */
function sampleReport(): ReportDocument {
  const days = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
  return {
    title: "Business report",
    company: {
      name: "Extras",
      legalName: "Extras Fashion Ltd.",
      address: "House 12, Road 5, Dhanmondi, Dhaka 1205",
      phone: "01711-000000",
      email: "hello@extras.test",
      website: "extras.test",
      primaryColor: "#0B3D2E",
      accentColor: "#BE1434",
      currency: "BDT",
    },
    period: {
      period: "LAST_MONTH",
      from: "2026-09-01",
      to: "2026-09-30",
      label: "Last month: 1 Sep 2026 – 30 Sep 2026",
    },
    generatedAt: "2026-10-02T09:04:00.000Z",
    generatedOn: "2 Oct 2026, 15:04",
    generatedBy: "Mehadi Hasan",
    timezone: "Asia/Dhaka",
    sections: [
      {
        key: "SUMMARY",
        title: "Key figures",
        subtitle: "1 Sep 2026 – 30 Sep 2026; position on 30 Sep 2026",
        figures: [
          { label: "Stock value", value: "1234567.50", kind: "money", hint: "Finished goods" },
          { label: "Net profit", value: "-12345.67", kind: "money" },
        ],
        tables: [
          {
            title: "In this period",
            sheet: "Period figures",
            columns: [
              { label: "Figure", kind: "text", weight: 3 },
              { label: "Amount (BDT)", kind: "money" },
              { label: "% of sales", kind: "percent" },
            ],
            rows: [
              { cells: ["Sales (after discounts)", "987654.32", "100.0"] },
              { cells: ["Cost of goods sold", "600000.00", "60.7"], indent: true },
              { cells: ["Gross profit", "387654.32", "39.3"], style: "subtotal" },
              { cells: ["Net profit", "-12345.68", "-1.2"], style: "total" },
            ],
            empty: "",
          },
        ],
        notes: ["Customer names like রহিম ট্রেডার্স stay in Excel; the PDF shows ?."],
      },
      {
        key: "SALES",
        title: "Sales",
        subtitle: "1 Sep 2026 – 30 Sep 2026",
        figures: [{ label: "Invoices", value: 120, kind: "int" }],
        tables: [
          {
            title: "Sales by day",
            columns: [
              { label: "Day", kind: "day", weight: 2 },
              { label: "Invoices", kind: "int" },
              { label: "Net sales (BDT)", kind: "money", weight: 2 },
            ],
            rows: [
              ...days.map((d, i) => ({ cells: [d, i % 7, (i * 1234.5).toFixed(2)] })),
              { cells: ["Total", 120, "536857.50"], style: "total" as const },
            ],
            empty: "No sales in this period.",
          },
        ],
        notes: [],
      },
      {
        key: "TOP_SELLERS",
        title: "Top sellers",
        subtitle: "1 Sep 2026 – 30 Sep 2026",
        figures: [],
        tables: [
          {
            title: "Top 45 SKUs by pieces sold",
            sheet: "Top SKUs",
            columns: [
              { label: "#", kind: "int", weight: 0.5 },
              { label: "SKU", kind: "text", weight: 2.4 },
              { label: "Pieces", kind: "int" },
              { label: "Share", kind: "percent" },
            ],
            rows: Array.from({ length: 45 }, (_, i) => ({
              cells: [i + 1, `EX-PL-${String(i).padStart(3, "0")}-NAVY-XL`, 100 - i, "2.2"],
            })),
            empty: "Nothing was sold in this period.",
          },
        ],
        notes: [],
      },
    ],
  };
}

/** The text of each line drawn in an uncompressed PDF (pdfkit writes hex strings, split for kerning). */
function pdfLines(pdf: Buffer): string[] {
  return [...pdf.toString("latin1").matchAll(/\[([^\]]*)\]\s*TJ/g)].map((m) =>
    [...m[1]!.matchAll(/<([0-9a-f]*)>/gi)]
      .map((h) => Buffer.from(h[1]!, "hex").toString("latin1"))
      .join(""),
  );
}

function unzipText(bytes: Uint8Array): Record<string, string> {
  return Object.fromEntries(
    Object.entries(unzipSync(bytes)).map(([name, data]) => [name, strFromU8(data)]),
  );
}

describe("report formatting", () => {
  it("groups amounts exactly, in lakh and crore for Bangladeshi taka", () => {
    expect(formatAmount("1234567.5", 2, "BDT")).toBe("12,34,567.50");
    expect(formatAmount("10000000", 0, "BDT")).toBe("1,00,00,000");
    expect(formatAmount("999", 0, "BDT")).toBe("999");
    expect(formatAmount("1234567.5", 2, "USD")).toBe("1,234,567.50");
    expect(formatAmount("-1234.5", 2, "bdt")).toBe("-1,234.50");
    expect(formatAmount("999.999", 2, "BDT")).toBe("1,000.00");
    expect(formatAmount("-0.001", 2, "BDT")).toBe("0.00"); // never "-0.00"
  });

  it("formats cells by kind and leaves labels in date columns alone", () => {
    expect(formatCell(null, "money", "BDT")).toBe("–");
    expect(formatCell("", "text", "BDT")).toBe("–");
    expect(formatCell(1234, "int", "BDT")).toBe("1,234");
    expect(formatCell("39.25", "percent", "BDT")).toBe("39.3%");
    expect(formatCell("2026-09-01", "day", "BDT")).toBe("1 Sep 2026");
    expect(formatCell("2026-09", "month", "BDT")).toBe("Sep 2026");
    expect(formatCell("Total", "day", "BDT")).toBe("Total");
    expect(formatRange("2026-09-01", "2026-09-01")).toBe("1 Sep 2026");
    expect(formatRange("2026-09-01", "2026-09-30")).toBe("1 Sep 2026 – 30 Sep 2026");
  });

  it("names downloads after the company, title and dates without unsafe characters", () => {
    const doc = sampleReport();
    expect(reportFileName(doc, "pdf")).toBe(
      "Extras - Business report - 2026-09-01 to 2026-09-30.pdf",
    );
    expect(
      reportFileName(
        {
          ...doc,
          company: { ...doc.company, name: 'Extras: "Fashion"/BD' },
          title: "Q3 <report>\n",
          period: { ...doc.period, from: "2026-09-30", to: "2026-09-30" },
        },
        "xlsx",
      ),
    ).toBe("Extras Fashion BD - Q3 report - 2026-09-30.xlsx");
  });
});

describe("Excel writer", () => {
  it("names columns and sheets the way Excel expects", () => {
    expect([1, 26, 27, 52, 703].map(columnName)).toEqual(["A", "Z", "AA", "AZ", "AAA"]);
    const taken = new Set<string>();
    expect(sheetName("Sales: by day/month?", taken)).toBe("Sales by day month");
    expect(sheetName("sales by day month", taken)).toBe("sales by day month (2)");
    expect(sheetName("A".repeat(40), taken)).toBe("A".repeat(31));
    expect(sheetName("A".repeat(40), taken)).toBe(`${"A".repeat(27)} (2)`);
    expect(sheetName("''", taken)).toBe("Sheet");
  });

  it("dates cells by calendar day and drops characters XML cannot hold", () => {
    expect(excelDate(new Date("1900-03-01T00:00:00Z"))).toBe(61);
    expect(excelDate(new Date("2026-09-01T00:00:00Z"))).toBe(46266);
    expect(excelDate(new Date("2026-09-01T18:30:00Z"))).toBe(46266);
    expect(cleanXmlText("a\u0000b\u0007c\td\ne")).toBe("abc\td\ne");
    expect(cleanXmlText("x\ud800y\udc00z😀")).toBe("xyz😀");
    expect(cleanXmlText("x".repeat(40_000))).toHaveLength(32_767);
  });

  it("writes a workbook with typed cells, a frozen header and filter buttons", () => {
    const bytes = buildXlsx(
      [
        {
          name: "Sales",
          rows: [
            [{ value: "Fish & Chips <b>", style: "title" }],
            [
              { value: "2026-09-01", style: "bold" },
              { value: 1234.5, style: "money" },
              { value: new Date("2026-09-01T00:00:00Z"), style: "date" },
              { value: null },
              { value: 0.125, style: "percent" },
              { value: Number.NaN, style: "int" },
            ],
          ],
          widths: [20, 12],
          freezeRows: 1,
          filter: { firstRow: 1, lastRow: 2, columns: 5 },
        },
        { name: "Sales", rows: [[{ value: "=SUM(A1:A2)" }]] },
      ],
      { title: "Report", creator: "Mehadi", created: new Date("2026-10-02T09:00:00Z") },
    );
    const files = unzipText(bytes);
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "_rels/.rels",
        "docProps/core.xml",
        "docProps/app.xml",
        "xl/workbook.xml",
        "xl/_rels/workbook.xml.rels",
        "xl/styles.xml",
        "xl/worksheets/sheet1.xml",
        "xl/worksheets/sheet2.xml",
      ]),
    );
    const sheet = files["xl/worksheets/sheet1.xml"]!;
    expect(sheet).toContain(
      '<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Fish &amp; Chips &lt;b&gt;</t></is></c>',
    );
    expect(sheet).toContain('<c r="B2" s="7"><v>1234.5</v></c>');
    expect(sheet).toContain('<c r="C2" s="9"><v>46266</v></c>');
    expect(sheet).toContain('<c r="E2" s="8"><v>0.125</v></c>');
    expect(sheet).toContain('<c r="F2" s="6"/>'); // not a number: left empty
    expect(sheet).not.toContain('r="D2"');
    expect(sheet).toContain('<autoFilter ref="A1:E2"/>');
    expect(sheet).toContain('state="frozen"');
    // Text is never read as a formula.
    expect(files["xl/worksheets/sheet2.xml"]).toContain('<t xml:space="preserve">=SUM(A1:A2)</t>');
    expect(files["xl/worksheets/sheet2.xml"]).not.toContain("<f>");
    // Sheet names stay unique.
    expect(files["xl/workbook.xml"]).toContain('name="Sales"');
    expect(files["xl/workbook.xml"]).toContain('name="Sales (2)"');
    expect(files["xl/workbook.xml"]).toContain("_xlnm._FilterDatabase");
    expect(files["docProps/core.xml"]).toContain("Mehadi");
  });

  it("renders a report with real numbers, dates and exact percentages", () => {
    const files = unzipText(renderExcel(sampleReport()));
    const workbook = files["xl/workbook.xml"]!;
    for (const name of ["Overview", "Period figures", "Sales by day", "Top SKUs"]) {
      expect(workbook).toContain(`name="${name}"`);
    }
    const period = files["xl/worksheets/sheet2.xml"]!;
    expect(period).toContain("<v>987654.32</v>");
    expect(period).toContain("<v>0.393</v>"); // 39.3%, without float noise
    expect(period).toContain("<v>-0.012</v>");
    const byDay = files["xl/worksheets/sheet3.xml"]!;
    expect(byDay).toContain("<v>46266</v>"); // 1 Sep 2026 as a date
    expect(byDay).toContain("<v>46295</v>"); // 30 Sep 2026
    expect(byDay).toContain('<t xml:space="preserve">Total</t>');
    // Filter buttons cover the header and the days, not the total row (header on row 4).
    expect(byDay).toContain('<autoFilter ref="A4:C34"/>');
    // Bengali text stays as it is in Excel.
    expect(files["xl/worksheets/sheet1.xml"]).toContain("রহিম ট্রেডার্স");
  });
});

describe("PDF writer", () => {
  it("keeps the characters the built-in fonts can draw", () => {
    expect(pdfText("Café – “quoted” £5 · €")).toBe("Café – “quoted” £5 · €");
    expect(pdfText("রহিম ট্রেডার্স")).toBe("? ?");
    expect(pdfText("a\n\tb")).toBe("a b");
    expect(pdfText("😀😀x")).toBe("?x");
  });

  it("renders every section on numbered A4 pages, repeating headers on long tables", async () => {
    const pdf = await renderPdf(sampleReport(), { compress: false });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const pages = Number(/\/Type \/Pages[\s\S]*?\/Count (\d+)/.exec(pdf.toString("latin1"))?.[1]);
    expect(pages).toBeGreaterThanOrEqual(2);
    const lines = pdfLines(pdf);
    for (const text of ["Business report", "Key figures", "Sales by day", "Top sellers"]) {
      expect(lines).toContain(text);
    }
    expect(lines).toContain("12,34,567.50");
    expect(lines).toContain(`Page 1 of ${pages}`);
    expect(lines).toContain(`Page ${pages} of ${pages}`);
    expect(lines.some((l) => l.endsWith("(continued)"))).toBe(true);
    expect(lines.some((l) => l.includes("? ?"))).toBe(true);
    // Compressed by default, and still a PDF.
    const small = await renderPdf(sampleReport());
    expect(small.length).toBeLessThan(pdf.length);
    expect(small.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});

describe("report metrics and permissions", () => {
  it("offers each role only the figures it may see", () => {
    expect(allowedMetrics(role("SUPER_ADMIN"))).toEqual([
      "SUMMARY",
      "SALES",
      "PROFIT_AND_LOSS",
      "TOP_SELLERS",
      "STOCK_ALERTS",
    ]);
    expect(allowedMetrics(role("ACCOUNTS"))).toEqual(allowedMetrics(role("SUPER_ADMIN")));
    expect(allowedMetrics(role("PRODUCTION_MANAGER"))).toEqual(["TOP_SELLERS", "STOCK_ALERTS"]);
    expect(allowedMetrics(role("SALES_EXECUTIVE"))).toEqual([
      "SALES",
      "TOP_SELLERS",
      "STOCK_ALERTS",
    ]);
    expect(allowedMetrics(role("EMPLOYEE"))).toEqual([]);
    expect(listReportMetrics(role("PRODUCTION_MANAGER")).map((m) => [m.key, m.available])).toEqual([
      ["SUMMARY", false],
      ["SALES", false],
      ["PROFIT_AND_LOSS", false],
      ["TOP_SELLERS", true],
      ["STOCK_ALERTS", true],
    ]);
  });

  it("records what a report shows beyond its metrics, from its maker's permissions", () => {
    expect(reportShows(role("ACCOUNTS"), ["TOP_SELLERS"])).toEqual(ALL);
    expect(reportShows(role("PRODUCTION_MANAGER"), ["TOP_SELLERS", "STOCK_ALERTS"])).toEqual({
      salesAmounts: false,
      financials: false,
      stock: true,
    });
    expect(reportShows(role("ACCOUNTS"), ["SUMMARY", "PROFIT_AND_LOSS"])).toEqual(NONE);
    expect(reportShows(role("SALES_EXECUTIVE"), ["SALES"])).toEqual(NONE);
    expect(reportShows(role("ACCOUNTS"), ["SALES"])).toEqual({ ...NONE, financials: true });
    expect(hiddenExtras(role("PRODUCTION_MANAGER"))).toEqual(["salesAmounts", "financials"]);
    expect(hiddenExtras(role("ACCOUNTS"))).toEqual([]);
  });

  it("opens a saved report only for people who may see everything in it", () => {
    const pm = role("PRODUCTION_MANAGER");
    const accounts = role("ACCOUNTS");
    const sales = role("SALES_EXECUTIVE");
    const accountsTop = { metrics: ["TOP_SELLERS"], shows: ALL };
    const pmStock = {
      metrics: ["TOP_SELLERS", "STOCK_ALERTS"],
      shows: { ...NONE, stock: true },
    };
    expect(mayOpenReport(pm, accountsTop)).toBe(false);
    expect(mayOpenReport(pm, pmStock)).toBe(true);
    expect(mayOpenReport(accounts, pmStock)).toBe(true);
    expect(mayOpenReport(sales, { metrics: ["SALES"], shows: { ...NONE, financials: true } })).toBe(
      false,
    );
    expect(mayOpenReport(sales, { metrics: ["SALES"], shows: NONE })).toBe(true);
    expect(mayOpenReport(accounts, { metrics: ["CASH_FLOW"], shows: NONE })).toBe(false);
    // A report that does not say what it shows counts as showing everything.
    expect(mayOpenReport(pm, { metrics: ["STOCK_ALERTS"], shows: null })).toBe(false);
    expect(mayOpenReport(role("SUPER_ADMIN"), { metrics: ["STOCK_ALERTS"], shows: null })).toBe(
      true,
    );
  });
});

describe("report and dashboard requests", () => {
  it("reads metrics from a list or a comma-separated string, in catalogue order", () => {
    expect(reportQuerySchema.parse({ metrics: "TOP_SELLERS, SUMMARY" }).metrics).toEqual([
      "SUMMARY",
      "TOP_SELLERS",
    ]);
    expect(reportQuerySchema.parse({ metrics: ["SALES", "SALES"] }).metrics).toEqual(["SALES"]);
    expect(reportQuerySchema.parse({}).metrics).toBeUndefined();
    expect(() => reportQuerySchema.parse({ metrics: "" })).toThrow();
    expect(() => reportQuerySchema.parse({ metrics: "PROFIT" })).toThrow();
  });

  it("fills in the report options and checks their limits", () => {
    expect(reportQuerySchema.parse({})).toMatchObject({
      topLimit: 20,
      alertLimit: 50,
      slowDays: 90,
      coverDays: 180,
    });
    expect(reportQuerySchema.parse({ topLimit: "30", slowDays: "60" })).toMatchObject({
      topLimit: 30,
      slowDays: 60,
    });
    expect(() => reportQuerySchema.parse({ slowDays: "7" })).toThrow();
    expect(() => reportQuerySchema.parse({ from: "2026-02-30" })).toThrow();
    expect(() => reportQuerySchema.parse({ title: " " })).toThrow();
    expect(() => generateReportSchema.parse({})).toThrow();
    expect(generateReportSchema.parse({ format: "EXCEL" }).format).toBe("EXCEL");
  });

  it("takes dashboard options and card preferences", () => {
    expect(insightsQuerySchema.parse({})).toMatchObject({
      limit: 10,
      groupBy: "SKU",
      sortBy: "QUANTITY",
      slowDays: 90,
      coverDays: 180,
    });
    expect(() => insightsQuerySchema.parse({ sortBy: "PROFIT" })).toThrow();
    expect(preferencesSchema.parse({ metric: "NET_PROFIT", hidden: true })).toEqual({
      metric: "NET_PROFIT",
      hidden: true,
    });
    expect(preferencesSchema.parse({ hiddenMetrics: ["STOCK_VALUE"] })).toEqual({
      hiddenMetrics: ["STOCK_VALUE"],
    });
    expect(() => preferencesSchema.parse({ metric: "CASH", hidden: true })).toThrow();
  });
});
