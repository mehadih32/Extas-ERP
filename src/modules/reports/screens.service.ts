import { z } from "zod";

import { localDay, localTime } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { formatDay } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { queryBoolean } from "@/lib/query-params";
import { type ActionError, toActionError } from "@/lib/result";
import type { CompanyContext } from "@/modules/auth/context";
import { PRINT_TYPES, type PrintType } from "@/modules/documents/model";
import {
  listDocuments,
  mayPrintType,
  PRINT_INFO,
  type PrintedDocument,
} from "@/modules/documents/print.service";
import { canSeeSalaries } from "@/modules/hr/access";
import { PERIOD_LABELS } from "@/modules/reports/builder";
import { allowedMetrics, METRIC_INFO, type ReportMetricKey } from "@/modules/reports/catalog";
import type { ReportDocument } from "@/modules/reports/document";
import {
  actingOn,
  getReportExport,
  listReportExports,
  previewReport,
  reportBuilderOptions,
  type SavedReport,
} from "@/modules/reports/export.service";
import { mayDeleteReport, reportsKeys } from "@/modules/reports/rules";
import { getTemplate, listTemplates, tagCatalog } from "@/modules/templates/template.service";
import { TEMPLATE_TYPES, type TemplateType } from "@/modules/templates/tags";

/*
 * What the Reports & documents screens show and offer: saved reports and the
 * Report Builder (reports.export), the printed documents a person may see with
 * links back to what they were printed for, and the document templates
 * (templates.manage). Each screen's `can` flags come from the same rules the
 * services check (rules.ts), so a screen never offers what the server refuses.
 */

const PAGE = 20;

/** "2 Oct 2026, 15:04" in company time. */
function madeOn(ctx: CompanyContext, at: Date): string {
  return `${formatDay(localDay(at, ctx.company.timezone))}, ${localTime(at, ctx.company.timezone)}`;
}

// =============================================================================
// Reports
// =============================================================================

function reportRow(ctx: CompanyContext, report: SavedReport) {
  return {
    ...report,
    metricLabels: report.metrics.map((key) => METRIC_INFO[key as ReportMetricKey]?.label ?? key),
    madeOn: madeOn(ctx, report.createdAt),
    /** "This month", "Chosen dates". */
    periodLabel: PERIOD_LABELS[report.period as keyof typeof PERIOD_LABELS] ?? report.period,
    can: {
      delete: mayDeleteReport(actingOn(ctx), { requestedById: report.requestedBy?.id ?? null }).ok,
    },
  };
}

export type ReportRow = ReturnType<typeof reportRow>;

const reportListSchema = z.object({
  mine: queryBoolean.optional(),
  cursor: z.string().min(1).optional(),
});

/** A page of saved reports this person may open (for "Show more"). */
export async function listReportRows(ctx: CompanyContext, raw: unknown) {
  const input = reportListSchema.parse(raw);
  const page = await listReportExports(ctx, { ...input, take: PAGE });
  return { items: page.items.map((r) => reportRow(ctx, r)), nextCursor: page.nextCursor };
}

/** The saved reports, newest first, and whether this person can make one. */
export async function getReportsScreen(ctx: CompanyContext, raw: unknown) {
  const input = reportListSchema.parse(raw);
  const list = await listReportRows(ctx, { mine: input.mine });
  return { mine: input.mine ?? false, canMake: allowedMetrics(ctx).length > 0, list };
}

/**
 * The Report Builder: the metrics this person may pick (only those), the periods
 * and formats, and, when asked, the report as it would be made (`preview`) or
 * why it cannot be (`previewError`).
 */
export async function getReportBuilderScreen(
  ctx: CompanyContext,
  query: unknown,
  options: { show?: boolean } = {},
  now: Date = new Date(),
) {
  const builder = reportBuilderOptions(ctx);
  let preview: ReportDocument | null = null;
  let previewError: ActionError | null = null;
  if (options.show) {
    try {
      preview = await previewReport(ctx, query, now);
    } catch (error) {
      previewError = toActionError(error);
    }
  }
  return {
    metrics: builder.metrics.filter((m) => m.available),
    periods: builder.periods,
    formats: builder.formats,
    defaults: builder.defaults,
    preview,
    previewError,
  };
}

