import { Prisma } from "@prisma/client";

import { formatAmount, formatDay, formatMonth } from "@/lib/format";
import type { PeriodPreset } from "@/modules/accounts/periods";
import type { ReportMetricKey } from "@/modules/reports/catalog";

/*
 * A report as plain data, before it becomes a PDF or an Excel workbook (and the
 * JSON the preview returns). Both renderers read the same document, so the two
 * files always show the same figures.
 *
 * Cell values by column kind:
 *   text     string
 *   int      number
 *   money    string with 2 decimals ("1234.50"), exact
 *   percent  string with 1 decimal ("12.5" = 12.5%)
 *   day      "2026-09-01";  month "2026-09"
 *   null     nothing to show (a dash in the PDF, an empty cell in Excel)
 */

export type ColumnKind = "text" | "int" | "money" | "percent" | "day" | "month";

export type ReportCell = string | number | null;

export type ReportColumn = {
  label: string;
  kind: ColumnKind;
  /** Relative width in the PDF; defaults by kind. */
  weight?: number;
};

/** heading: a group title row; subtotal / total: bold rows with a rule above. */
export type RowStyle = "normal" | "heading" | "subtotal" | "total";

export type ReportRow = { cells: ReportCell[]; style?: RowStyle; indent?: boolean };

export type ReportTable = {
  title: string;
  /** Short name for its Excel sheet (defaults to the title). */
  sheet?: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Shown when there are no rows. */
  empty: string;
};

/** A headline figure: a card in the PDF, a label and value row in Excel. */
export type ReportFigure = { label: string; value: ReportCell; kind: ColumnKind; hint?: string };

export type ReportSection = {
  key: ReportMetricKey;
  title: string;
  subtitle: string;
  figures: ReportFigure[];
  tables: ReportTable[];
  notes: string[];
};

export type ReportDocument = {
  title: string;
  company: {
    name: string;
    legalName: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    primaryColor: string;
    accentColor: string;
    currency: string;
  };
  period: { period: PeriodPreset | "CUSTOM"; from: string; to: string; label: string };
  /** The instant it was made (ISO) and the same in company time ("2 Oct 2026, 15:04"). */
  generatedAt: string;
  generatedOn: string;
  generatedBy: string;
  timezone: string;
  sections: ReportSection[];
};

// =============================================================================
// Formatting for people (the PDF; Excel keeps real numbers and dates)
// =============================================================================

export { formatAmount, formatDay, formatMonth };

export const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH = /^\d{4}-\d{2}$/;

/** A cell as text for the PDF. */
export function formatCell(value: ReportCell, kind: ColumnKind, currency: string): string {
  if (value === null || value === "") return "–";
  switch (kind) {
    case "money":
      return formatAmount(value, 2, currency);
    case "int":
      return formatAmount(value, 0, currency);
    case "percent":
      return `${new Prisma.Decimal(value).toFixed(1)}%`;
    case "day":
      return DAY.test(String(value)) ? formatDay(String(value)) : String(value);
    case "month":
      return MONTH.test(String(value)) ? formatMonth(String(value)) : String(value);
    case "text":
      return String(value);
  }
}

/** "1 Sep 2026 – 30 Sep 2026" (one day when both ends match). */
export function formatRange(from: string, to: string): string {
  return from === to ? formatDay(from) : `${formatDay(from)} – ${formatDay(to)}`;
}

/** The file name a report downloads as: "Extras - Business report - 2026-09-01 to 2026-09-30.pdf". */
export function reportFileName(
  doc: Pick<ReportDocument, "title" | "company" | "period">,
  ext: string,
) {
  const clean = (s: string) =>
    s
      .replace(/[\u0000-\u001f\u007f"<>|*?:\\/]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const range =
    doc.period.from === doc.period.to ? doc.period.from : `${doc.period.from} to ${doc.period.to}`;
  return `${clean(doc.company.name).slice(0, 60)} - ${clean(doc.title).slice(0, 80)} - ${range}.${ext}`;
}
