import type { ComplianceType, Prisma } from "@prisma/client";

import { addDays, dateColumn, dateOnly, localDay } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { formatDay } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { assertAllowed } from "@/lib/verdict";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import {
  createComplianceSchema,
  listComplianceSchema,
  renewComplianceSchema,
  updateComplianceSchema,
} from "@/modules/compliance/schemas";
import { canArchive, canDelete, canRenew, canRestore } from "@/modules/compliance/rules";
import {
  COMPLIANCE_TYPE_LABELS,
  complianceStatus,
  CORE_COMPLIANCE_TYPES,
} from "@/modules/compliance/status";
import {
  deleteStoredFile,
  detectFileType,
  MAX_UPLOAD_BYTES,
  readStoredFile,
  safeFileName,
  writeGeneratedFile,
} from "@/modules/files/file.service";
import { settleAlerts } from "@/modules/reminders/reminder.service";

/*
 * Licences and registrations (blueprint section 7, Compliance): trade licence,
 * VAT registration (BIN), TIN, IRC / ERC, BGMEA / BKMEA, fire and environment
 * clearances. Each record keeps its number, issuing authority, issue and expiry
 * days and a scan. Renewing one keeps the old term as history and links the new
 * one to it, so the list shows the licence in force and its past terms.
 *
 * Renewal alerts: the COMPLIANCE_EXPIRY reminder rule (reminders/rules.ts) tells
 * everyone with compliance.manage or compliance.view in the app when a record's
 * renewal window opens (alertDaysBefore, 30 days by default), again 15, 7 and 1
 * days before, on the day, and every week once it has expired, until it is
 * renewed or archived. The summary lists what needs renewing and which core
 * records (trade licence, BIN, TIN) are missing.
 *
 *   compliance.view    see the records, their scans and the summary
 *   compliance.manage  add, edit, renew, archive and delete them, attach scans
 */

const DEFAULT_ALERT_DAYS = 30;

const include = {
  file: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true } },
  previous: { select: { id: true, number: true, issueDate: true, expiryDate: true } },
  renewal: { select: { id: true, number: true, issueDate: true, expiryDate: true } },
} satisfies Prisma.ComplianceDocumentInclude;

type ComplianceRow = Prisma.ComplianceDocumentGetPayload<{ include: typeof include }>;

const term = (t: {
  id: string;
  number: string | null;
  issueDate: Date | null;
  expiryDate: Date | null;
}) => ({
  id: t.id,
  number: t.number,
  issueDate: dateOnly(t.issueDate),
  expiryDate: dateOnly(t.expiryDate),
});