/** A saved report: what it covers, who made it, and whether this person may delete it. */
export async function getSavedReportScreen(ctx: CompanyContext, exportId: string) {
  const report = reportRow(ctx, await getReportExport(ctx, exportId));
  const allowed = new Set(allowedMetrics(ctx));
  return {
    report,
    can: {
      delete: report.can.delete,
      /** Every figure in it is still one this person may pick. */
      makeAgain: report.metrics.every((key) => allowed.has(key as ReportMetricKey)),
    },
  };
}

// =============================================================================
// Printed documents
// =============================================================================

type SourceLink = { href: string; label: string };

const sales = {
  quotation: (id: string) => `/sales/quotations/${encodeURIComponent(id)}`,
  proforma: (id: string) => `/sales/proformas/${encodeURIComponent(id)}`,
  invoice: (id: string) => `/sales/invoices/${encodeURIComponent(id)}`,
  order: (id: string) => `/sales/orders/${encodeURIComponent(id)}`,
  payment: (id: string) => `/sales/payments/${encodeURIComponent(id)}`,
};

/**
 * Where each printed document came from, for its link: a sales record (sales.view),
 * a statement (parties.ledger.view), a buyer's or supplier's profile (parties.view),
 * a style (inventory.view) or a payslip (salaries).
 * Records that are gone, or that this person cannot open, get no link.
 */
async function sourceLinks(
  ctx: CompanyContext,
  docs: PrintedDocument[],
): Promise<Map<string, SourceLink>> {
  const ids = (type: string) => [
    ...new Set(
      docs.filter((d) => d.referenceType === type && d.referenceId).map((d) => d.referenceId!),
    ),
  ];
  const links = new Map<string, SourceLink>();
  const salesView = ctx.can("sales.view");
  const [packingLists, challans, refunds, parties, payslips] = await Promise.all([
    salesView && ids("PackingList").length
      ? ctx.db.packingList.findMany({
          where: { id: { in: ids("PackingList") } },
          select: { id: true, orderId: true },
        })
      : [],
    salesView && ids("DeliveryChallan").length
      ? ctx.db.deliveryChallan.findMany({
          where: { id: { in: ids("DeliveryChallan") } },
          select: { id: true, orderId: true },
        })
      : [],
    salesView && ids("Refund").length
      ? ctx.db.refund.findMany({
          where: { id: { in: ids("Refund") } },
          select: { id: true, orderId: true, proformaId: true },
        })
      : [],
    ctx.can("parties.ledger.view") && ids("Party").length
      ? ctx.db.party.findMany({
          where: { id: { in: ids("Party") } },
          select: { id: true, kind: true },
        })
      : [],
    canSeeSalaries(ctx) && ids("PayrollItem").length
      ? prisma.payrollItem.findMany({
          where: { id: { in: ids("PayrollItem") }, run: { companyId: ctx.company.id } },
          select: { id: true, runId: true },
        })
      : [],
  ]);
  const orderOf = new Map([...packingLists, ...challans].map((r) => [r.id, r.orderId]));
  const refundOf = new Map(refunds.map((r) => [r.id, r]));
  const partyOf = new Map(parties.map((p) => [p.id, p.kind]));
  const runOf = new Map(payslips.map((p) => [p.id, p.runId]));

  for (const d of docs) {
    const id = d.referenceId;
    if (!id) continue;
    let link: SourceLink | null = null;
    const to = (href: string, label: string) => ({ href, label });
    switch (d.referenceType) {
      case "Quotation":
        link = salesView ? to(sales.quotation(id), "Open the quotation") : null;
        break;
      case "ProformaInvoice":
        link = salesView ? to(sales.proforma(id), "Open the proforma") : null;
        break;
      case "Invoice":
        link = salesView ? to(sales.invoice(id), "Open the invoice") : null;
        break;
      case "Payment":
        link = salesView ? to(sales.payment(id), "Open the payment") : null;
        break;
      case "PackingList":
      case "DeliveryChallan": {
        const orderId = orderOf.get(id);
        link = orderId ? to(sales.order(orderId), "Open the order") : null;
        break;
      }
      case "Refund": {
        const refund = refundOf.get(id);
        link = refund?.orderId
          ? to(sales.order(refund.orderId), "Open the order")
          : refund?.proformaId
            ? to(sales.proforma(refund.proformaId), "Open the proforma")
            : null;
        break;
      }
      case "Party": {
        const kind = partyOf.get(id);
        link = kind
          ? to(
              `/parties/${kind === "SUPPLIER" ? "suppliers" : "buyers"}/${encodeURIComponent(id)}/statement`,
              "Open the statement",
            )
          : null;
        break;
      }
      case "PartyProfile":
        link = !ctx.can("parties.view")
          ? null
          : d.type === "SUPPLIER_360"
            ? to(`/parties/suppliers/${encodeURIComponent(id)}`, "Open the supplier")
            : to(`/parties/buyers/${encodeURIComponent(id)}`, "Open the buyer");
        break;
      case "Style":
        link = ctx.can("inventory.view")
          ? to(`/products/${encodeURIComponent(id)}`, "Open the style")
          : null;
        break;
      case "PayrollItem": {
        const runId = runOf.get(id);
        link = runId
          ? to(
              `/hr/payroll/${encodeURIComponent(runId)}/payslips/${encodeURIComponent(id)}`,
              "Open the payslip",
            )
          : null;
        break;
      }
    }
    if (link) links.set(d.id, link);
  }
  return links;
}

