import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { ownerStandIn } from "@/modules/bug-guard/owner";
import { checkLogo } from "@/modules/companies/logo.service";
import { documentFileName } from "@/modules/documents/model";
import {
  deleteStoredFile,
  readStoredFile,
  safeFileName,
  writeGeneratedFile,
} from "@/modules/files/file.service";

import { buildBusinessReport, REPORT_PARTS, reportPdf } from "./downloads.service";
import { assertCanManageStores, assertCanSeeStores, canSeeStoreCosts } from "./stores.service";

/*
 * A store's own pad (plan v6 sec 12): its logo, checked like the company's,
 * and its year-end summaries (sec 14, point 2), made by themselves once a
 * year is over and kept, so a bank or the tax office can have one at once.
 */

/** Puts the store's logo on its pad (or changes it). Needs retail.manage. */
export async function uploadStoreLogo(
  ctx: CompanyContext,
  storeId: string,
  upload: { fileName: string; bytes: Buffer },
  meta?: RequestMeta,
) {
  assertCanManageStores(ctx);
  const image = checkLogo(upload.bytes);
  const saved = await writeGeneratedFile(ctx.company.id, "logos", image.ext, upload.bytes);
  try {
    const previous = await prisma.$transaction(async (tx) => {
      await lockRow(tx, "RetailStore", storeId);
      const store = await tx.retailStore.findFirst({
        where: { id: storeId, companyId: ctx.company.id },
        select: { name: true, logoFile: { select: { id: true, storagePath: true } } },
      });
      if (!store) throw new AppError("NOT_FOUND", "There is no such store.");
      const file = await tx.fileAsset.create({
        data: {
          companyId: ctx.company.id,
          uploadedById: ctx.user.id,
          fileName: safeFileName(upload.fileName),
          mimeType: image.mimeType,
          sizeBytes: saved.sizeBytes,
          storagePath: saved.storagePath,
          checksum: saved.checksum,
        },
      });
      await tx.retailStore.update({ where: { id: storeId }, data: { logoFileId: file.id } });
      if (store.logoFile) await tx.fileAsset.delete({ where: { id: store.logoFile.id } });
      await auditInCompany(
        ctx,
        meta,
        {
          action: "UPDATE",
          entityType: "RetailStore",
          entityId: storeId,
          summary: `${store.logoFile ? "Changed" : "Added"} the logo of ${store.name}'s pad`,
        },
        tx,
      );
      return store.logoFile;
    });
    if (previous) await deleteStoredFile(previous).catch(() => undefined);
  } catch (error) {
    await deleteStoredFile(saved).catch(() => undefined);
    throw error;
  }
}

/** Takes the logo off the store's pad. */
export async function removeStoreLogo(ctx: CompanyContext, storeId: string, meta?: RequestMeta) {
  assertCanManageStores(ctx);
  const removed = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "RetailStore", storeId);
    const store = await tx.retailStore.findFirst({
      where: { id: storeId, companyId: ctx.company.id },
      select: { name: true, logoFile: { select: { id: true, storagePath: true } } },
    });
    if (!store) throw new AppError("NOT_FOUND", "There is no such store.");
    if (!store.logoFile) return null;
    await tx.retailStore.update({ where: { id: storeId }, data: { logoFileId: null } });
    await tx.fileAsset.delete({ where: { id: store.logoFile.id } });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "RetailStore",
        entityId: storeId,
        summary: `Removed the logo of ${store.name}'s pad`,
      },
      tx,
    );
    return store.logoFile;
  });
  if (removed) await deleteStoredFile(removed).catch(() => undefined);
}

/** The store's logo image, for its page. */
export async function storeLogoImage(ctx: CompanyContext, storeId: string) {
  assertCanSeeStores(ctx);
  const store = await ctx.db.retailStore.findUnique({
    where: { id: storeId },
    select: { logoFile: true },
  });
  if (!store?.logoFile) throw new AppError("NOT_FOUND", "This store has no logo yet.");
  return {
    fileName: store.logoFile.fileName,
    mimeType: store.logoFile.mimeType,
    bytes: await readStoredFile(store.logoFile),
  };
}

