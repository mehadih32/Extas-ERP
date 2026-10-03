import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { AppError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";

/*
 * Uploaded files (packing-list photos, bill scans). Bytes live on disk under
 * UPLOAD_DIR/<companyId>/<year>/<month>/<random name>; the FileAsset row keeps
 * the original name, the type detected from the bytes and a SHA-256 checksum.
 * Files the app makes itself (saved reports, printed documents) go under
 * UPLOAD_DIR/<companyId>/<reports|documents>/<year>/<month>/, have no uploader and
 * open through their own record; the letterhead logo goes under logos/.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const FILE_TYPES = [
  {
    mimeType: "image/jpeg",
    ext: ".jpg",
    matches: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mimeType: "image/png",
    ext: ".png",
    matches: (b: Buffer) =>
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mimeType: "image/webp",
    ext: ".webp",
    matches: (b: Buffer) =>
      b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP",
  },
  {
    mimeType: "application/pdf",
    ext: ".pdf",
    matches: (b: Buffer) => b.toString("ascii", 0, 5) === "%PDF-",
  },
] as const;

/** JPG, PNG, WebP or PDF, judged by the file's first bytes (not its name). */
export function detectFileType(bytes: Buffer): { mimeType: string; ext: string } | null {
  const type = FILE_TYPES.find((t) => t.matches(bytes));
  return type ? { mimeType: type.mimeType, ext: type.ext } : null;
}

/** Keeps a readable original name without folders or control characters. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|*?:]/g, "").trim();
  return cleaned.slice(-120) || "upload";
}

/**
 * Read at call time so tests (and a changed .env) can point it elsewhere. A folder
 * on the server, not part of the app: the build is told not to bundle it.
 */
export function uploadRoot(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR || "./storage/uploads");
}

function absolutePath(storagePath: string): string {
  const root = uploadRoot();
  const full = path.resolve(root, storagePath);
  if (!full.startsWith(root + path.sep)) throw new AppError("NOT_FOUND", "File not found.");
  return full;
}

/** The `file` field of a multipart form (route handlers and Server Actions). */
export async function fileFromForm(form: FormData): Promise<{ fileName: string; bytes: Buffer }> {
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new AppError("VALIDATION", 'Attach the file in a form field named "file".');
  }
  if (file.size > MAX_UPLOAD_BYTES) throw new AppError("VALIDATION", "Files can be up to 10 MB.");
  return { fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()) };
}

/** Reads a multipart request without accepting oversized bodies. */
export async function fileFromRequest(request: Request) {
  return fileFromForm(await formFromRequest(request));
}

/** A multipart request's form (the file and any other fields), refusing oversized bodies. */
export async function formFromRequest(request: Request): Promise<FormData> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES + 1024 * 1024) {
    throw new AppError("VALIDATION", "Files can be up to 10 MB.");
  }
  try {
    return await request.formData();
  } catch {
    throw new AppError("VALIDATION", "Send the file as multipart/form-data.");
  }
}

/** The text fields of a form (everything but files). */
export function formFields(form: FormData): Record<string, string> {
  const fields: Record<string, string> = {};
  form.forEach((value, key) => {
    if (typeof value === "string") fields[key] = value;
  });
  return fields;
}

function datedPath(companyId: string, folders: string[], ext: string): string {
  const now = new Date();
  return path.posix.join(
    companyId,
    ...folders,
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    `${randomUUID()}${ext}`,
  );
}

async function writeNew(storagePath: string, bytes: Buffer): Promise<void> {
  const full = absolutePath(storagePath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes, { flag: "wx" });
}

/** Saves an upload for the active company and returns its FileAsset. */
export async function storeUpload(
  ctx: CompanyContext,
  upload: { fileName: string; bytes: Buffer },
  meta?: RequestMeta,
) {
  const { bytes } = upload;
  if (bytes.length === 0) throw new AppError("VALIDATION", "The file is empty.");
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new AppError("VALIDATION", "Files can be up to 10 MB.");
  }
  const type = detectFileType(bytes);
  if (!type) throw new AppError("VALIDATION", "Upload a photo (JPG, PNG or WebP) or a PDF.");

  const storagePath = datedPath(ctx.company.id, [], type.ext);
  await writeNew(storagePath, bytes);

  const asset = await ctx.db.fileAsset.create({
    data: {
      companyId: ctx.company.id,
      uploadedById: ctx.user.id,
      fileName: safeFileName(upload.fileName),
      mimeType: type.mimeType,
      sizeBytes: bytes.length,
      storagePath,
      checksum: createHash("sha256").update(bytes).digest("hex"),
    },
    select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
  });
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "FileAsset",
    entityId: asset.id,
    summary: `Uploaded ${asset.fileName} (${Math.ceil(asset.sizeBytes / 1024)} KB)`,
  });
  return asset;
}

/**
 * Saves a file the app made or checked itself (a report, a printed document, the
 * logo) under UPLOAD_DIR/<companyId>/<folder>/...
 * The caller records the FileAsset with these details, and removes the bytes
 * again with deleteStoredFile when that fails.
 */
export async function writeGeneratedFile(
  companyId: string,
  folder: string,
  ext: string,
  bytes: Buffer,
) {
  const storagePath = datedPath(companyId, [folder], ext);
  await writeNew(storagePath, bytes);
  return {
    storagePath,
    sizeBytes: bytes.length,
    checksum: createHash("sha256").update(bytes).digest("hex"),
  };
}

/** Whether a stored file's bytes are still on disk. */
export async function storedFileExists(asset: { storagePath: string }): Promise<boolean> {
  try {
    await access(absolutePath(asset.storagePath));
    return true;
  } catch {
    return false;
  }
}

/** Removes a stored file's bytes (already gone is fine). */
export async function deleteStoredFile(asset: { storagePath: string }): Promise<void> {
  await rm(absolutePath(asset.storagePath), { force: true });
}

export async function readStoredFile(asset: { storagePath: string }): Promise<Buffer> {
  try {
    return await readFile(absolutePath(asset.storagePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new AppError("NOT_FOUND", "The file is missing from storage.");
    }
    throw error;
  }
}

/**
 * A file for download. Allowed for its uploader and for roles that may see the
 * record it belongs to (a delivery's packing list, a supplier bill's scan, a
 * licence scan, a document template). Saved reports download through the Report
 * Builder, which checks their figures.
 */
export async function getFileForDownload(ctx: CompanyContext, fileId: string) {
  const asset = await ctx.db.fileAsset.findUnique({
    where: { id: fileId },
    include: {
      stockIntakes: { select: { id: true }, take: 1 },
      supplierBills: { select: { id: true }, take: 1 },
      complianceDocuments: { select: { id: true }, take: 1 },
      templates: { select: { id: true }, take: 1 },
    },
  });
  if (!asset) throw new AppError("NOT_FOUND", "File not found.");
  const allowed =
    asset.uploadedById === ctx.user.id ||
    (asset.stockIntakes.length > 0 &&
      (ctx.can("production.view") || ctx.can("production.stock_intake"))) ||
    (asset.supplierBills.length > 0 &&
      (ctx.can("production.manage") || ctx.can("accounts.view"))) ||
    (asset.complianceDocuments.length > 0 &&
      (ctx.can("compliance.view") || ctx.can("compliance.manage"))) ||
    (asset.templates.length > 0 && ctx.can("templates.manage"));
  if (!allowed) throw new AppError("FORBIDDEN", "You do not have permission to open this file.");
  return {
    asset: {
      id: asset.id,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
    },
    bytes: await readStoredFile(asset),
  };
}
