import { Prisma } from "@prisma/client";

import { dateOnly } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { PDF_MIME } from "@/lib/pdf";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { loadPrintLogo } from "@/modules/companies/logo.service";
import { canSeeSalaries } from "@/modules/hr/access";
import { buildDocument } from "@/modules/documents/builders";
import {
  contentHash,
  documentFileName,
  PRINT_TYPES,
  type PrintType,
} from "@/modules/documents/model";
import { renderDocumentPdf } from "@/modules/documents/render";
import { listDocumentsSchema, printRequestSchema } from "@/modules/documents/schemas";
import {
  deleteStoredFile,
  readStoredFile,
  storedFileExists,
  writeGeneratedFile,
} from "@/modules/files/file.service";
import { hiddenProfileFlags, mayOpenProfile } from "@/modules/parties/profile-access";
import type { PermissionKey } from "@/modules/rbac/permissions";

/*
 * Printed documents: quotations, proforma and commercial invoices, packing
 * lists, delivery challans, money receipts, buyer / supplier statements, stock
 * availability sheets, payslips and the blank letterhead pad, made as PDFs on
 * the company letterhead (with its BIN and trade licence number) and kept.
 *
 * Every print reads the live data and hashes what would be printed (with the
 * logo and the layout version). When a kept PDF has the same hash, that copy is
 * returned instead of making a new file. When anything changed (a payment, a
 * price, the logo), a new PDF is made and the older one stays, as a record of
 * what was printed before.
 *
 * Who may print what follows who may see the data on screen: sales documents
 * need sales.view, statements parties.ledger.view, stock sheets inventory.view,
 * a buyer's 360° profile parties.view (with only the figures the person sees)
 * and the blank pad documents.letterhead. Payslips print for the people who see
 * salaries (hr/access.ts) and, through My HR, for the employee they belong to;
 * the list of printed documents shows payslips only to the former. Making a PDF
 * and downloading one are written to the activity log.
 */

/** PDFs a person may make in a minute (each one reads the data and lays out pages). */
export const PRINT_PER_MINUTE = 30;

export const PRINT_INFO: Record<
  PrintType,
  {
    label: string;
    plural: string;
    permission: PermissionKey;
    /** Who may print it, when that is more than holding `permission`. */
    allowed?: (ctx: Pick<CompanyContext, "can">) => boolean;
  }
> = {
  QUOTATION: { label: "Quotation", plural: "quotations", permission: "sales.view" },
  PROFORMA_INVOICE: {
    label: "Proforma invoice",
    plural: "proforma invoices",
    permission: "sales.view",
  },
  COMMERCIAL_INVOICE: { label: "Commercial invoice", plural: "invoices", permission: "sales.view" },
  PACKING_LIST: { label: "Packing list", plural: "packing lists", permission: "sales.view" },
  DELIVERY_CHALLAN: {
    label: "Delivery challan",
    plural: "delivery challans",
    permission: "sales.view",
  },
  PAYMENT_RECEIPT: { label: "Money receipt", plural: "money receipts", permission: "sales.view" },
  REFUND_VOUCHER: { label: "Refund voucher", plural: "refund vouchers", permission: "sales.view" },
  LEDGER_STATEMENT: {
    label: "Statement of account",
    plural: "statements",
    permission: "parties.ledger.view",
  },
  STOCK_AVAILABILITY: {
    label: "Stock availability sheet",
    plural: "stock availability sheets",
    permission: "inventory.view",
  },
  LETTERHEAD: {
    label: "Blank letterhead",
    plural: "the blank letterhead",
    permission: "documents.letterhead",
  },
  BUYER_360: {
    label: "Buyer 360° profile",
    plural: "buyer profiles",
    permission: "parties.view",
  },
  PAYSLIP: {
    label: "Payslip",
    plural: "payslips",
    permission: "hr.payroll",
    // HR, payroll and Accounts for anyone's; an employee for their own (checked per payslip).
    allowed: (ctx) => canSeeSalaries(ctx) || ctx.can("portal.self"),
  },
};

/** The permissions that open the documents API (any one of them). */
export const PRINT_PERMISSIONS = [
  ...new Set([
    ...Object.values(PRINT_INFO).map((info) => info.permission),
    // Payslips (PRINT_INFO.PAYSLIP.allowed).
    "hr.manage",
    "accounts.view",
    "portal.self",
  ]),
] as PermissionKey[];

/** Whether this person may print (and see) documents of this type. */
export function mayPrintType(ctx: Pick<CompanyContext, "can">, type: PrintType): boolean {
  const info = PRINT_INFO[type];
  return info.allowed ? info.allowed(ctx) : ctx.can(info.permission);
}

/** The documents this person may print and see. */
export function printableTypes(ctx: Pick<CompanyContext, "can">): PrintType[] {
  return PRINT_TYPES.filter((type) => mayPrintType(ctx, type));
}

/**
 * The kinds of printed documents this person sees in the list of printed documents:
 * the ones they may print, with payslips only for the people who see everyone's.
 */
