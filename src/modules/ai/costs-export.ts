import { countOf, formatDay } from "@/lib/display";
import { formatAmount } from "@/lib/format";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request-meta";
import { buildXlsx, type XlsxCell, type XlsxSheet } from "@/lib/xlsx";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { letterheadOf } from "@/modules/documents/builders";
import { documentFileName, type PrintDocument } from "@/modules/documents/model";
import { ON_DEMAND_PER_MINUTE, renderOnDemand } from "@/modules/documents/on-demand";

import { type AiCosts, COST_PERIODS, getCostsWithLines } from "./costs.service";

/*
 * Budget & Costs as a file, in one click: a PDF (the totals, the breakdowns
 * and the newest lines) or an Excel workbook (every line, with real numbers
 * and dates, to sort and sum). Made for each request, never kept.
 */

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const rangeText = (c: AiCosts) =>
  c.query.from === c.query.to
    ? formatDay(c.query.from)
    : `${formatDay(c.query.from)} to ${formatDay(c.query.to)}`;

export function costsDocument(ctx: CompanyContext, c: AiCosts): PrintDocument {
  const cur = c.currency;
  const amount = (v: string) => formatAmount(v, 2, cur);
  const periodLabel = COST_PERIODS.find((p) => p.value === c.query.period)?.label ?? "";
  const breakdown = (title: string, rows: AiCosts["by"]["task"]) => ({
    kind: "table" as const,
    title,
    columns: [
      { label: "Name", weight: 3 },
      { label: "Calls", align: "right" as const },
      { label: `Cost (${cur})`, align: "right" as const, weight: 1.4 },
    ],
    rows: [
      ...rows.map((r) => ({ cells: [r.label, String(r.calls), amount(r.cost)] })),
      ...(rows.length > 1
        ? [
            {
              style: "total" as const,
              cells: [
                "Total",
                String(rows.reduce((t, r) => t + r.calls, 0)),
                amount(rows.reduce((t, r) => t + Number(r.cost), 0).toFixed(2)),
              ],
            },
          ]
        : []),
    ],
    empty: "Nothing in this period.",
  });
  return {
    type: "AI_COSTS",
    title: "AI budget and costs",
    subtitle: `${periodLabel}: ${rangeText(c)}`,
    reference: `AI costs ${c.query.from} ${c.query.to}`,
    letterhead: letterheadOf(ctx.company),
    meta: [
      { label: "From", value: formatDay(c.query.from) },
      { label: "To", value: formatDay(c.query.to) },
      ...(c.query.userId
        ? [{ label: "Person", value: c.people.find((p) => p.id === c.query.userId)?.name ?? "" }]
        : []),
      ...(c.shown.filter ? [{ label: "Only", value: c.shown.filter.label }] : []),
    ],
    parties: [],
    blocks: [
      {
        kind: "figures",
        figures: [
          {
            label: `Spent (${cur})`,
            value: amount(c.totals.cost),
            hint: `US$ ${c.totals.costUsd}`,
          },
          {
            label: "Calls",
            value: String(c.totals.calls),
            hint: `${c.totals.failed} failed, ${c.totals.stopped} stopped`,
          },
          {
            label: `This month (${cur})`,
            value: amount(c.month.spent),
            hint: c.month.budget ? `of ${amount(c.month.budget)} budget` : "No monthly budget",
          },
          { label: `Month-end at this pace (${cur})`, value: amount(c.month.projection) },
        ],
      },
      breakdown("By provider", c.by.provider),
      breakdown("By purpose", c.by.task),
      breakdown("By place in the ERP", c.by.place),
      breakdown("By model", c.by.model),
      breakdown("By area", c.by.module),
      breakdown("By agent", c.by.agent),
      breakdown("By person", c.by.person),
      breakdown("By order and tech pack", c.by.record),
      {
        kind: "table",
        title: c.shown.filter
          ? `Calls of ${c.shown.filter.label}${c.shown.calls > c.lines.length ? `: the newest ${c.lines.length}` : ""}`
          : c.totals.calls > c.lines.length
            ? `The newest ${c.lines.length} calls`
            : "Every call",
        columns: [
          { label: "When", weight: 1.3 },
          { label: "Purpose and why", weight: 3.5 },
          { label: "Who asked", weight: 1.4 },
          { label: "Model" },
          { label: `Cost (${cur})`, align: "right", weight: 1.2 },
        ],
        rows: c.lines.map((l) => ({
          cells: [
            new Date(l.at).toLocaleString("en-GB", {
              timeZone: ctx.company.timezone,
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            }),
            l.task,
            l.who,
            l.model,
            l.costKnown ? amount(l.cost) : "price unknown",
          ],
          details: [
            l.why,
            l.place.label,
            ...(l.record ? [l.record] : []),
            ...(l.note ? [l.note] : []),
          ],
        })),
        empty: "No AI call in this period.",
      },
    ],
    signatures: [],
  };
}