function present(doc: ComplianceRow, today: string) {
  const expiryDate = dateOnly(doc.expiryDate);
  const { status, daysLeft } = complianceStatus(
    {
      expiryDate,
      alertDaysBefore: doc.alertDaysBefore,
      supersededAt: doc.supersededAt,
      archivedAt: doc.archivedAt,
    },
    today,
  );
  return {
    id: doc.id,
    type: doc.type,
    typeLabel: COMPLIANCE_TYPE_LABELS[doc.type],
    title: doc.title,
    number: doc.number,
    issuingAuthority: doc.issuingAuthority,
    issueDate: dateOnly(doc.issueDate),
    expiryDate,
    alertDaysBefore: doc.alertDaysBefore,
    /** The day the renewal window opens and the alerts start. */
    renewFrom: expiryDate ? addDays(expiryDate, -doc.alertDaysBefore) : null,
    /** VALID, EXPIRING (inside the renewal window), EXPIRED, NO_EXPIRY, SUPERSEDED or ARCHIVED. */
    status,
    /** Days until it expires (negative once expired). */
    daysLeft,
    scan: doc.file,
    notes: doc.notes,
    /** The term this one renewed, and the term that renewed this one. */
    previous: doc.previous ? term(doc.previous) : null,
    renewal: doc.renewal ? term(doc.renewal) : null,
    supersededAt: doc.supersededAt,
    archivedAt: doc.archivedAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export type ComplianceView = ReturnType<typeof present>;

const todayOf = (ctx: CompanyContext, now: Date) => localDay(now, ctx.company.timezone);

const describe = (doc: { type: ComplianceType; number: string | null }) =>
  `${COMPLIANCE_TYPE_LABELS[doc.type]}${doc.number ? ` ${doc.number}` : ""}`;

const expiryText = (expiryDate: string | null | undefined) =>
  expiryDate ? `expires ${formatDay(expiryDate)}` : "no expiry";

async function load(ctx: CompanyContext, id: string): Promise<ComplianceRow> {
  const doc = await ctx.db.complianceDocument.findUnique({ where: { id }, include });
  if (!doc) throw new AppError("NOT_FOUND", "Licence record not found.");
  return doc;
}

const live = { supersededAt: null, archivedAt: null } as const;

/** Licences and registrations in force (with history: renewed and archived ones too). */
export async function listCompliance(ctx: CompanyContext, raw: unknown = {}, now = new Date()) {
  const input = listComplianceSchema.parse(raw);
  const today = todayOf(ctx, now);
  const history = input.history || input.status === "SUPERSEDED" || input.status === "ARCHIVED";
  const rows = await ctx.db.complianceDocument.findMany({
    where: {
      ...(input.type ? { type: input.type } : {}),
      ...(history ? {} : live),
      ...(input.search
        ? {
            OR: [
              { title: { contains: input.search, mode: "insensitive" } },
              { number: { contains: input.search, mode: "insensitive" } },
              { issuingAuthority: { contains: input.search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include,
    orderBy: [{ expiryDate: { sort: "asc", nulls: "last" } }, { type: "asc" }, { id: "asc" }],
    take: 500,
  });
  const items = rows
    .map((r) => present(r, today))
    .filter((d) => !input.status || d.status === input.status);
  return { today, items };
}

/**
 * The numbers custom templates print ({CompanyBIN}, {CompanyTradeLicense}...):
 * the trade licence, BIN, TIN, IRC and ERC in force (the latest when there are several).
 */
export async function complianceNumbers(companyId: string, db: Db = prisma) {
  const rows = await db.complianceDocument.findMany({
    where: {
      companyId,
      ...live,
      number: { not: null },
      type: { in: ["TRADE_LICENSE", "VAT_BIN", "TIN", "IRC", "ERC"] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { type: true, number: true },
  });
  const latest = (type: ComplianceType) => rows.find((r) => r.type === type)?.number ?? null;
  return {
    tradeLicense: latest("TRADE_LICENSE"),
    bin: latest("VAT_BIN"),
    tin: latest("TIN"),
    irc: latest("IRC"),
    erc: latest("ERC"),
  };
}

/**
 * Where the company stands: how many records are valid, expiring and expired,
 * what needs renewing (soonest first), which of the trade licence, VAT (BIN)
 * and TIN are not on file, and the numbers templates print.
 */
export async function complianceSummary(ctx: CompanyContext, now = new Date()) {
  const today = todayOf(ctx, now);
  const rows = await ctx.db.complianceDocument.findMany({ where: live, include, take: 500 });
  const items = rows.map((r) => present(r, today));
  const count = (status: ComplianceView["status"]) =>
    items.filter((i) => i.status === status).length;
  return {
    today,
    counts: {
      total: items.length,
      valid: count("VALID"),
      expiring: count("EXPIRING"),
      expired: count("EXPIRED"),
      noExpiry: count("NO_EXPIRY"),
    },
    needsRenewal: items
      .filter((i) => i.status === "EXPIRED" || i.status === "EXPIRING")
      .sort((a, b) => a.daysLeft! - b.daysLeft!),
    missing: CORE_COMPLIANCE_TYPES.filter((type) => !items.some((i) => i.type === type)).map(
      (type) => ({ type, label: COMPLIANCE_TYPE_LABELS[type] }),
    ),
    numbers: await complianceNumbers(ctx.company.id),
  };
}

/** One record with its earlier terms (newest first). */
export async function getCompliance(ctx: CompanyContext, id: string, now = new Date()) {
  const today = todayOf(ctx, now);
  const doc = await load(ctx, id);
  const history: ComplianceView[] = [];
  let previousId = doc.previousId;
  // A renewal chain is short (one term a year); the cap only guards against bad data.
  while (previousId && history.length < 50) {
    const previous = await ctx.db.complianceDocument.findUnique({
      where: { id: previousId },
      include,
    });
    if (!previous) break;
    history.push(present(previous, today));
    previousId = previous.previousId;
  }
  return { ...present(doc, today), history };
}

export async function createCompliance(
  ctx: CompanyContext,
  raw: unknown,
  meta?: RequestMeta,
  now = new Date(),
) {
  const input = createComplianceSchema.parse(raw);
  const doc = await prisma.$transaction(async (tx) => {
    const created = await tx.complianceDocument.create({
      data: {
        companyId: ctx.company.id,
        type: input.type,
        title: input.title ?? COMPLIANCE_TYPE_LABELS[input.type],
        number: input.number || null,
        issuingAuthority: input.issuingAuthority || null,
        issueDate: input.issueDate ? dateColumn(input.issueDate) : null,
        expiryDate: input.expiryDate ? dateColumn(input.expiryDate) : null,
        alertDaysBefore: input.alertDaysBefore ?? DEFAULT_ALERT_DAYS,
        notes: input.notes || null,
      },
      include,
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "ComplianceDocument",
        entityId: created.id,
        summary: `Added ${describe(created)} (${expiryText(input.expiryDate)})`,
      },
      tx,
    );
    return created;
  });
  return present(doc, todayOf(ctx, now));
}

/** Corrects a record (any term, including history). A new expiry day restarts its alerts. */
export async function updateCompliance(
  ctx: CompanyContext,
  id: string,
  raw: unknown,
  meta?: RequestMeta,
  now = new Date(),
) {
  const input = updateComplianceSchema.parse(raw);
  const doc = await load(ctx, id);
  const issueDate = input.issueDate !== undefined ? input.issueDate : dateOnly(doc.issueDate);
  const expiryDate = input.expiryDate !== undefined ? input.expiryDate : dateOnly(doc.expiryDate);
  if (issueDate && expiryDate && expiryDate < issueDate) {
    throw new AppError("VALIDATION", "The expiry date is before the issue date.", {
      expiryDate: ["The expiry date is before the issue date"],
    });
  }
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.complianceDocument.update({
      where: { id: doc.id },
      data: {
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.number !== undefined ? { number: input.number || null } : {}),
        ...(input.issuingAuthority !== undefined
          ? { issuingAuthority: input.issuingAuthority || null }
          : {}),
        ...(input.issueDate !== undefined
          ? { issueDate: input.issueDate ? dateColumn(input.issueDate) : null }
          : {}),
        ...(input.expiryDate !== undefined
          ? { expiryDate: input.expiryDate ? dateColumn(input.expiryDate) : null }
          : {}),
        ...(input.alertDaysBefore !== undefined ? { alertDaysBefore: input.alertDaysBefore } : {}),
        ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
      },
      include,
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "ComplianceDocument",
        entityId: doc.id,
        summary: `Edited ${describe(row)}: ${Object.keys(input).join(", ")}`,
        before: {
          number: doc.number,
          issueDate: dateOnly(doc.issueDate),
          expiryDate: dateOnly(doc.expiryDate),
          alertDaysBefore: doc.alertDaysBefore,
        },
        after: {
          number: row.number,
          issueDate: dateOnly(row.issueDate),
          expiryDate: dateOnly(row.expiryDate),
          alertDaysBefore: row.alertDaysBefore,
        },
      },
      tx,
    );
    return row;
  });
  return present(updated, todayOf(ctx, now));
}

/**
 * Records the next term of a licence: a new record with the new expiry day
 * (number, authority, title and alert window copied unless given), linked to
 * the old one, which stays as history. Its sent alerts count as dealt with.
 */
export async function renewCompliance(
  ctx: CompanyContext,
  id: string,
  raw: unknown,
  meta?: RequestMeta,
  now = new Date(),
) {
  const input = renewComplianceSchema.parse(raw);
  const old = await load(ctx, id);
  assertAllowed(canRenew(old));
  const oldExpiry = dateOnly(old.expiryDate);
  if (oldExpiry && input.expiryDate <= oldExpiry) {
    throw new AppError(
      "VALIDATION",
      `The new expiry date must be after the current one (${formatDay(oldExpiry)}).`,
      { expiryDate: ["Must be after the current expiry date"] },
    );
  }

  const renewed = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "ComplianceDocument", old.id);
    const { count } = await tx.complianceDocument.updateMany({
      where: { id: old.id, companyId: ctx.company.id, ...live },
      data: { supersededAt: now },
    });
    if (count === 0) throw new AppError("CONFLICT", "This record was just renewed or archived.");
    const created = await tx.complianceDocument.create({
      data: {
        companyId: ctx.company.id,
        type: old.type,
        title: input.title ?? old.title,
        number: input.number !== undefined ? input.number || null : old.number,
        issuingAuthority:
          input.issuingAuthority !== undefined
            ? input.issuingAuthority || null
            : old.issuingAuthority,
        issueDate: input.issueDate ? dateColumn(input.issueDate) : null,
        expiryDate: dateColumn(input.expiryDate),
        alertDaysBefore: input.alertDaysBefore ?? old.alertDaysBefore,
        notes: input.notes || null,
        previousId: old.id,
      },
      include,
    });
    await settleAlerts(tx, ctx.company.id, { complianceDocumentId: old.id }, ctx.user.id, now);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "ComplianceDocument",
        entityId: created.id,
        summary: `Renewed ${describe(old)}: ${expiryText(oldExpiry)} -> ${expiryText(input.expiryDate)}`,
      },
      tx,
    );
    return created;
  });
  return present(renewed, todayOf(ctx, now));
}

/** Takes a record off the list (no more alerts); it stays as history and can be restored. */
export async function archiveCompliance(
  ctx: CompanyContext,
  id: string,
  meta?: RequestMeta,
  now = new Date(),
) {
  const doc = await load(ctx, id);
  assertAllowed(canArchive(doc));
  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.complianceDocument.updateMany({
      where: { id: doc.id, companyId: ctx.company.id, archivedAt: null },
      data: { archivedAt: now },
    });
    if (count === 0) throw new AppError("CONFLICT", "This record is already archived.");
    await settleAlerts(tx, ctx.company.id, { complianceDocumentId: doc.id }, ctx.user.id, now);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "ComplianceDocument",
        entityId: doc.id,
        summary: `Archived ${describe(doc)}`,
      },
      tx,
    );
    return tx.complianceDocument.findUniqueOrThrow({ where: { id: doc.id }, include });
  });
  return present(updated, todayOf(ctx, now));
}

