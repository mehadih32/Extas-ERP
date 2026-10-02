import { createHash } from "node:crypto";

import { AppError } from "@/lib/errors";
import { ImageCheckError, type ImageInfo, inspectImage, LOGO_LIMITS } from "@/lib/images";
import { pdfImageSize } from "@/lib/pdf";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import {
  deleteStoredFile,
  readStoredFile,
  safeFileName,
  writeGeneratedFile,
} from "@/modules/files/file.service";

/*
 * The company logo printed on the letterhead of every PDF. It is uploaded in the
 * company settings (company.settings) and checked so the PDF writer can always
 * draw it: a PNG or JPG of up to 2 MB and 3000 pixels a side. Replacing or
 * removing it deletes the old file; PDFs already made keep the logo they had.
 */

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const logoSelect = {
  id: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  storagePath: true,
  checksum: true,
  createdAt: true,
} as const;

function assertCanEdit(ctx: CompanyContext) {
  if (!ctx.can("company.settings")) {
    throw new AppError("FORBIDDEN", "You do not have permission to change the letterhead.");
  }
}

/** The image's type and size, or a VALIDATION error saying what is wrong with it. */
export function checkLogo(bytes: Buffer): ImageInfo {
  if (bytes.length === 0) throw new AppError("VALIDATION", "The file is empty.");
  if (bytes.length > MAX_LOGO_BYTES) {
    throw new AppError("VALIDATION", "A logo can be up to 2 MB.");
  }
  let image: ImageInfo;
  try {
    image = inspectImage(bytes, LOGO_LIMITS);
  } catch (error) {
    if (error instanceof ImageCheckError) throw new AppError("VALIDATION", error.message);
    throw error;
  }
  // The PDF writer must read it the same way, or it could not draw it.
  const seen = pdfImageSize(bytes);
  if (!seen || seen.width !== image.width || seen.height !== image.height) {
    throw new AppError(
      "VALIDATION",
      "This image cannot be printed; save it again as a standard PNG or JPG.",
    );
  }
  return image;
}

/** Saves a new letterhead logo for the active company, replacing the old one. */
export async function uploadCompanyLogo(
  ctx: CompanyContext,
  upload: { fileName: string; bytes: Buffer },
  meta?: RequestMeta,
) {
  assertCanEdit(ctx);
  const image = checkLogo(upload.bytes);
  const saved = await writeGeneratedFile(ctx.company.id, "logos", image.ext, upload.bytes);
  try {
    const { logo, previous } = await prisma.$transaction(async (tx) => {
      await lockRow(tx, "Company", ctx.company.id);
      const { logoFile } = await tx.company.findUniqueOrThrow({
        where: { id: ctx.company.id },
        select: { logoFile: { select: { id: true, storagePath: true } } },
      });
      const created = await tx.fileAsset.create({
        data: {
          companyId: ctx.company.id,
          uploadedById: ctx.user.id,
          fileName: safeFileName(upload.fileName),
          mimeType: image.mimeType,
          sizeBytes: saved.sizeBytes,
          storagePath: saved.storagePath,
          checksum: saved.checksum,
        },
        select: logoSelect,
      });
      await tx.company.update({
        where: { id: ctx.company.id },
        data: { logoFileId: created.id },
      });
      if (logoFile) await tx.fileAsset.delete({ where: { id: logoFile.id } });
      await auditInCompany(
        ctx,
        meta,
        {
          action: "UPDATE",
          entityType: "Company",
          entityId: ctx.company.id,
          summary: `${logoFile ? "Changed" : "Added"} the letterhead logo: ${created.fileName} (${image.width} × ${image.height} px)`,
        },
        tx,
      );
      return { logo: created, previous: logoFile };
    });
    if (previous) await deleteStoredFile(previous).catch(() => undefined);
    return {
      id: logo.id,
      fileName: logo.fileName,
      mimeType: logo.mimeType,
      sizeBytes: logo.sizeBytes,
      width: image.width,
      height: image.height,
      createdAt: logo.createdAt,
    };
  } catch (error) {
    await deleteStoredFile(saved).catch(() => undefined);
    throw error;
  }
}

/** Takes the logo off the letterhead (nothing to do when there is none). */
export async function removeCompanyLogo(ctx: CompanyContext, meta?: RequestMeta) {
  assertCanEdit(ctx);
  const removed = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "Company", ctx.company.id);
    const { logoFile } = await tx.company.findUniqueOrThrow({
      where: { id: ctx.company.id },
      select: { logoFile: { select: { id: true, fileName: true, storagePath: true } } },
    });
    if (!logoFile) return null;
    await tx.company.update({ where: { id: ctx.company.id }, data: { logoFileId: null } });
    await tx.fileAsset.delete({ where: { id: logoFile.id } });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "Company",
        entityId: ctx.company.id,
        summary: `Removed the letterhead logo (${logoFile.fileName})`,
      },
      tx,
    );
    return logoFile;
  });
  if (removed) await deleteStoredFile(removed).catch(() => undefined);
  return { removed: removed !== null };
}

/** The company's current logo file (read now, not from the session's copy of the company). */
async function currentLogo(companyId: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { logoFile: { select: logoSelect } },
  });
  return company?.logoFile ?? null;
}

/** The logo image itself, for anyone in the company. */
export async function getCompanyLogo(ctx: CompanyContext) {
  const asset = await currentLogo(ctx.company.id);
  if (!asset) throw new AppError("NOT_FOUND", "This company has no letterhead logo yet.");
  return { fileName: asset.fileName, mimeType: asset.mimeType, bytes: await readStoredFile(asset) };
}

export type PrintLogo = { bytes: Buffer; checksum: string };

/**
 * The logo for a PDF, or null when there is none or its file is missing. The
 * bytes must still be the ones checked at upload (same checksum), so the PDF
 * writer never gets an image that was not checked.
 */
export async function loadPrintLogo(companyId: string): Promise<PrintLogo | null> {
  const asset = await currentLogo(companyId);
  if (!asset?.checksum) return null;
  const bytes = await readStoredFile(asset).catch(() => null);
  if (!bytes) return null;
  const checksum = createHash("sha256").update(bytes).digest("hex");
  return checksum === asset.checksum ? { bytes, checksum } : null;
}