export function archiveTypes(ctx: Pick<CompanyContext, "can">): PrintType[] {
  return printableTypes(ctx).filter((type) => type !== "PAYSLIP" || canSeeSalaries(ctx));
}

/**
 * The printed documents of these kinds this person may see, as a database filter.
 * A buyer's 360° profile also needs every figure its maker could see
 * (parties/profile-access.ts): one with gross profit stays hidden from sales staff.
 */
export function visibleDocumentsWhere(
  ctx: Pick<CompanyContext, "can">,
  types: PrintType[],
): Prisma.GeneratedDocumentWhereInput {
  const hidden = hiddenProfileFlags(ctx);
  if (hidden.length === 0 || !types.includes("BUYER_360")) return { documentType: { in: types } };
  return {
    documentType: { in: types },
    OR: [
      { documentType: { not: "BUYER_360" } },
      // Only profiles that say they leave these out.
      { AND: hidden.map((flag) => ({ options: { path: ["shows", flag], equals: false } })) },
    ],
  };
}

export function assertMayPrint(ctx: CompanyContext, type: PrintType) {
  if (!mayPrintType(ctx, type)) {
    throw new AppError(
      "FORBIDDEN",
      `You do not have permission to print ${PRINT_INFO[type].plural}.`,
    );
  }
}

/** A kept payslip opens for the people who see salaries, and for the employee it belongs to. */
async function assertMayOpenPayslip(ctx: CompanyContext, row: DocumentRow) {
  if (canSeeSalaries(ctx)) return;
  const own = row.referenceId
    ? await prisma.payrollItem.findFirst({
        where: {
          id: row.referenceId,
          employee: { companyId: ctx.company.id, userId: ctx.user.id },
          run: { companyId: ctx.company.id, status: { in: ["APPROVED", "PAID"] } },
        },
        select: { id: true },
      })
    : null;
  if (!own) throw new AppError("NOT_FOUND", "Document not found.");
}

const isPrintType = (value: string): value is PrintType =>
  (PRINT_TYPES as readonly string[]).includes(value);

export const documentInclude = {
  party: { select: { id: true, code: true, name: true } },
  generatedBy: { select: { id: true, name: true } },
  template: { select: { id: true, name: true, format: true } },
  file: {
    select: { id: true, fileName: true, mimeType: true, sizeBytes: true, storagePath: true },
  },
} satisfies Prisma.GeneratedDocumentInclude;

export type DocumentRow = Prisma.GeneratedDocumentGetPayload<{ include: typeof documentInclude }>;

export function presentDocument(row: DocumentRow) {
  const type = row.documentType as PrintType;
  return {
    id: row.id,
    type,
    typeLabel: PRINT_INFO[type].label,
    title: row.title,
    /** What it was printed for: "Quotation", "ProformaInvoice", "Invoice", "PackingList", "DeliveryChallan", "Payment", "Party", "PartyProfile", "Brand", "Style". */
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    party: row.party,
    /** Statements: the days covered (no start = from the first transaction). */
    periodFrom: dateOnly(row.periodFrom),
    periodTo: dateOnly(row.periodTo),
    /** What was asked for (statement dates, stock sheet styles / brand / warehouse). */
    options: row.options,
    /** Filled from a custom template (Word and HTML ones download as .docx / .html). */
    template: row.template,
    /** Ready to download from /api/documents/:id/download. */
    downloadable: row.file !== null,
    fileName: row.file?.fileName ?? null,
    mimeType: row.file?.mimeType ?? null,
    sizeBytes: row.file?.sizeBytes ?? null,
    generatedBy: row.generatedBy,
    createdAt: row.createdAt,
  };
}

export type PrintedDocument = ReturnType<typeof presentDocument>;

async function findByHash(ctx: CompanyContext, hash: string): Promise<DocumentRow | null> {
  return ctx.db.generatedDocument.findFirst({
    where: { contentHash: hash },
    include: documentInclude,
  });
}

/** Another print took the same content (or the same missing file) at the same moment. */
class LostRace extends Error {}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/**
 * Prints a document as a PDF on the letterhead and keeps it. `reused` is true when
 * nothing changed since the last print, so the kept copy is returned as it is.
 */