/** Puts an archived record back on the list (and back under the renewal alerts). */
export async function restoreCompliance(
  ctx: CompanyContext,
  id: string,
  meta?: RequestMeta,
  now = new Date(),
) {
  const doc = await load(ctx, id);
  assertAllowed(canRestore(doc));
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.complianceDocument.update({
      where: { id: doc.id },
      data: { archivedAt: null },
      include,
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "RESTORE",
        entityType: "ComplianceDocument",
        entityId: doc.id,
        summary: `Restored ${describe(doc)}`,
      },
      tx,
    );
    return row;
  });
  return present(updated, todayOf(ctx, now));
}

/**
 * Deletes a record entered by mistake, with its scan and reminders. Deleting a
 * renewal puts the term it replaced back in force.
 */
export async function deleteCompliance(ctx: CompanyContext, id: string, meta?: RequestMeta) {
  const doc = await load(ctx, id);
  assertAllowed(canDelete(doc));
  const scan = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "ComplianceDocument", doc.id);
    if (doc.previousId) {
      await tx.complianceDocument.updateMany({
        where: { id: doc.previousId, companyId: ctx.company.id },
        data: { supersededAt: null },
      });
    }
    await tx.complianceDocument.delete({ where: { id: doc.id } });
    const file = doc.fileId
      ? await tx.fileAsset.delete({
          where: { id: doc.fileId },
          select: { id: true, storagePath: true },
        })
      : null;
    await auditInCompany(
      ctx,
      meta,
      {
        action: "DELETE",
        entityType: "ComplianceDocument",
        entityId: doc.id,
        summary: `Deleted ${describe(doc)} (${expiryText(dateOnly(doc.expiryDate))})${doc.previousId ? "; the previous term is in force again" : ""}`,
      },
      tx,
    );
    return file;
  });
  if (scan) await deleteStoredFile(scan).catch(() => undefined);
  return { id: doc.id, deleted: true };
}

