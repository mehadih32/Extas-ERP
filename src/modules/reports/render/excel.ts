import { Prisma } from "@prisma/client";

import { buildXlsx, type XlsxCell, type XlsxSheet } from "@/lib/xlsx";
import {
  type ColumnKind,
  DAY,
  formatCell,
  MONTH,
  type ReportCell,
  type ReportDocument,
  type ReportRow,
  type ReportTable,
} from "@/modules/reports/document";

/*
 * The Excel version of a report: an Overview sheet with every headline figure
 * and note, then one sheet per table with real numbers and dates (so they sum
 * and filter), a coloured header row that stays in view, and filter buttons.
 */

export const EXCEL_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const TITLE_ROWS = 3; // title, subtitle, blank line; the header row follows

function cell(
  value: ReportCell,
  kind: ColumnKind,
  row?: Pick<ReportRow, "style" | "indent">,
): XlsxCell {
  const total = row?.style === "subtotal" || row?.style === "total";
  if (value === null || value === "")
    return { value: null, style: total ? "totalText" : "default" };
  switch (kind) {
    case "money":
      return { value: Number(value), style: total ? "totalMoney" : "money" };
    case "int":
      return { value: Number(value), style: total ? "totalInt" : "int" };
    case "percent":
      return {
        value: new Prisma.Decimal(value).dividedBy(100).toNumber(),
        style: total ? "totalPercent" : "percent",
      };
    case "day":
    case "month": {
      const text = String(value);
      if (kind === "day" && DAY.test(text)) {
        return { value: new Date(`${text}T00:00:00Z`), style: "date" };
      }
      if (kind === "month" && MONTH.test(text)) {
        return { value: new Date(`${text}-01T00:00:00Z`), style: "month" };
      }
      return { value: text, style: total ? "totalText" : "bold" };
    }
    case "text":
      return {
        value: String(value),
        style: total
          ? "totalText"
          : row?.style === "heading"
            ? "bold"
            : row?.indent
              ? "indent"
              : "default",
      };
  }
}

/** Column widths from the longest header or value, in characters. */
function widths(table: ReportTable, currency: string): number[] {
  return table.columns.map((col, i) => {
    let longest = col.label.length;
    for (const row of table.rows) {
      const text = formatCell(row.cells[i] ?? null, col.kind, currency);
      longest = Math.max(longest, text.length + (row.indent ? 2 : 0));
    }
    return Math.min(Math.max(longest + 2, col.kind === "text" ? 10 : 9), 60);
  });
}

function tableSheet(
  doc: ReportDocument,
  sectionTitle: string,
  subtitle: string,
  table: ReportTable,
): XlsxSheet {
  const header = table.columns.map((c) => ({ value: c.label, style: "header" as const }));
  const data = table.rows.map((row) =>
    table.columns.map((col, i) => cell(row.cells[i] ?? null, col.kind, row)),
  );
  const rows: XlsxCell[][] = [
    [{ value: table.title, style: "title" }],
    [
      {
        value: `${sectionTitle}: ${subtitle}. ${doc.company.name}, amounts in ${doc.company.currency}.`,
        style: "note",
      },
    ],
    [],
    header,
    ...(data.length > 0 ? data : [[{ value: table.empty, style: "note" as const }]]),
  ];
  // Filter buttons over plain lists (not statements with headings, and not their totals).
  const plain = table.rows.every((r) => r.style !== "heading" && r.style !== "subtotal");
  const lastData = table.rows.findLastIndex((r) => r.style !== "total");
  return {
    name: table.sheet ?? table.title,
    rows,
    widths: widths(table, doc.company.currency),
    freezeRows: TITLE_ROWS + 1,
    ...(plain && lastData >= 0
      ? {
          filter: {
            firstRow: TITLE_ROWS + 1,
            lastRow: TITLE_ROWS + 2 + lastData,
            columns: table.columns.length,
          },
        }
      : {}),
  };
}

function overviewSheet(doc: ReportDocument): XlsxSheet {
  const rows: XlsxCell[][] = [
    [{ value: `${doc.company.name}: ${doc.title}`, style: "title" }],
    [{ value: doc.period.label, style: "bold" }],
    [
      {
        value: `Made on ${doc.generatedOn} (${doc.timezone}) by ${doc.generatedBy}. Amounts in ${doc.company.currency}.`,
        style: "note",
      },
    ],
  ];
  for (const section of doc.sections) {
    rows.push([]);
    rows.push([
      { value: section.title, style: "bold" },
      { value: section.subtitle, style: "note" },
    ]);
    for (const f of section.figures) {
      rows.push([
        { value: f.label },
        cell(f.value, f.kind),
        { value: f.hint ?? null, style: "note" },
      ]);
    }
    const sheets = section.tables.map((t) => t.sheet ?? t.title).join(", ");
    if (sheets) rows.push([{ value: `Tables: ${sheets}`, style: "note" }]);
    for (const note of section.notes) rows.push([{ value: note, style: "note" }]);
  }
  return { name: "Overview", rows, widths: [34, 18, 70] };
}

/** The report as an .xlsx workbook. */
export function renderExcel(doc: ReportDocument): Buffer {
  const sheets = [
    overviewSheet(doc),
    ...doc.sections.flatMap((s) => s.tables.map((t) => tableSheet(doc, s.title, s.subtitle, t))),
  ];
  return Buffer.from(
    buildXlsx(sheets, {
      title: `${doc.company.name}: ${doc.title} (${doc.period.from} to ${doc.period.to})`,
      creator: doc.generatedBy,
      created: new Date(doc.generatedAt),
      headerColor: doc.company.primaryColor,
    }),
  );
}
