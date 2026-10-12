import { createHash } from "node:crypto";

import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { ImageCheckError, type ImageInfo, type ImageLimits, inspectImage } from "@/lib/images";
import { pdfImageSize } from "@/lib/pdf";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import {
  deleteStoredFile,
  readStoredFile,
  safeFileName,
  writeGeneratedFile,
} from "@/modules/files/file.service";

/*
 * Reference pictures of quotation items (a sketch, a sample photo, the buyer's
 * tech pack image), printed beside the item on the quotation and proforma PDFs.
 * The browser redraws the photo as a JPG of about 150 KB first, so the server
 * keeps small files only. The PDF writer trusts the images it draws, so each one
 * is checked down to its pixel rows like the logo (lib/images.ts): a PNG or JPG
 * of at most 512 KB and 2400 pixels a side. They live under
 * UPLOAD_DIR/<company>/quotation-images/. A picture no item uses (removed, or the
 * quotation was never saved) is deleted at once when an edit drops it, or by the
 * nightly housekeeping a day after it was uploaded.
 */

export const REFERENCE_FOLDER = "quotation-images";
/** Far above the ~150 KB the browser aims for. */
export const MAX_REFERENCE_BYTES = 512 * 1024;
export const REFERENCE_LIMITS: ImageLimits = { maxSide: 2400, maxPixels: 4_000_000 };
const inReferenceFolder = (storagePath: string) => storagePath.includes(`/${REFERENCE_FOLDER}/`);

/** The picture's type and size, or a VALIDATION error saying what is wrong with it. */
export function checkReferenceImage(bytes: Buffer): ImageInfo {
  if (bytes.length === 0) throw new AppError("VALIDATION", "The picture is empty.");
  if (bytes.length > MAX_REFERENCE_BYTES) {
    throw new AppError(
      "VALIDATION",
      "The picture is too large. It is made smaller before sending; try again, or use a smaller picture.",
    );
  }
  let image: ImageInfo;
  try {
    image = inspectImage(bytes, REFERENCE_LIMITS);
  } catch (error) {
    if (error instanceof ImageCheckError) throw new AppError("VALIDATION", error.message);
    throw error;
  }
  // The PDF writer must read it the same way, or it could not draw it.
  const seen = pdfImageSize(bytes);
  if (!seen || seen.width !== image.width || seen.height !== image.height) {
    throw new AppError("VALIDATION", "This picture cannot be printed; use a JPG or PNG.");
  }
  return image;
}

/** Saves a reference picture for the active company (sales.quotation.manage) and returns its file. */
export async function storeReferenceImage(
  ctx: CompanyContext,
  upload: { fileName: string; bytes: Buffer },
  meta?: RequestMeta,
) {
  const image = checkReferenceImage(upload.bytes);
  const stored = await writeGeneratedFile(
    ctx.company.id,
    REFERENCE_FOLDER,
    image.ext,
    upload.bytes,
  );
  try {
    const asset = await ctx.db.fileAsset.create({
      data: {
        companyId: ctx.company.id,
        uploadedById: ctx.user.id,
        fileName: safeFileName(upload.fileName),
        mimeType: image.mimeType,
        sizeBytes: stored.sizeBytes,
        storagePath: stored.storagePath,
        checksum: stored.checksum,
      },
      select: { id: true, fileName: true, mimeType: true, sizeBytes: true },
    });
    await auditInCompany(ctx, meta, {
      action: "CREATE",
      entityType: "FileAsset",
      entityId: asset.id,
      summary: `Uploaded reference picture ${asset.fileName} (${Math.ceil(asset.sizeBytes / 1024)} KB)`,
    });
    return asset;
  } catch (error) {
    await deleteStoredFile(stored);
    throw error;
  }
}

/**
 * Reference pictures an item may point to: uploaded by this person, or already on
 * this quotation (a colleague's picture stays when someone else edits it).
 */
export async function assertReferenceImages(
  ctx: CompanyContext,
  imageIds: string[],
  quotationId?: string,
) {
  const ids = [...new Set(imageIds)];
  if (ids.length === 0) return;
  const files = await prisma.fileAsset.findMany({
    where: { id: { in: ids }, companyId: ctx.company.id },
    select: {
      id: true,
      uploadedById: true,
      storagePath: true,
      quotationImages: quotationId
        ? { where: { quotationId }, select: { id: true }, take: 1 }
        : false,
    },
  });
  const usable = new Set(
    files
      .filter(
        (f) =>
          inReferenceFolder(f.storagePath) &&
          (f.uploadedById === ctx.user.id || (f.quotationImages?.length ?? 0) > 0),
      )
      .map((f) => f.id),
  );
  if (ids.some((id) => !usable.has(id))) {
    throw new AppError("NOT_FOUND", "A reference picture was not found. Add it again.");
  }
}

/** Deletes reference pictures nothing points to any more (bytes and record). */
export async function dropUnusedReferenceImages(db: Db, fileIds: Array<string | null>) {
  const ids = [...new Set(fileIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  const unused = await db.fileAsset.findMany({
    where: { id: { in: ids }, quotationImages: { none: {} } },
    select: { id: true, storagePath: true },
  });
  for (const file of unused.filter((f) => inReferenceFolder(f.storagePath))) {
    // Checked again as it is deleted: an item may have taken it up meanwhile.
    const { count } = await db.fileAsset.deleteMany({
      where: { id: file.id, quotationImages: { none: {} } },
    });
    if (count > 0) await deleteStoredFile(file);
  }
}

/**
 * The pictures to print, by file id, read from disk. A picture whose bytes went
 * missing or changed since they were checked is left out (the row prints without it).
 */
export async function loadReferenceImages(
  companyId: string,
  fileIds: Array<string | null | undefined>,
): Promise<Map<string, Buffer>> {
  const ids = [...new Set(fileIds.filter((id): id is string => Boolean(id)))];
  const images = new Map<string, Buffer>();
  if (ids.length === 0) return images;
  const files = await prisma.fileAsset.findMany({
    where: { id: { in: ids }, companyId },
    select: { id: true, storagePath: true, checksum: true },
  });
  await Promise.all(
    files
      .filter((f) => inReferenceFolder(f.storagePath) && f.checksum)
      .map(async (file) => {
        const bytes = await readStoredFile(file).catch(() => null);
        if (!bytes) return;
        if (createHash("sha256").update(bytes).digest("hex") === file.checksum) {
          images.set(file.id, bytes);
        }
      }),
  );
  return images;
}

/**
 * Nightly: deletes reference pictures uploaded more than a day ago that no
 * quotation item uses (the quotation was never saved, or the item went).
 */
export async function purgeUnusedReferenceImages(now: Date = new Date()) {
  const before = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const unused = await prisma.fileAsset.findMany({
    where: {
      storagePath: { contains: `/${REFERENCE_FOLDER}/` },
      createdAt: { lt: before },
      quotationImages: { none: {} },
    },
    select: { id: true, storagePath: true },
    take: 500,
  });
  for (const file of unused) {
    await prisma.fileAsset.delete({ where: { id: file.id } });
    await deleteStoredFile(file);
  }
  return unused.length;
}
