import { createHash } from "node:crypto";

import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
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
import { checkReferenceImage } from "@/modules/sales/reference-image.service";

/*
 * Pictures of materials for suppliers and the factory: the label artwork, the
 * button, a sketch of where a trim goes. They go on a style's "Materials per
 * piece" and on purchase order lines, and print on the tech pack and the
 * purchase orders. Checked like the quotation pictures (a JPG or PNG of at most
 * 512 KB and 2400 pixels a side, made about 150 KB in the browser first) and
 * kept under UPLOAD_DIR/<company>/material-images/.
 */

export const MATERIAL_IMAGE_FOLDER = "material-images";
const inFolder = (storagePath: string) => storagePath.includes(`/${MATERIAL_IMAGE_FOLDER}/`);

/** Saves a material picture for the active company and returns its file. */
export async function storeMaterialImage(
  ctx: CompanyContext,
  upload: { fileName: string; bytes: Buffer },
  meta?: RequestMeta,
) {
  const image = checkReferenceImage(upload.bytes);
  const stored = await writeGeneratedFile(
    ctx.company.id,
    MATERIAL_IMAGE_FOLDER,
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
      summary: `Uploaded material picture ${asset.fileName} (${Math.ceil(asset.sizeBytes / 1024)} KB)`,
    });
    return asset;
  } catch (error) {
    await deleteStoredFile(stored);
    throw error;
  }
}

/**
 * Material pictures a need or an order line may point to: the company's, in the
 * material pictures folder, uploaded by this person or already on a need or an
 * order line (a colleague's picture stays when someone else edits).
 */
export async function assertMaterialImages(
  ctx: CompanyContext,
  imageIds: Array<string | null | undefined>,
) {
  const ids = [...new Set(imageIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  const files = await prisma.fileAsset.findMany({
    where: { id: { in: ids }, companyId: ctx.company.id },
    select: {
      id: true,
      uploadedById: true,
      storagePath: true,
      _count: { select: { materialNeedImages: true, orderLineImages: true } },
    },
  });
  const usable = new Set(
    files
      .filter(
        (f) =>
          inFolder(f.storagePath) &&
          (f.uploadedById === ctx.user.id ||
            f._count.materialNeedImages + f._count.orderLineImages > 0),
      )
      .map((f) => f.id),
  );
  if (ids.some((id) => !usable.has(id))) {
    throw new AppError("NOT_FOUND", "A material picture was not found. Add it again.");
  }
}

/** Deletes material pictures nothing points to any more (bytes and record). */
export async function dropUnusedMaterialImages(db: Db, fileIds: Array<string | null>) {
  const ids = [...new Set(fileIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  const unused = { materialNeedImages: { none: {} }, orderLineImages: { none: {} } };
  const files = await db.fileAsset.findMany({
    where: { id: { in: ids }, ...unused },
    select: { id: true, storagePath: true },
  });
  for (const file of files.filter((f) => inFolder(f.storagePath))) {
    const { count } = await db.fileAsset.deleteMany({ where: { id: file.id, ...unused } });
    if (count > 0) await deleteStoredFile(file);
  }
}

/**
 * The pictures to print, by file id, read from disk. A picture whose bytes went
 * missing or changed since they were checked is left out (the row prints without it).
 */
export async function loadMaterialImages(
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
      .filter((f) => inFolder(f.storagePath) && f.checksum)
      .map(async (file) => {
        const bytes = await readStoredFile(file).catch(() => null);
        if (bytes && createHash("sha256").update(bytes).digest("hex") === file.checksum) {
          images.set(file.id, bytes);
        }
      }),
  );
  return images;
}