/** The store's kept year-end summaries, newest first. */
export async function listYearReports(ctx: CompanyContext, storeId: string) {
  assertCanSeeStores(ctx);
  // A year-end summary carries the ERP's own books on the store.
  if (!canSeeStoreCosts(ctx)) return [];
  const rows = await ctx.db.retailYearReport.findMany({
    where: { storeId },
    orderBy: { year: "desc" },
    select: { id: true, year: true, createdAt: true },
  });
  return rows.map((r) => ({ id: r.id, year: r.year, createdAt: r.createdAt.toISOString() }));
}

/** One kept year-end summary as a file (logged). */
export async function yearReportFile(ctx: CompanyContext, id: string, meta?: RequestMeta) {
  assertCanSeeStores(ctx);
  if (!canSeeStoreCosts(ctx)) {
    throw new AppError("FORBIDDEN", "Year-end summaries are for those who see the stores' costs.");
  }
  const row = await ctx.db.retailYearReport.findUnique({
    where: { id },
    include: { file: true, store: { select: { name: true } } },
  });
  if (!row) throw new AppError("NOT_FOUND", "There is no such year-end summary.");
  await auditInCompany(ctx, meta, {
    action: "EXPORT",
    entityType: "RetailStore",
    entityId: row.storeId,
    summary: `Downloaded ${row.store.name}'s year-end summary for ${row.year}`,
  });
  return {
    fileName: row.file.fileName,
    mimeType: row.file.mimeType,
    bytes: await readStoredFile(row.file),
  };
}

/**
 * The nightly housekeeping: once a year is over, each store that was open in
 * it gets its summary of that year (every part but the daily rows, on its own
 * pad), made in the name of the company's owner. Made once; never changed.
 */
export async function makeYearReports(now: Date = new Date()) {
  let made = 0;
  const stores = await prisma.retailStore.findMany({
    select: { id: true, name: true, companyId: true, createdAt: true, closedAt: true },
  });
  const contexts = new Map<string, CompanyContext | null>();
  for (const store of stores) {
    if (!contexts.has(store.companyId)) {
      contexts.set(store.companyId, await ownerStandIn(store.companyId, null, "Year-end summary"));
    }
    const ctx = contexts.get(store.companyId);
    if (!ctx) continue;
    const year = Number(localDay(now, ctx.company.timezone).slice(0, 4)) - 1;
    const opened = Number(localDay(store.createdAt, ctx.company.timezone).slice(0, 4));
    if (opened > year) continue;
    if (
      store.closedAt &&
      Number(localDay(store.closedAt, ctx.company.timezone).slice(0, 4)) < year
    ) {
      continue;
    }
    const done = await prisma.retailYearReport.findUnique({
      where: { storeId_year: { storeId: store.id, year } },
    });
    if (done) continue;
    const report = await buildBusinessReport(
      ctx,
      "store",
      store.id,
      { from: `${year}-01-01`, to: `${year}-12-31` },
      REPORT_PARTS.filter((p) => p !== "days"),
    );
    report.title = `Year-end summary ${year}`;
    const bytes = await reportPdf(ctx, report);
    const saved = await writeGeneratedFile(store.companyId, "retail-year", "pdf", bytes);
    try {
      await prisma.$transaction(async (tx) => {
        const file = await tx.fileAsset.create({
          data: {
            companyId: store.companyId,
            uploadedById: ctx.user.id,
            fileName: documentFileName(store.name, `Year-end summary ${year}`),
            mimeType: "application/pdf",
            sizeBytes: saved.sizeBytes,
            storagePath: saved.storagePath,
            checksum: saved.checksum,
          },
        });
        await tx.retailYearReport.create({
          data: { companyId: store.companyId, storeId: store.id, year, fileId: file.id },
        });
      });
      made++;
    } catch (error) {
      await deleteStoredFile(saved).catch(() => undefined);
      // Another run made it meanwhile: nothing to do.
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }
  return made;
}
