import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import {
  deleteStoredFile,
  detectFileType,
  safeFileName,
  writeGeneratedFile,
} from "@/modules/files/file.service";
import { assertCanRecordReceipts } from "@/modules/sales/payment.service";
import { attachProofSchema } from "@/modules/sales/schemas";

/*
 * Proof of a payment: a photo of a transfer screenshot or of the cheque. The
 * browser shrinks the photo to about 100 KB (WebP, or JPG where WebP cannot be
 * made) before it is sent, so the server keeps small files only: anything over
 * MAX_PROOF_BYTES is refused. Proofs live under UPLOAD_DIR/<company>/payment-proofs/.
 * A proof uploaded but never attached (the payment then failed) is deleted by
 * the nightly housekeeping a day later, and a replaced proof is deleted at once.
 */

export const PROOF_FOLDER = "payment-proofs";
/** Far above the ~100 KB the browser aims for, far below the 10 MB of other uploads. */
export const MAX_PROOF_BYTES = 512 * 1024;
const PROOF_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const inProofFolder = (storagePath: string) => storagePath.includes(`/${PROOF_FOLDER}/`);

/** Saves a proof photo for the active company (Accounts) and returns its file. */
export async function storePaymentProof(
  ctx: CompanyContext,
  upload: { fileName: string; bytes: Buffer },
  meta?: RequestMeta,
) {
  assertCanRecordReceipts(ctx);
  const { bytes } = upload;
  if (bytes.length === 0) throw new AppError("VALIDATION", "The photo is empty.");
  if (bytes.length > MAX_PROOF_BYTES) {
    throw new AppError(
      "VALIDATION",
      "The photo is too large. It is made smaller before sending; try again, or use a smaller photo.",
    );
  }
  const type = detectFileType(bytes);
  if (!type || !PROOF_TYPES.has(type.mimeType)) {
    throw new AppError("VALIDATION", "Add a photo (JPG, PNG or WebP) as the proof.");
  }
  const stored = await writeGeneratedFile(ctx.company.id, PROOF_FOLDER, type.ext, bytes);
  try {
    const asset = await ctx.db.fileAsset.create({
      data: {
        companyId: ctx.company.id,
        uploadedById: ctx.user.id,
        fileName: safeFileName(upload.fileName),
        mimeType: type.mimeType,
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
      summary: `Uploaded payment proof ${asset.fileName} (${Math.ceil(asset.sizeBytes / 1024)} KB)`,
    });
    return asset;
  } catch (error) {
    await deleteStoredFile(stored);
    throw error;
  }
}

/** A proof photo the person uploaded, ready to attach; refuses any other file. */
export async function assertProofFile(ctx: CompanyContext, db: Db, fileId: string) {
  const file = await db.fileAsset.findFirst({
    where: { id: fileId, companyId: ctx.company.id },
    select: { id: true, uploadedById: true, storagePath: true, mimeType: true },
  });
  if (
    !file ||
    !inProofFolder(file.storagePath) ||
    !PROOF_TYPES.has(file.mimeType) ||
    file.uploadedById !== ctx.user.id
  ) {
    throw new AppError("NOT_FOUND", "Proof photo not found. Add it again.", {
      proofFileId: ["Add the photo again"],
    });
  }
  return file.id;
}

/** Deletes a proof photo nothing points to any more (bytes and record). */
async function dropIfUnused(db: Db, fileId: string | null) {
  if (!fileId) return;
  const file = await db.fileAsset.findUnique({
    where: { id: fileId },
    select: {
      id: true,
      storagePath: true,
      _count: { select: { paymentProofs: true, chequeProofs: true } },
    },
  });
  if (!file || !inProofFolder(file.storagePath)) return;
  if (file._count.paymentProofs + file._count.chequeProofs > 0) return;
  await db.fileAsset.delete({ where: { id: file.id } });
  await deleteStoredFile(file);
}

/** Adds (or replaces) the proof photo of a money receipt. */
export async function attachPaymentProof(
  ctx: CompanyContext,
  paymentId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanRecordReceipts(ctx);
  const { fileId } = attachProofSchema.parse(raw);
  const payment = await ctx.db.payment.findFirst({
    where: { id: paymentId, direction: "RECEIVED" },
    select: { id: true, number: true, proofFileId: true },
  });
  if (!payment) throw new AppError("NOT_FOUND", "Payment not found.");
  await assertProofFile(ctx, prisma, fileId);
  await ctx.db.payment.update({ where: { id: payment.id }, data: { proofFileId: fileId } });
  if (payment.proofFileId !== fileId) await dropIfUnused(prisma, payment.proofFileId);
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "Payment",
    entityId: payment.id,
    summary: `${payment.proofFileId ? "Replaced" : "Added"} the proof photo of ${payment.number}`,
  });
  return { paymentId: payment.id, proofFileId: fileId };
}

/** Adds (or replaces) the photo of a cheque; a cleared cheque's receipt gets it too. */
export async function attachChequeProof(
  ctx: CompanyContext,
  chequeId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanRecordReceipts(ctx);
  const { fileId } = attachProofSchema.parse(raw);
  const cheque = await ctx.db.cheque.findUnique({
    where: { id: chequeId },
    select: { id: true, chequeNo: true, proofFileId: true, paymentId: true },
  });
  if (!cheque) throw new AppError("NOT_FOUND", "Cheque not found.");
  await assertProofFile(ctx, prisma, fileId);
  const before = cheque.proofFileId;
  await prisma.$transaction(async (tx) => {
    await tx.cheque.update({ where: { id: cheque.id }, data: { proofFileId: fileId } });
    if (cheque.paymentId) {
      await tx.payment.update({ where: { id: cheque.paymentId }, data: { proofFileId: fileId } });
    }
  });
  if (before !== fileId) await dropIfUnused(prisma, before);
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "Cheque",
    entityId: cheque.id,
    summary: `${before ? "Replaced" : "Added"} the photo of cheque ${cheque.chequeNo}`,
  });
  return { chequeId: cheque.id, proofFileId: fileId };
}

/**
 * Nightly: deletes proof photos uploaded more than a day ago that no payment
 * or cheque uses (the payment they were for was never recorded).
 */
export async function purgeUnusedProofs(now: Date = new Date()) {
  const before = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const unused = await prisma.fileAsset.findMany({
    where: {
      storagePath: { contains: `/${PROOF_FOLDER}/` },
      createdAt: { lt: before },
      paymentProofs: { none: {} },
      chequeProofs: { none: {} },
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