// --- Scans ----------------------------------------------------------------------------------

/** Attaches the scan of a licence (JPG, PNG, WebP or PDF up to 10 MB), replacing the old one. */
export async function attachScan(
  ctx: CompanyContext,
  id: string,
  upload: { fileName: string; bytes: Buffer },
  meta?: RequestMeta,
  now = new Date(),
) {
  const doc = await load(ctx, id);
  const { bytes } = upload;
  if (bytes.length === 0) throw new AppError("VALIDATION", "The file is empty.");
  if (bytes.length > MAX_UPLOAD_BYTES)
    throw new AppError("VALIDATION", "Files can be up to 10 MB.");
  const type = detectFileType(bytes);
  if (!type)
    throw new AppError("VALIDATION", "Upload a scan as a photo (JPG, PNG or WebP) or a PDF.");

  const saved = await writeGeneratedFile(ctx.company.id, "compliance", type.ext, bytes);
  try {
    const { row, previous } = await prisma.$transaction(async (tx) => {
      await lockRow(tx, "ComplianceDocument", doc.id);
      const current = await tx.complianceDocument.findUniqueOrThrow({
        where: { id: doc.id },
        select: { file: { select: { id: true, storagePath: true } } },
      });
      const file = await tx.fileAsset.create({
        data: {
          companyId: ctx.company.id,
          uploadedById: ctx.user.id,
          fileName: safeFileName(upload.fileName),
          mimeType: type.mimeType,
          sizeBytes: saved.sizeBytes,
          storagePath: saved.storagePath,
          checksum: saved.checksum,
        },
        select: { id: true, fileName: true },
      });
      const updated = await tx.complianceDocument.update({
        where: { id: doc.id },
        data: { fileId: file.id },
        include,
      });
      if (current.file) await tx.fileAsset.delete({ where: { id: current.file.id } });
      await auditInCompany(
        ctx,
        meta,
        {
          action: "UPDATE",
          entityType: "ComplianceDocument",
          entityId: doc.id,
          summary: `${current.file ? "Replaced" : "Attached"} the scan of ${describe(doc)}: ${file.fileName}`,
        },
        tx,
      );
      return { row: updated, previous: current.file };
    });
    if (previous) await deleteStoredFile(previous).catch(() => undefined);
    return present(row, todayOf(ctx, now));
  } catch (error) {
    await deleteStoredFile(saved).catch(() => undefined);
    throw error;
  }
}