export async function printDocument(
  ctx: CompanyContext,
  raw: unknown,
  meta?: RequestMeta,
  now: Date = new Date(),
): Promise<PrintedDocument & { reused: boolean }> {
  const input = printRequestSchema.parse(raw);
  assertMayPrint(ctx, input.type);
  checkRateLimit(`print:${ctx.user.id}`, PRINT_PER_MINUTE, 60_000);

  const { model, record } = await buildDocument(ctx, input, now);
  const logo = await loadPrintLogo(ctx.company.id);
  // A buyer's profile opens only for people who see every part it shows (options.shows).
  const readers = input.type === "BUYER_360" ? record.options : undefined;
  const hash = contentHash(model, logo?.checksum ?? null, readers);

  const existing = await findByHash(ctx, hash);
  if (existing?.file && (await storedFileExists(existing.file))) {
    return { ...presentDocument(existing), reused: true };
  }

  const bytes = await renderDocumentPdf(model, { logo: logo?.bytes });
  const saved = await writeGeneratedFile(ctx.company.id, "documents", ".pdf", bytes);
  const companyId = ctx.company.id;
  try {
    const row = await prisma.$transaction(async (tx) => {
      const asset = await tx.fileAsset.create({
        data: {
          companyId,
          // Made by the app, not uploaded: it opens through its document only.
          uploadedById: null,
          fileName: documentFileName(ctx.company.name, record.title),
          mimeType: PDF_MIME,
          sizeBytes: saved.sizeBytes,
          storagePath: saved.storagePath,
          checksum: saved.checksum,
        },
      });
      let documentId: string;
      if (existing) {
        // Same content, but its kept file went missing: it gets the new file.
        const { count } = await tx.generatedDocument.updateMany({
          where: { id: existing.id, companyId, fileId: existing.fileId },
          data: { fileId: asset.id },
        });
        if (count === 0) throw new LostRace();
        if (existing.fileId) {
          await tx.fileAsset.deleteMany({ where: { id: existing.fileId, companyId } });
        }
        documentId = existing.id;
      } else {
        const created = await tx.generatedDocument.create({
          data: {
            companyId,
            documentType: input.type,
            referenceType: record.referenceType,
            referenceId: record.referenceId,
            partyId: record.partyId,
            fileId: asset.id,
            title: record.title,
            periodFrom: record.periodFrom ?? null,
            periodTo: record.periodTo ?? null,
            contentHash: hash,
            options: record.options,
            generatedById: ctx.user.id,
          },
          select: { id: true },
        });
        documentId = created.id;
      }
      await auditInCompany(
        ctx,
        meta,
        {
          action: "EXPORT",
          entityType: "GeneratedDocument",
          entityId: documentId,
          summary: `${existing ? "Made PDF again (the kept copy was missing)" : "Made PDF"}: ${record.title}`,
        },
        tx,
      );
      return tx.generatedDocument.findUniqueOrThrow({
        where: { id: documentId },
        include: documentInclude,
      });
    });
    return { ...presentDocument(row), reused: false };
  } catch (error) {
    await deleteStoredFile(saved).catch(() => undefined);
    if (error instanceof LostRace || isUniqueViolation(error)) {
      const winner = await findByHash(ctx, hash);
      if (winner) return { ...presentDocument(winner), reused: true };
    }
    throw error;
  }
}

/** Printed documents this person may see, newest first. */
export async function listDocuments(ctx: CompanyContext, raw: unknown) {
  const input = listDocumentsSchema.parse(raw);
  const allowed = archiveTypes(ctx);
  if (input.type && !allowed.includes(input.type)) {
    throw new AppError(
      "FORBIDDEN",
      `You do not have permission to see ${PRINT_INFO[input.type].plural}.`,
    );
  }
  const types = input.type ? [input.type] : allowed;
  if (types.length === 0) {
    throw new AppError("FORBIDDEN", "You do not have permission to see printed documents.");
  }
  const rows = await ctx.db.generatedDocument.findMany({
    where: {
      ...visibleDocumentsWhere(ctx, types),
      ...(input.referenceId ? { referenceId: input.referenceId } : {}),
      ...(input.partyId ? { partyId: input.partyId } : {}),
    },
    include: documentInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.take + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > input.take;
  const items = hasMore ? rows.slice(0, input.take) : rows;
  return {
    items: items.map(presentDocument),
    nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
  };
}

async function loadDocument(ctx: CompanyContext, documentId: string): Promise<DocumentRow> {
  const row = await ctx.db.generatedDocument.findUnique({
    where: { id: documentId },
    include: documentInclude,
  });
  if (!row || !isPrintType(row.documentType)) {
    throw new AppError("NOT_FOUND", "Document not found.");
  }
  assertMayPrint(ctx, row.documentType);
  if (row.documentType === "PAYSLIP") await assertMayOpenPayslip(ctx, row);
  if (row.documentType === "BUYER_360" && !mayOpenProfile(ctx, row.options)) {
    throw new AppError("FORBIDDEN", "This profile shows figures your role cannot see.");
  }
  return row;
}

export async function getDocument(ctx: CompanyContext, documentId: string) {
  return presentDocument(await loadDocument(ctx, documentId));
}

/** A printed document's file (a PDF, or a filled Word / HTML template). Every download is logged. */
export async function downloadDocument(
  ctx: CompanyContext,
  documentId: string,
  meta?: RequestMeta,
) {
  const row = await loadDocument(ctx, documentId);
  const gone = () =>
    new AppError(
      "NOT_FOUND",
      "This file is no longer in storage. Print the document again to make a new copy.",
    );
  if (!row.file) throw gone();
  let bytes: Buffer;
  try {
    bytes = await readStoredFile(row.file);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") throw gone();
    throw error;
  }
  await auditInCompany(ctx, meta, {
    action: "EXPORT",
    entityType: "GeneratedDocument",
    entityId: row.id,
    summary: `Downloaded ${row.file.mimeType === PDF_MIME ? "PDF" : "file"}: ${row.title}`,
  });
  return { fileName: row.file.fileName, mimeType: row.file.mimeType, bytes };
}
