import type { ReportFormat, TemplateFormat } from "@prisma/client";

import { dayParam } from "@/components/parties/route";
import { PERIOD_PRESETS, type PeriodPreset } from "@/modules/accounts/periods";
import { REPORT_METRICS, type ReportMetricKey } from "@/modules/reports/catalog";

/*
 * Words and addresses for the Reports & documents screens, and the Report
 * Builder's choices as they are kept in the address bar, so a refresh or a
 * shared link shows the same report.
 */

export const reportsHref = {
  reports: "/reports",
  mine: "/reports?mine=1",
  builder: (search = "") => `/reports/new${search}`,
  report: (id: string) => `/reports/saved/${encodeURIComponent(id)}`,
  download: (id: string) => `/api/reports/exports/${encodeURIComponent(id)}/download`,
  documents: (type?: string) => (type ? `/reports/documents?type=${type}` : "/reports/documents"),
  documentFile: (id: string) => `/api/documents/${encodeURIComponent(id)}/download`,
  templates: "/reports/templates",
  template: (id: string) => `/reports/templates/${encodeURIComponent(id)}`,
  templateFile: (id: string) => `/api/templates/${encodeURIComponent(id)}/file`,
};

export const FORMAT_LABELS: Record<ReportFormat, string> = { PDF: "PDF", EXCEL: "Excel" };

export const TEMPLATE_FORMAT_LABELS: Record<TemplateFormat, string> = {
  WORD: "Word",
  HTML: "HTML",
  PDF: "PDF",
  IMAGE: "Image",
};

/** What each kind of template is, for the upload window. */
export const TEMPLATE_FORMAT_HINTS: Record<TemplateFormat, string> = {
  WORD: "Type tags like {BuyerName} in the Word file where the data goes.",
  HTML: "Type tags like {BuyerName} in the page where the data goes.",
  PDF: "Your own designed page: place each tag on it after uploading.",
  IMAGE: "A scan or picture of your pad: place each tag on it after uploading.",
};

/** What filling each kind of template gives. */
export const TEMPLATE_RESULT_HINTS: Record<string, string> = {
  WORD: "Makes a Word file (.docx).",
  HTML: "Makes a web page (.html) to print from a browser.",
  PDF: "Makes a PDF on your design.",
  IMAGE: "Makes a PDF on your pad.",
};

/** "12 KB", "1.4 MB". */
export function fileSize(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// --- The Report Builder's choices ---------------------------------------------------------

type SearchParams = Record<string, string | string[] | undefined>;

export type BuilderView = {
  title?: string;
  period?: PeriodPreset | "CUSTOM";
  from?: string;
  to?: string;
  /** The figures picked; none means "everything I may see". */
  metrics?: ReportMetricKey[];
  topLimit?: number;
  alertLimit?: number;
  slowDays?: number;
  coverDays?: number;
  /** Show the report on screen. */
  show: boolean;
};

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

const whole = (value: string | string[] | undefined) => {
  const text = one(value);
  return text && /^\d{1,4}$/.test(text) ? Number(text) : undefined;
};

export function builderViewFrom(params: SearchParams): BuilderView {
  const period = one(params.period) ?? "";
  const metrics = (one(params.metrics) ?? "")
    .split(",")
    .filter((m): m is ReportMetricKey => (REPORT_METRICS as readonly string[]).includes(m));
  const from = dayParam(params.from);
  const to = dayParam(params.to);
  return {
    title: one(params.title)?.trim().slice(0, 80) || undefined,
    period:
      from || to
        ? "CUSTOM"
        : (PERIOD_PRESETS as readonly string[]).includes(period)
          ? (period as PeriodPreset)
          : undefined,
    from,
    to,
    metrics: metrics.length > 0 ? metrics : undefined,
    topLimit: whole(params.topLimit),
    alertLimit: whole(params.alertLimit),
    slowDays: whole(params.slowDays),
    coverDays: whole(params.coverDays),
    show: params.show === "1",
  };
}

/** The address for a builder view (only what differs from the defaults). */
export function builderSearch(view: Omit<BuilderView, "show"> & { show?: boolean }): string {
  const params = new URLSearchParams();
  if (view.title) params.set("title", view.title);
  if (view.period === "CUSTOM" || view.from || view.to) {
    if (view.from) params.set("from", view.from);
    if (view.to) params.set("to", view.to);
  } else if (view.period && view.period !== "THIS_MONTH") {
    params.set("period", view.period);
  }
  if (view.metrics?.length) params.set("metrics", view.metrics.join(","));
  for (const key of ["topLimit", "alertLimit", "slowDays", "coverDays"] as const) {
    if (view[key] !== undefined) params.set(key, String(view[key]));
  }
  if (view.show) params.set("show", "1");
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** What the report actions are asked for. */
export function builderQuery(view: Omit<BuilderView, "show">) {
  const custom = view.period === "CUSTOM" || Boolean(view.from || view.to);
  return {
    title: view.title,
    ...(custom
      ? { from: view.from, to: view.to }
      : { period: view.period === "CUSTOM" ? undefined : view.period }),
    metrics: view.metrics,
    topLimit: view.topLimit,
    alertLimit: view.alertLimit,
    slowDays: view.slowDays,
    coverDays: view.coverDays,
  };
}