/** The scan's bytes for viewing or download. */
export async function getScan(ctx: CompanyContext, id: string) {
  const doc = await ctx.db.complianceDocument.findUnique({
    where: { id },
    select: { file: true },
  });
  if (!doc) throw new AppError("NOT_FOUND", "Licence record not found.");
  if (!doc.file) throw new AppError("NOT_FOUND", "No scan is attached to this record.");
  return {
    fileName: doc.file.fileName,
    mimeType: doc.file.mimeType,
    bytes: await readStoredFile(doc.file),
  };
}

export async function removeScan(
  ctx: CompanyContext,
  id: string,
  meta?: RequestMeta,
  now = new Date(),
) {
  const doc = await load(ctx, id);
  if (!doc.file) throw new AppError("NOT_FOUND", "No scan is attached to this record.");
  const { row, file } = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "ComplianceDocument", doc.id);
    const current = await tx.complianceDocument.findUniqueOrThrow({
      where: { id: doc.id },
      select: { file: { select: { id: true, fileName: true, storagePath: true } } },
    });
    if (!current.file) throw new AppError("NOT_FOUND", "No scan is attached to this record.");
    const updated = await tx.complianceDocument.update({
      where: { id: doc.id },
      data: { fileId: null },
      include,
    });
    await tx.fileAsset.delete({ where: { id: current.file.id } });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "ComplianceDocument",
        entityId: doc.id,
        summary: `Removed the scan of ${describe(doc)} (${current.file.fileName})`,
      },
      tx,
    );
    return { row: updated, file: current.file };
  });
  await deleteStoredFile(file).catch(() => undefined);
  return present(row, todayOf(ctx, now));
}