function costsWorkbook(ctx: CompanyContext, c: AiCosts, lines: AiCosts["lines"]): Buffer {
  const head = (labels: string[]): XlsxCell[] =>
    labels.map((value) => ({ value, style: "header" }));
  const title = (text: string): XlsxCell[] => [{ value: text, style: "title" }];
  const note = (text: string): XlsxCell[] => [{ value: text, style: "note" }];
  const sheetOf = (name: string, rows: AiCosts["by"]["task"]): XlsxSheet => ({
    name,
    rows: [
      title(`AI costs ${name.toLowerCase()}`),
      note(rangeText(c)),
      [],
      head(["Name", "Calls", `Cost (${c.currency})`]),
      ...rows.map((r) => [
        { value: r.label },
        { value: r.calls, style: "int" as const },
        { value: Number(r.cost), style: "money" as const },
      ]),
      [
        { value: "Total", style: "header" as const },
        { value: rows.reduce((t, r) => t + r.calls, 0), style: "int" as const },
        {
          value: Number(rows.reduce((t, r) => t + Number(r.cost), 0).toFixed(2)),
          style: "money" as const,
        },
      ],
    ],
    widths: [44, 10, 16],
    freezeRows: 4,
  });
  const callRows = lines.map((l) => [
    { value: new Date(l.at), style: "date" as const },
    { value: l.task },
    { value: l.why },
    { value: l.place.label },
    { value: l.record },
    { value: l.who },
    { value: l.agent },
    { value: l.model },
    { value: l.provider },
    { value: l.tokens.input, style: "int" as const },
    { value: l.tokens.output, style: "int" as const },
    { value: l.tokens.cacheRead, style: "int" as const },
    l.costKnown
      ? { value: Number(l.costUsd), style: "money" as const }
      : { value: "price unknown" },
    l.costKnown ? { value: Number(l.cost), style: "money" as const } : { value: "price unknown" },
    { value: l.result === "OK" ? "Done" : l.result === "FAILED" ? "Failed" : "Stopped" },
    { value: l.note },
  ]);
  const sheets: XlsxSheet[] = [
    {
      name: "Calls",
      rows: [
        title(`AI calls: ${rangeText(c)}`),
        note(
          c.shown.filter
            ? `${c.shown.filter.label}: ${countOf(c.shown.calls, "call")}, ${c.currency} ${c.shown.cost}`
            : `${countOf(c.totals.calls, "call")}, ${c.currency} ${c.totals.cost} (US$ ${c.totals.costUsd})`,
        ),
        [],
        head([
          "When",
          "Purpose",
          "Why",
          "Place",
          "Record",
          "Who asked",
          "Agent",
          "Model",
          "Provider",
          "Tokens in",
          "Tokens out",
          "Cache read",
          "Cost (US$)",
          `Cost (${c.currency})`,
          "Result",
          "Note",
        ]),
        ...callRows,
      ],
      widths: [12, 28, 48, 26, 24, 18, 16, 12, 10, 11, 11, 11, 11, 12, 10, 30],
      freezeRows: 4,
      filter: { firstRow: 4, lastRow: 4 + callRows.length, columns: 16 },
    },
    sheetOf("By provider", c.by.provider),
    sheetOf("By purpose", c.by.task),
    sheetOf("By place", c.by.place),
    sheetOf("By model", c.by.model),
    sheetOf("By area", c.by.module),
    sheetOf("By agent", c.by.agent),
    sheetOf("By person", c.by.person),
    sheetOf("By record", c.by.record),
  ];
  return Buffer.from(
    buildXlsx(sheets, {
      title: `${ctx.company.name}: AI costs (${c.query.from} to ${c.query.to})`,
      creator: ctx.user.name,
      created: new Date(),
      headerColor: ctx.company.primaryColor,
    }),
  );
}

/** The costs of a period as a PDF or an Excel workbook. */
export async function costsFile(
  ctx: CompanyContext,
  raw: unknown,
  format: "pdf" | "xlsx",
  meta?: RequestMeta,
) {
  checkRateLimit(`on-demand-print:${ctx.user.id}`, ON_DEMAND_PER_MINUTE, 60_000);
  const { costs, lines } = await getCostsWithLines(ctx, raw);
  const bytes =
    format === "pdf"
      ? await renderOnDemand(ctx, costsDocument(ctx, costs))
      : costsWorkbook(ctx, costs, lines);
  await auditInCompany(ctx, meta, {
    action: "EXPORT",
    entityType: "AiSettings",
    entityId: ctx.company.id,
    summary: `Made the AI costs ${format === "pdf" ? "PDF" : "Excel file"} for ${rangeText(costs)}`,
  });
  return {
    fileName: documentFileName(
      ctx.company.name,
      `AI costs ${costs.query.from} to ${costs.query.to}`,
      format === "pdf" ? ".pdf" : ".xlsx",
    ),
    mimeType: format === "pdf" ? "application/pdf" : XLSX_MIME,
    bytes,
  };
}
