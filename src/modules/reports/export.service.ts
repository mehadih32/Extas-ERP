import type { Prisma, ReportFormat } from "@prisma/client";
import type { z } from "zod";

import { dateColumn, dateOnly } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request-meta";
import { toActionError } from "@/lib/result";
import { PERIOD_PRESETS, resolvePeriod } from "@/modules/accounts/periods";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { deleteStoredFile, readStoredFile, writeGeneratedFile } from "@/modules/files/file.service";
import {
  buildReport,
  PERIOD_LABELS,
  type ReportOptions,
  type ReportRequest,
} from "@/modules/reports/builder";
import {
  allowedMetrics,
  hiddenExtras,
  listReportMetrics,
  mayOpenReport,
  METRIC_INFO,
  REPORT_METRICS,
  type ReportMetricKey,
  type ReportShows,
  reportShows,
} from "@/modules/reports/catalog";
import { formatRange, type ReportDocument, reportFileName } from "@/modules/reports/document";
import { EXCEL_MIME, renderExcel } from "@/modules/reports/render/excel";
import { PDF_MIME, renderPdf } from "@/modules/reports/render/pdf";
import {
  generateReportSchema,
  listExportsSchema,
  reportQuerySchema,
} from "@/modules/reports/schemas";

/*
 * The Report Builder: a report for any period with the chosen metrics, shown as
 * data (preview) or made into a PDF / Excel file. Files are made straight away
 * (a handful of aggregate queries) and kept, so they can be downloaded again;
 * each saved report records who asked for which period, metrics and options.
 *
 * Who sees what: every metric needs its own permission on top of reports.export,
 * and a saved report opens only for people who may see everything in it (its
 * metrics and the extra columns its maker could see, see catalog.ts). Generating
 * and downloading are written to the activity log.
 */

export const DEFAULT_REPORT_TITLE = "Business report";

/** Reports a person may make in a minute (each runs a dozen aggregate queries). */
const GENERATE_PER_MINUTE = 10;
const PREVIEW_PER_MINUTE = 30;

const FORMATS: Record<ReportFormat, { mimeType: string; ext: string }> = {
  PDF: { mimeType: PDF_MIME, ext: "pdf" },
  EXCEL: { mimeType: EXCEL_MIME, ext: "xlsx" },
};

/** What is kept with a saved report: the options used and what it shows. */
type StoredOptions = ReportOptions & { shows: ReportShows };

const exportInclude = {
  requestedBy: { select: { id: true, name: true } },
  file: {
    select: { id: true, fileName: true, mimeType: true, sizeBytes: true, storagePath: true },
  },
} satisfies Prisma.ReportExportInclude;

type ExportRow = Prisma.ReportExportGetPayload<{ include: typeof exportInclude }>;

// =============================================================================
// Choices and requests
// =============================================================================

/** Route handlers check this too; services check again so no caller can skip it. */
function assertCanExport(ctx: CompanyContext) {
  if (!ctx.can("reports.export")) {
    throw new AppError("FORBIDDEN", "You do not have permission to make reports.");
  }
}

/** What the Report Builder offers this person: metrics (with whether they may pick each), periods, formats. */
export function reportBuilderOptions(ctx: CompanyContext) {
  assertCanExport(ctx);
  const defaults = reportQuerySchema.parse({});
  return {
    metrics: listReportMetrics(ctx),
    periods: [...PERIOD_PRESETS, "CUSTOM" as const].map((key) => ({
      key,
      label: PERIOD_LABELS[key],
    })),
    formats: Object.keys(FORMATS) as ReportFormat[],
    defaults: {
      title: DEFAULT_REPORT_TITLE,
      period: "THIS_MONTH" as const,
      metrics: allowedMetrics(ctx),
      topLimit: defaults.topLimit,
      alertLimit: defaults.alertLimit,
      slowDays: defaults.slowDays,
      coverDays: defaults.coverDays,
    },
  };
}

/** The picked metrics, checked against the person's permissions (every one they may see when none are picked). */
function pickMetrics(ctx: CompanyContext, picked: ReportMetricKey[] | undefined) {
  if (!picked) {
    const metrics = allowedMetrics(ctx);
    if (metrics.length === 0) {
      throw new AppError("FORBIDDEN", "Your role cannot see any of the report's figures.");
    }
    return metrics;
  }
  const blocked = picked.filter((key) => !METRIC_INFO[key].allowed(ctx));
  if (blocked.length > 0) {
    throw new AppError(
      "FORBIDDEN",
      `Your role cannot include ${blocked.map((key) => METRIC_INFO[key].label).join(", ")} in a report.`,
    );
  }
  return picked;
}