function documentRow(ctx: CompanyContext, d: PrintedDocument, links: Map<string, SourceLink>) {
  return {
    id: d.id,
    type: d.type,
    // Letters filled from a letter template are kept as letterheads.
    typeLabel: d.type === "LETTERHEAD" && d.template ? "Letter" : d.typeLabel,
    title: d.title,
    party: d.party,
    template: d.template ? { name: d.template.name, format: d.template.format } : null,
    fileName: d.fileName,
    /** PDFs open in the browser; filled Word and HTML templates download. */
    isPdf: d.mimeType === "application/pdf",
    downloadable: d.downloadable,
    sizeBytes: d.sizeBytes,
    generatedBy: d.generatedBy,
    createdAt: d.createdAt,
    madeOn: madeOn(ctx, d.createdAt),
    /** What it was printed for, when this person may open it. */
    source: links.get(d.id) ?? null,
  };
}

export type DocumentRow = ReturnType<typeof documentRow>;

const documentListSchema = z.object({
  type: z.enum(PRINT_TYPES).optional(),
  cursor: z.string().min(1).optional(),
});

/** A page of printed documents this person may see (for "Show more"). */
export async function listDocumentRows(ctx: CompanyContext, raw: unknown) {
  const input = documentListSchema.parse(raw);
  const page = await listDocuments(ctx, { ...input, take: PAGE });
  const links = await sourceLinks(ctx, page.items);
  return { items: page.items.map((d) => documentRow(ctx, d, links)), nextCursor: page.nextCursor };
}

/**
 * The printed documents (newest first, optionally of one kind), the kinds this
 * person may see, and what they may print from here: the blank letterhead pad
 * and letters from the company's letter templates.
 */
export async function getDocumentsScreen(ctx: CompanyContext, raw: unknown) {
  const keys = reportsKeys(ctx);
  if (!keys.documents) {
    throw new AppError("FORBIDDEN", "You do not have permission to see printed documents.");
  }
  const input = documentListSchema.parse(raw);
  const [list, letterTemplates] = await Promise.all([
    listDocumentRows(ctx, { type: input.type }),
    keys.letterhead ? templateChoices(ctx, "LETTERHEAD") : [],
  ]);
  return {
    type: input.type ?? null,
    types: keys.documentTypes.map((type) => ({
      key: type,
      // Letters filled from letter templates are kept as letterheads too.
      label: type === "LETTERHEAD" ? "Letterhead and letters" : PRINT_INFO[type].label,
    })),
    list,
    letterTemplates,
    can: {
      letterhead: keys.letterhead,
      /** Address a letter to a buyer or supplier. */
      pickParty: ctx.can("parties.view"),
      templates: keys.templates,
    },
  };
}

const letterPartiesSchema = z.object({ search: z.string().trim().max(100).optional() });

/** Buyers and suppliers to address a letter to (parties.view): the first matches by name. */
export async function findLetterParties(ctx: CompanyContext, raw: unknown) {
  if (!ctx.can("parties.view")) {
    throw new AppError("FORBIDDEN", "You do not have permission to see buyers and suppliers.");
  }
  const { search } = letterPartiesSchema.parse(raw);
  return ctx.db.party.findMany({
    where: search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { code: { contains: search, mode: "insensitive" } },
            { contactPerson: { contains: search, mode: "insensitive" } },
            { phone: { contains: search } },
          ],
        }
      : { status: "ACTIVE" },
    select: { id: true, code: true, name: true, kind: true, city: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 12,
  });
}