function toRequest(
  ctx: CompanyContext,
  input: z.output<typeof reportQuerySchema>,
  now: Date,
): ReportRequest {
  return {
    title: input.title ?? DEFAULT_REPORT_TITLE,
    period: resolvePeriod(input, ctx.company, now),
    metrics: pickMetrics(ctx, input.metrics),
    options: {
      topLimit: input.topLimit,
      alertLimit: input.alertLimit,
      slowDays: input.slowDays,
      coverDays: input.coverDays,
    },
  };
}

/** The report's content as data (what the PDF or Excel file would show), without saving it. */
export async function previewReport(
  ctx: CompanyContext,
  raw: unknown,
  now: Date = new Date(),
): Promise<ReportDocument> {
  assertCanExport(ctx);
  checkRateLimit(`report-preview:${ctx.user.id}`, PREVIEW_PER_MINUTE, 60_000);
  const request = toRequest(ctx, reportQuerySchema.parse(raw), now);
  return buildReport(ctx, request, now);
}

// =============================================================================
// Saved reports
// =============================================================================

function readOptions(value: Prisma.JsonValue | null): StoredOptions | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as unknown as StoredOptions;
}

function present(row: ExportRow) {
  const options = readOptions(row.options);
  const from = dateOnly(row.fromDate);
  const to = dateOnly(row.toDate);
  return {
    id: row.id,
    title: row.title,
    format: row.format,
    status: row.status,
    period: row.period,
    from,
    to,
    /** "1 Sep 2026 – 30 Sep 2026" */
    range: formatRange(from, to),
    metrics: row.metrics,
    options: options
      ? {
          topLimit: options.topLimit,
          alertLimit: options.alertLimit,
          slowDays: options.slowDays,
          coverDays: options.coverDays,
        }
      : null,
    /** Ready to download. */
    downloadable: row.status === "SUCCEEDED" && row.file !== null,
    fileName: row.file?.fileName ?? null,
    sizeBytes: row.file?.sizeBytes ?? null,
    error: row.error,
    requestedBy: row.requestedBy,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

export type SavedReport = ReturnType<typeof present>;

function mayOpen(ctx: CompanyContext, row: ExportRow): boolean {
  return mayOpenReport(ctx, {
    metrics: row.metrics,
    shows: readOptions(row.options)?.shows ?? null,
  });
}

/** The saved reports this person may open, as a database filter (the same rule as mayOpenReport). */
function visibleWhere(ctx: CompanyContext): Prisma.ReportExportWhereInput {
  const blocked = REPORT_METRICS.filter((key) => !METRIC_INFO[key].allowed(ctx));
  const and: Prisma.ReportExportWhereInput[] = [];
  if (blocked.length > 0) and.push({ NOT: { metrics: { hasSome: blocked } } });
  for (const extra of hiddenExtras(ctx)) {
    // Only reports that say they leave this out (a missing flag counts as shown).
    and.push({ options: { path: ["shows", extra], equals: false } });
  }
  return and.length > 0 ? { AND: and } : {};
}

async function loadExport(ctx: CompanyContext, exportId: string): Promise<ExportRow> {
  assertCanExport(ctx);
  const row = await ctx.db.reportExport.findUnique({
    where: { id: exportId },
    include: exportInclude,
  });
  if (!row) throw new AppError("NOT_FOUND", "Report not found.");
  return row;
}

async function loadVisibleExport(ctx: CompanyContext, exportId: string): Promise<ExportRow> {
  const row = await loadExport(ctx, exportId);
  if (!mayOpen(ctx, row)) {
    throw new AppError("FORBIDDEN", "This report shows figures your role cannot see.");
  }
  return row;
}

async function renderFile(doc: ReportDocument, format: ReportFormat) {
  const { mimeType, ext } = FORMATS[format];
  const bytes = format === "PDF" ? await renderPdf(doc) : renderExcel(doc);
  return { bytes, mimeType, ext, fileName: reportFileName(doc, ext) };
}

function reportLabel(row: { title: string; format: ReportFormat }, from: string, to: string) {
  return `"${row.title}" (${row.format === "PDF" ? "PDF" : "Excel"}, ${formatRange(from, to)})`;
}

/**
 * Makes a report as a PDF or Excel file and keeps it. The file is ready when this
 * returns. A report that fails is kept as FAILED with the error shown to the person.
 */
export async function generateReport(
  ctx: CompanyContext,
  raw: unknown,
  meta?: RequestMeta,
  now: Date = new Date(),
): Promise<SavedReport> {
  assertCanExport(ctx);
  checkRateLimit(`report:${ctx.user.id}`, GENERATE_PER_MINUTE, 60_000);
  const input = generateReportSchema.parse(raw);
  const request = toRequest(ctx, input, now);
  const options: StoredOptions = {
    ...request.options,
    shows: reportShows(ctx, request.metrics),
  };
  const record = {
    companyId: ctx.company.id,
    requestedById: ctx.user.id,
    title: request.title,
    period: request.period.period,
    fromDate: dateColumn(request.period.from),
    toDate: dateColumn(request.period.to),
    metrics: request.metrics,
    options,
    format: input.format,
  };
  const summary = `${reportLabel(record, request.period.from, request.period.to)}: ${request.metrics
    .map((key) => METRIC_INFO[key].label)
    .join(", ")}`;

  let stored: { storagePath: string } | null = null;
  try {
    const doc = await buildReport(ctx, request, now);
    const file = await renderFile(doc, input.format);
    const saved = await writeGeneratedFile(ctx.company.id, "reports", `.${file.ext}`, file.bytes);
    stored = saved;
    const row = await prisma.$transaction(async (tx) => {
      const asset = await tx.fileAsset.create({
        data: {
          companyId: ctx.company.id,
          // Made by the app, not uploaded: it opens through its report only.
          uploadedById: null,
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes: saved.sizeBytes,
          storagePath: saved.storagePath,
          checksum: saved.checksum,
        },
      });
      const created = await tx.reportExport.create({
        data: { ...record, status: "SUCCEEDED", fileId: asset.id, completedAt: new Date() },
        include: exportInclude,
      });
      await auditInCompany(
        ctx,
        meta,
        {
          action: "EXPORT",
          entityType: "ReportExport",
          entityId: created.id,
          summary: `Made report ${summary}`,
        },
        tx,
      );
      return created;
    });
    return present(row);
  } catch (error) {
    // Logs an unexpected error once, with the id the person can quote.
    const safe = toActionError(error);
    if (stored) await deleteStoredFile(stored).catch(() => undefined);
    await prisma.reportExport
      .create({
        data: { ...record, status: "FAILED", error: safe.message, completedAt: new Date() },
      })
      .catch(() => undefined);
    throw safe.code === "INTERNAL" ? new AppError("INTERNAL", safe.message) : error;
  }
}

/** Saved reports this person may open, newest first. */
export async function listReportExports(ctx: CompanyContext, raw: unknown) {
  assertCanExport(ctx);
  const input = listExportsSchema.parse(raw);
  const rows = await ctx.db.reportExport.findMany({
    where: {
      ...visibleWhere(ctx),
      ...(input.mine ? { requestedById: ctx.user.id } : {}),
    },
    include: exportInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.take + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > input.take;
  const items = hasMore ? rows.slice(0, input.take) : rows;
  return {
    items: items.map(present),
    nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
  };
}

export async function getReportExport(ctx: CompanyContext, exportId: string) {
  return present(await loadVisibleExport(ctx, exportId));
}

/** A saved report's file. Every download is written to the activity log. */
export async function downloadReportExport(
  ctx: CompanyContext,
  exportId: string,
  meta?: RequestMeta,
) {
  const row = await loadVisibleExport(ctx, exportId);
  if (row.status !== "SUCCEEDED" || !row.file) {
    throw new AppError(
      "NOT_FOUND",
      row.status === "FAILED"
        ? "This report could not be made, so there is no file. Please make it again."
        : "This report's file is not ready yet.",
    );
  }
  const bytes = await readStoredFile(row.file);
  await auditInCompany(ctx, meta, {
    action: "EXPORT",
    entityType: "ReportExport",
    entityId: row.id,
    summary: `Downloaded report ${reportLabel(row, dateOnly(row.fromDate), dateOnly(row.toDate))}`,
  });
  return { fileName: row.file.fileName, mimeType: row.file.mimeType, bytes };
}

/** The person who made a report, or a Super Admin, deletes it with its file. */
export async function deleteReportExport(
  ctx: CompanyContext,
  exportId: string,
  meta?: RequestMeta,
) {
  const row = await loadExport(ctx, exportId);
  const own = row.requestedById === ctx.user.id;
  const superAdmin = ctx.role?.systemRole === "SUPER_ADMIN" || ctx.user.isSuperAdmin;
  if (!own && !mayOpen(ctx, row)) {
    throw new AppError("FORBIDDEN", "This report shows figures your role cannot see.");
  }
  if (!own && !superAdmin) {
    throw new AppError(
      "FORBIDDEN",
      "Only the person who made this report, or a Super Admin, can delete it.",
    );
  }
  await prisma.$transaction(async (tx) => {
    await tx.reportExport.delete({ where: { id: row.id } });
    if (row.file)
      await tx.fileAsset.deleteMany({ where: { id: row.file.id, companyId: ctx.company.id } });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "DELETE",
        entityType: "ReportExport",
        entityId: row.id,
        summary: `Deleted report ${reportLabel(row, dateOnly(row.fromDate), dateOnly(row.toDate))}`,
      },
      tx,
    );
  });
  if (row.file) await deleteStoredFile(row.file).catch(() => undefined);
  return { id: row.id, deleted: true };
}