export type LetterParty = Awaited<ReturnType<typeof findLetterParties>>[number];

// =============================================================================
// Templates
// =============================================================================

function assertManagesTemplates(ctx: CompanyContext) {
  if (!ctx.can("templates.manage")) {
    throw new AppError("FORBIDDEN", "You do not have permission to change document templates.");
  }
}

/** What a template is for: "Quotation", "Letter". */
const templateLabel = (type: TemplateType) =>
  type === "LETTERHEAD" ? "Letter" : PRINT_INFO[type].label;

/** Every template by document type (templates.manage), with the types a new one can be for. */
export async function getTemplatesScreen(ctx: CompanyContext) {
  assertManagesTemplates(ctx);
  const { items } = await listTemplates(ctx, {});
  return {
    types: TEMPLATE_TYPES.map((type) => ({ key: type, label: templateLabel(type) })),
    groups: TEMPLATE_TYPES.map((type) => ({
      type,
      label: templateLabel(type),
      templates: items
        .filter((t) => t.documentType === type)
        .map((t) => ({
          id: t.id,
          name: t.name,
          format: t.format,
          isDefault: t.isDefault,
          isActive: t.isActive,
          tags: t.placeholders.length,
          unmapped: t.unmapped.length,
          pages: t.pages?.length ?? null,
          updatedAt: t.updatedAt,
        })),
    })),
  };
}

/**
 * The newest record a template of this type can be tried on: a quotation,
 * proforma, invoice (not a voided one) or challan; a letter needs none.
 */
async function sampleRecord(
  ctx: CompanyContext,
  type: TemplateType,
): Promise<{ id: string | null; label: string } | null> {
  const newest = { orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }] };
  const select = { id: true, number: true };
  switch (type) {
    case "QUOTATION": {
      const q = await ctx.db.quotation.findFirst({ ...newest, select });
      return q && { id: q.id, label: `quotation ${q.number}` };
    }
    case "PROFORMA_INVOICE": {
      const pi = await ctx.db.proformaInvoice.findFirst({ ...newest, select });
      return pi && { id: pi.id, label: `proforma ${pi.number}` };
    }
    case "COMMERCIAL_INVOICE": {
      const inv = await ctx.db.invoice.findFirst({
        ...newest,
        where: { status: { not: "VOID" } },
        select,
      });
      return inv && { id: inv.id, label: `invoice ${inv.number}` };
    }
    case "DELIVERY_CHALLAN": {
      const ch = await ctx.db.deliveryChallan.findFirst({ ...newest, select });
      return ch && { id: ch.id, label: `challan ${ch.number}` };
    }
    case "LETTERHEAD":
      return { id: null, label: "a blank letter" };
  }
}

/**
 * One template with its tags (or placed tags), the catalogue of data its type
 * can print, its HTML (HTML templates, to edit), how many documents were filled
 * from it, and the newest record to try it on.
 */
export async function getTemplateScreen(ctx: CompanyContext, templateId: string) {
  assertManagesTemplates(ctx);
  const template = await getTemplate(ctx, templateId);
  const [filled, html, sample] = await Promise.all([
    ctx.db.generatedDocument.count({ where: { templateId: template.id } }),
    template.format === "HTML"
      ? ctx.db.documentTemplate
          .findUnique({ where: { id: template.id }, select: { htmlContent: true } })
          .then((t) => t?.htmlContent ?? "")
      : null,
    sampleRecord(ctx, template.documentType),
  ]);
  return {
    template: { ...template, documentLabel: templateLabel(template.documentType) },
    catalog: tagCatalog(template.documentType).tags,
    html,
    filled,
    sample,
  };
}

export type TemplateScreen = Awaited<ReturnType<typeof getTemplateScreen>>;

export type TemplateChoice = { id: string; name: string; format: string; isDefault: boolean };

/**
 * The active templates a document of this type can be filled from, defaults
 * first; none for people who may not print the type.
 */
export async function templateChoices(
  ctx: CompanyContext,
  type: TemplateType,
): Promise<TemplateChoice[]> {
  if (!mayPrintType(ctx, type as PrintType)) return [];
  return ctx.db.documentTemplate.findMany({
    where: { documentType: type, isActive: true },
    select: { id: true, name: true, format: true, isDefault: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    take: 50,
  });
}
