import { Prisma } from "@prisma/client";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/request-meta";
import type { CompanyContext } from "@/modules/auth/context";
import {
  deleteStoredFile,
  MAX_UPLOAD_BYTES,
  readStoredFile,
  safeFileName,
  storeUpload,
  writeGeneratedFile,
} from "@/modules/files/file.service";
import { checkOption, DEFAULT_LIMIT, visualOnly } from "@/modules/production/colour-check";
import {
  checkDesign,
  type Design,
  type FileCheck,
  looksLikeDst,
  machineFileName,
  MACHINE_FORMATS,
  type MachineFormat,
  readDst,
  readExp,
  REFERENCE_STITCHES,
  svgToDesign,
  VectorError,
  writeDst,
  writeExp,
} from "@/modules/production/logo-files";
import {
  LIGHTS,
  LOGO_FABRICS,
  type LogoFabric,
  LOGO_SOURCE_LABELS,
} from "@/modules/production/tech-pack-labels";
import {
  assertCanChange,
  assertManage,
  assertView,
  loadTechPack,
  logTechPack,
} from "@/modules/production/tech-pack-spec.service";
import { runTransaction } from "@/lib/transaction";

/*
 * The files of a style's tech pack: references saved to it (Save to Tech
 * Pack: a photo or a link with a note, internal only, kept until a person
 * removes it), its logos and its colours.
 *
 * A logo's machine file comes, in this order, from the buyer's file, the
 * embroidery factory's puncher, or (last) a draft the tool makes from the
 * buyer's vector. DST and EXP files are read and checked (size, stitches,
 * colours, longest stitch, jumps); other machine formats are kept as they are.
 * No Wilcom EMB, and never a logo from a photo. Every logo then needs a
 * sew-out photo and the owner's tick (production.logo.approve); a ticked
 * logo's files are locked until the owner takes the tick back.
 *
 * A colour's master is the buyer's code; the dye mill's lab dips are judged
 * against the buyer's ΔE CMC(2:1) limit (colour-check.ts). Changes need
 * production.manage; everything is read with production.view.
 */

// ---------------------------------------------------------------- references

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters.`)
    .optional()
    .transform((v) => v || null);

export const referenceSchema = z.object({
  link: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => v || null)
    .refine(
      (v) => v === null || /^https?:\/\/\S+$/i.test(v),
      "Give the whole link, starting with https://.",
    ),
  note: optionalText(500),
  /** A photo shared from the phone (Save to Tech Pack), already stored by its sender. */
  sharedFileId: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || null),
});

/** How long a photo shared from the phone waits to be saved to a style. */
const SHARED_FILE_HOURS = 24;

/** A photo the same person shared from their phone in the last day. */
async function sharedFile(ctx: CompanyContext, fileId: string) {
  const file = await ctx.db.fileAsset.findFirst({
    where: {
      id: fileId,
      uploadedById: ctx.user.id,
      createdAt: { gte: new Date(Date.now() - SHARED_FILE_HOURS * 3_600_000) },
    },
    select: { id: true, mimeType: true },
  });
  if (!file || !file.mimeType.startsWith("image/")) {
    throw new AppError("VALIDATION", "The shared photo is no longer there. Share it again.", {
      file: ["The shared photo is no longer there. Share it again."],
    });
  }
  return file;
}

/** Saves a reference photo, link or both to a style's tech pack, with a short note. */
export async function addReference(
  ctx: CompanyContext,
  techPackId: string,
  raw: unknown,
  upload?: { fileName: string; bytes: Buffer } | null,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const input = referenceSchema.parse(raw);
  if (!input.link && !upload && !input.sharedFileId) {
    throw new AppError("VALIDATION", "Add a photo or a link to save.", {
      link: ["Add a photo or a link to save."],
    });
  }
  const tp = await loadTechPack(ctx, techPackId);
  assertCanChange(tp);
  const file = upload
    ? await storeUpload(ctx, upload, meta)
    : input.sharedFileId
      ? await sharedFile(ctx, input.sharedFileId)
      : null;
  const reference = await runTransaction(async (tx) => {
    const saved = await tx.techPackReference.create({
      data: {
        companyId: ctx.company.id,
        techPackId,
        fileId: file?.id ?? null,
        link: input.link,
        note: input.note,
        savedById: ctx.user.id,
      },
      select: { id: true },
    });
    await logTechPack(
      ctx,
      meta,
      tp,
      {
        action: "CREATE",
        summary: `${tp.code}: saved a reference to the tech pack${input.link ? ` (${input.link.slice(0, 80)})` : ""}`,
      },
      tx,
    );
    return saved;
  });
  return { id: reference.id, techPackId: tp.id, code: tp.code };
}

/** Takes a reference off the tech pack (its photo stays in the files). */
export async function removeReference(
  ctx: CompanyContext,
  techPackId: string,
  referenceId: string,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const tp = await loadTechPack(ctx, techPackId);
  const reference = await ctx.db.techPackReference.findFirst({
    where: { id: referenceId, techPackId: tp.id },
    select: { id: true, link: true },
  });
  if (!reference) throw new AppError("NOT_FOUND", "That reference is not on this tech pack.");
  await ctx.db.techPackReference.delete({ where: { id: reference.id } });
  await logTechPack(ctx, meta, tp, {
    action: "DELETE",
    summary: `${tp.code}: took a reference off the tech pack${reference.link ? ` (${reference.link.slice(0, 80)})` : ""}`,
  });
  return { id: reference.id };
}

// ---------------------------------------------------------------- logos

const optionalNumber = (max: number, integer = false) =>
  z
    .union([
      z.literal("").transform(() => null),
      z.null(),
      (integer ? z.coerce.number().int("Give a whole number.") : z.coerce.number())
        .positive("Give a number above 0.")
        .max(max, "That is too big."),
    ])
    .optional()
    .transform((v) => v ?? null);

export const logoSchema = z.object({
  name: z.string().trim().min(2, "Name the logo.").max(80),
  placement: optionalText(120),
  widthMm: optionalNumber(500),
  heightMm: optionalNumber(500),
  threads: optionalText(200),
  colours: optionalNumber(15, true),
  fabric: z
    .enum(Object.keys(LOGO_FABRICS) as [LogoFabric, ...LogoFabric[]])
    .nullish()
    .or(z.literal("").transform(() => null)),
  approvedStitches: optionalNumber(500_000, true),
  reference: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || v in REFERENCE_STITCHES, "Pick one of the public references."),
});

async function loadLogo(ctx: CompanyContext, techPackId: string, logoId: string) {
  const tp = await loadTechPack(ctx, techPackId);
  const logo = await ctx.db.techPackLogo.findFirst({
    where: { id: logoId, techPackId: tp.id },
  });
  if (!logo) throw new AppError("NOT_FOUND", "That logo is not on this tech pack.");
  return { tp, logo };
}

function assertNotTicked(logo: { name: string; tickedAt: Date | null }) {
  if (logo.tickedAt) {
    throw new AppError(
      "CONFLICT",
      `${logo.name} is ticked for bulk, so its files and spec are locked. The owner takes the tick back first.`,
    );
  }
}

/** Adds a logo to a style's tech pack, or changes its spec (not once it is ticked). */
export async function saveLogo(
  ctx: CompanyContext,
  techPackId: string,
  logoId: string | null,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const input = logoSchema.parse(raw);
  const tp = await loadTechPack(ctx, techPackId);
  assertCanChange(tp);
  const data = { ...input, fabric: input.fabric ?? null };
  const saved = await runTransaction(async (tx) => {
    let id: string;
    if (logoId) {
      const { logo } = await loadLogo(ctx, tp.id, logoId);
      assertNotTicked(logo);
      await tx.techPackLogo.update({ where: { id: logo.id }, data });
      id = logo.id;
    } else {
      id = (
        await tx.techPackLogo.create({
          data: { companyId: ctx.company.id, techPackId, ...data },
          select: { id: true },
        })
      ).id;
    }
    await logTechPack(
      ctx,
      meta,
      tp,
      {
        action: logoId ? "UPDATE" : "CREATE",
        summary: `${tp.code}: ${logoId ? "changed" : "added"} the logo ${input.name}`,
      },
      tx,
    );
    return id;
  });
  // A changed spec is checked again against the machine file already there.
  if (logoId) await recheckLogo(ctx, saved);
  return { id: saved };
}

export async function removeLogo(
  ctx: CompanyContext,
  techPackId: string,
  logoId: string,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const { tp, logo } = await loadLogo(ctx, techPackId, logoId);
  assertCanChange(tp);
  assertNotTicked(logo);
  await ctx.db.techPackLogo.delete({ where: { id: logo.id } });
  await logTechPack(ctx, meta, tp, {
    action: "DELETE",
    summary: `${tp.code}: took the logo ${logo.name} off the tech pack`,
  });
  return { id: logo.id };
}

export type LogoFileKind = "ARTWORK" | "MACHINE" | "SEW_OUT";

type Detected = { mimeType: string; ext: string; format?: MachineFormat; vector?: boolean };

const extOf = (name: string) => (name.split(".").pop() ?? "").toLowerCase();
const head = (bytes: Buffer, n: number) => bytes.toString("latin1", 0, n);

/** What a logo upload is: a machine file, the buyer's artwork, or a photo. */
export function detectLogoFile(kind: LogoFileKind, fileName: string, bytes: Buffer): Detected {
  const ext = extOf(fileName);
  if (ext === "emb") {
    throw new AppError(
      "VALIDATION",
      "Wilcom EMB is not used. Ask for a machine file (DST by default; PES, EXP, JEF or U01).",
    );
  }
  if (kind === "MACHINE") {
    if (looksLikeDst(new Uint8Array(bytes))) {
      return { mimeType: "application/octet-stream", ext: ".dst", format: "DST" };
    }
    const format = MACHINE_FORMATS.find((f) => f.toLowerCase() === ext);
    if (!format || format === "DST") {
      throw new AppError(
        "VALIDATION",
        "Upload the machine file: DST, PES, EXP, JEF, U01, TAP, DSB or DSZ.",
      );
    }
    if (format === "PES" && head(bytes, 4) !== "#PES") {
      throw new AppError("VALIDATION", "This is not a PES file.");
    }
    return { mimeType: "application/octet-stream", ext: `.${ext}`, format };
  }
  const text = head(bytes, 2048);
  if (kind === "ARTWORK") {
    if (/<svg[\s>]/i.test(bytes.toString("utf8", 0, Math.min(bytes.length, 65536)))) {
      return { mimeType: "image/svg+xml", ext: ".svg", vector: true };
    }
    if (text.startsWith("%PDF-")) {
      // An Illustrator file saved with PDF content opens as a PDF.
      return { mimeType: "application/pdf", ext: ext === "ai" ? ".ai" : ".pdf", vector: true };
    }
    if (text.startsWith("%!PS-Adobe")) {
      return {
        mimeType: "application/postscript",
        ext: ext === "ai" ? ".ai" : ".eps",
        vector: true,
      };
    }
  }
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = head(bytes, 4) === "\x89PNG";
  const isWebp = head(bytes, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP";
  if (isJpeg) return { mimeType: "image/jpeg", ext: ".jpg" };
  if (isPng) return { mimeType: "image/png", ext: ".png" };
  if (isWebp && kind === "SEW_OUT") return { mimeType: "image/webp", ext: ".webp" };
  throw new AppError(
    "VALIDATION",
    kind === "SEW_OUT"
      ? "Upload the sew-out photo (JPG, PNG or WebP)."
      : "Upload the buyer's artwork: a vector (SVG, AI, PDF or EPS), or a PNG or JPG picture.",
  );
}

async function storeLogoFile(
  ctx: CompanyContext,
  upload: { fileName: string; bytes: Buffer },
  type: Detected,
) {
  const stored = await writeGeneratedFile(ctx.company.id, "tech-packs", type.ext, upload.bytes);
  try {
    return await ctx.db.fileAsset.create({
      data: {
        companyId: ctx.company.id,
        uploadedById: ctx.user.id,
        fileName: safeFileName(upload.fileName),
        mimeType: type.mimeType,
        sizeBytes: stored.sizeBytes,
        storagePath: stored.storagePath,
        checksum: stored.checksum,
      },
      select: { id: true, fileName: true },
    });
  } catch (error) {
    await deleteStoredFile(stored);
    throw error;
  }
}

function readMachine(format: string | null, bytes: Buffer): Design | null {
  if (format === "DST") return readDst(new Uint8Array(bytes));
  if (format === "EXP") return readExp(new Uint8Array(bytes));
  return null;
}

type LogoSpec = {
  widthMm: Prisma.Decimal | null;
  heightMm: Prisma.Decimal | null;
  colours: number | null;
  approvedStitches: number | null;
  reference: string | null;
};

function checkAgainst(design: Design, logo: LogoSpec, source: string | null): FileCheck {
  const check = checkDesign(design, {
    widthMm: logo.widthMm ? Number(logo.widthMm) : null,
    heightMm: logo.heightMm ? Number(logo.heightMm) : null,
    colours: logo.colours,
    approvedStitches: logo.approvedStitches,
    reference: logo.reference,
  });
  if (source === "AI_FROM_VECTOR") {
    check.notes.push("A draft from the vector: the factory sews it out before the tick.");
    if (Math.min(check.widthMm, check.heightMm) < 5) {
      if (check.verdict === "PASS") check.verdict = "WARN";
      check.notes.push("Under about 5 mm, a draft is weak: the factory's puncher is needed.");
    }
  }
  return check;
}

/** Checks a logo's machine file again (after its spec changed). */
async function recheckLogo(ctx: CompanyContext, logoId: string) {
  const logo = await ctx.db.techPackLogo.findUnique({
    where: { id: logoId },
    include: { machineFile: true },
  });
  if (!logo?.machineFile) return;
  const design = readMachine(logo.machineFormat, await readStoredFile(logo.machineFile));
  if (!design) return;
  const check = checkAgainst(design, logo, logo.source);
  await ctx.db.techPackLogo.update({
    where: { id: logo.id },
    data: { fileCheck: check as unknown as Prisma.InputJsonValue },
  });
}

export const logoFileSchema = z.object({
  kind: z.enum(["ARTWORK", "MACHINE", "SEW_OUT"]),
  /** Where a machine file came from: the buyer, or the factory's puncher. */
  source: z.enum(["BUYER_FILE", "FACTORY_PUNCHER"]).optional(),
  note: optionalText(300),
});

/** The buyer's artwork, a machine file (from the buyer or the puncher) or the sew-out photo. */
export async function uploadLogoFile(
  ctx: CompanyContext,
  techPackId: string,
  logoId: string,
  raw: unknown,
  upload: { fileName: string; bytes: Buffer },
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const input = logoFileSchema.parse(raw);
  const { tp, logo } = await loadLogo(ctx, techPackId, logoId);
  assertCanChange(tp);
  assertNotTicked(logo);
  if (upload.bytes.length === 0) throw new AppError("VALIDATION", "The file is empty.");
  if (upload.bytes.length > MAX_UPLOAD_BYTES) {
    throw new AppError("VALIDATION", "Files can be up to 10 MB.");
  }
  const type = detectLogoFile(input.kind, upload.fileName, upload.bytes);
  let data: Prisma.TechPackLogoUncheckedUpdateInput;
  let check: FileCheck | null = null;
  if (input.kind === "MACHINE") {
    if (!input.source) {
      throw new AppError("VALIDATION", "Say where the file came from: the buyer or the puncher.", {
        source: ["Pick where the file came from."],
      });
    }
    let design: Design | null = null;
    try {
      design = readMachine(type.format!, upload.bytes);
    } catch {
      throw new AppError("VALIDATION", `The ${type.format} file could not be read.`);
    }
    check = design ? checkAgainst(design, logo, input.source) : null;
    const file = await storeLogoFile(ctx, upload, type);
    data = {
      machineFileId: file.id,
      machineFormat: type.format,
      source: input.source,
      fileCheck: (check as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull,
    };
  } else if (input.kind === "ARTWORK") {
    const file = await storeLogoFile(ctx, upload, type);
    data = { artworkFileId: file.id };
  } else {
    const file = await storeLogoFile(ctx, upload, type);
    data = { sewOutFileId: file.id, sewOutNote: input.note };
  }
  await ctx.db.techPackLogo.update({ where: { id: logo.id }, data });
  const what =
    input.kind === "MACHINE"
      ? `the ${type.format} file (${LOGO_SOURCE_LABELS[input.source!].toLowerCase()})${check ? `: ${check.verdict}` : ""}`
      : input.kind === "ARTWORK"
        ? "the buyer's artwork"
        : "the sew-out photo";
  await logTechPack(ctx, meta, tp, {
    action: "UPDATE",
    summary: `${tp.code}: added ${what} to the logo ${logo.name}`,
  });
  return { id: logo.id, check, picture: !type.vector && input.kind === "ARTWORK" };
}

/**
 * The last resort, when neither the buyer nor the factory's puncher has a
 * file: a draft DST from the buyer's vector (SVG), filled rows and running
 * stitch at the logo's width, one thread per colour. Never from a photo.
 */
export async function draftLogoFromVector(
  ctx: CompanyContext,
  techPackId: string,
  logoId: string,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const { tp, logo } = await loadLogo(ctx, techPackId, logoId);
  assertCanChange(tp);
  assertNotTicked(logo);
  if (logo.machineFileId && logo.source && logo.source !== "AI_FROM_VECTOR") {
    throw new AppError(
      "CONFLICT",
      `${logo.name} has ${LOGO_SOURCE_LABELS[logo.source].toLowerCase()}. A draft from the vector is only the last resort.`,
    );
  }
  if (!logo.widthMm) {
    throw new AppError("VALIDATION", "Give the logo's width in mm first.");
  }
  const artwork = logo.artworkFileId
    ? await ctx.db.fileAsset.findUnique({ where: { id: logo.artworkFileId } })
    : null;
  if (!artwork || artwork.mimeType !== "image/svg+xml") {
    throw new AppError(
      "CONFLICT",
      artwork
        ? "The draft is made from an SVG vector. Ask the buyer for the logo as SVG (a photo or JPG is never used)."
        : "Upload the buyer's vector (SVG) first.",
    );
  }
  let design: Design;
  try {
    design = svgToDesign((await readStoredFile(artwork)).toString("utf8"), Number(logo.widthMm));
  } catch (error) {
    if (error instanceof VectorError) throw new AppError("VALIDATION", error.message);
    throw error;
  }
  const name = machineFileName(logo.name, logo.fabric, 1);
  const bytes = Buffer.from(writeDst(design, name));
  const check = checkAgainst(design, logo, "AI_FROM_VECTOR");
  const file = await storeLogoFile(
    ctx,
    { fileName: `${name}.DST`, bytes },
    { mimeType: "application/octet-stream", ext: ".dst", format: "DST" },
  );
  await ctx.db.techPackLogo.update({
    where: { id: logo.id },
    data: {
      machineFileId: file.id,
      machineFormat: "DST",
      source: "AI_FROM_VECTOR",
      fileCheck: check as unknown as Prisma.InputJsonValue,
    },
  });
  await logTechPack(ctx, meta, tp, {
    action: "UPDATE",
    summary: `${tp.code}: drafted ${name}.DST for the logo ${logo.name} from the buyer's vector (${check.stitches} stitches, ${check.verdict})`,
  });
  return { id: logo.id, check };
}

/** The logo's machine file, as stored or turned into DST or EXP (one master, many files). */
export async function logoMachineFile(
  ctx: CompanyContext,
  techPackId: string,
  logoId: string,
  format: "DST" | "EXP" | null,
) {
  assertView(ctx);
  const { logo } = await loadLogo(ctx, techPackId, logoId);
  const file = logo.machineFileId
    ? await ctx.db.fileAsset.findUnique({ where: { id: logo.machineFileId } })
    : null;
  if (!file) throw new AppError("NOT_FOUND", `${logo.name} has no machine file yet.`);
  const bytes = await readStoredFile(file);
  const want = format ?? logo.machineFormat;
  if (!want || want === logo.machineFormat) {
    return { fileName: file.fileName, mimeType: "application/octet-stream", bytes };
  }
  const design = readMachine(logo.machineFormat, bytes);
  if (!design) {
    throw new AppError(
      "CONFLICT",
      `A ${logo.machineFormat} file is kept as it is; the factory's software converts it.`,
    );
  }
  const name = machineFileName(logo.name, logo.fabric, 1);
  return {
    fileName: `${name}.${want}`,
    mimeType: "application/octet-stream",
    bytes: Buffer.from(want === "DST" ? writeDst(design, name) : writeExp(design)),
  };
}

function assertTick(ctx: CompanyContext) {
  if (!ctx.can("production.logo.approve")) {
    throw new AppError(
      "FORBIDDEN",
      "Only the owner ticks a logo for bulk (production.logo.approve).",
    );
  }
}

/**
 * The owner's tick after the sew-out: the logo may go to bulk, and its files
 * are locked. It needs a machine file whose check did not fail and the sew-out
 * photo.
 */
export async function tickLogo(
  ctx: CompanyContext,
  techPackId: string,
  logoId: string,
  meta?: RequestMeta,
) {
  assertTick(ctx);
  const { tp, logo } = await loadLogo(ctx, techPackId, logoId);
  if (logo.tickedAt) return { id: logo.id };
  const check = logo.fileCheck as { verdict?: string } | null;
  const missing = [
    !logo.machineFileId && "its machine file",
    !logo.sewOutFileId && "the sew-out photo",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new AppError("CONFLICT", `${logo.name} needs ${missing.join(" and ")} before the tick.`);
  }
  if (check?.verdict === "FAIL") {
    throw new AppError(
      "CONFLICT",
      `${logo.name}'s file failed the check. Get a corrected file from the factory first.`,
    );
  }
  await ctx.db.techPackLogo.update({
    where: { id: logo.id },
    data: { tickedAt: new Date(), tickedById: ctx.user.id },
  });
  await logTechPack(ctx, meta, tp, {
    action: "STATUS_CHANGE",
    summary: `${tp.code}: ticked the logo ${logo.name} for bulk`,
  });
  return { id: logo.id };
}

export async function untickLogo(
  ctx: CompanyContext,
  techPackId: string,
  logoId: string,
  meta?: RequestMeta,
) {
  assertTick(ctx);
  const { tp, logo } = await loadLogo(ctx, techPackId, logoId);
  if (!logo.tickedAt) return { id: logo.id };
  await ctx.db.techPackLogo.update({
    where: { id: logo.id },
    data: { tickedAt: null, tickedById: null },
  });
  await logTechPack(ctx, meta, tp, {
    action: "STATUS_CHANGE",
    summary: `${tp.code}: took back the tick on the logo ${logo.name}`,
  });
  return { id: logo.id };
}

// ---------------------------------------------------------------- colours

export const colourSchema = z.object({
  name: z.string().trim().min(1, "Name the colour.").max(60),
  code: optionalText(40),
  deltaLimit: z
    .union([z.literal("").transform(() => DEFAULT_LIMIT), z.coerce.number()])
    .default(DEFAULT_LIMIT)
    .pipe(z.number().min(0.1, "The limit is at least 0.1.").max(5, "The limit is at most 5.")),
  primaryLight: z.enum(LIGHTS).default("D65"),
  secondaryLight: z
    .enum(LIGHTS)
    .nullish()
    .or(z.literal("").transform(() => null)),
});

async function loadColour(ctx: CompanyContext, techPackId: string, colourId: string) {
  const tp = await loadTechPack(ctx, techPackId);
  const colour = await ctx.db.techPackColour.findFirst({
    where: { id: colourId, techPackId: tp.id },
  });
  if (!colour) throw new AppError("NOT_FOUND", "That colour is not on this tech pack.");
  return { tp, colour };
}

/** Adds a colour with the buyer's code and limit, or changes it. */
export async function saveColour(
  ctx: CompanyContext,
  techPackId: string,
  colourId: string | null,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const input = colourSchema.parse(raw);
  const tp = await loadTechPack(ctx, techPackId);
  assertCanChange(tp);
  const data = {
    name: input.name,
    code: input.code,
    // A code typed in is the buyer's; the photo's estimate stays beside it.
    ...(input.code ? { codeSource: "BUYER" as const } : {}),
    deltaLimit: input.deltaLimit,
    primaryLight: input.primaryLight,
    secondaryLight: input.secondaryLight ?? null,
  };
  const id = await runTransaction(async (tx) => {
    let saved: string;
    if (colourId) {
      const { colour } = await loadColour(ctx, tp.id, colourId);
      // The approximate code from a photo stays approximate when saved unchanged.
      const keptApprox = colour.codeSource === "IMAGE_ESTIMATE" && input.code === colour.code;
      await tx.techPackColour.update({
        where: { id: colour.id },
        data: keptApprox ? { ...data, codeSource: "IMAGE_ESTIMATE" } : data,
      });
      saved = colour.id;
    } else {
      const taken = await tx.techPackColour.count({ where: { techPackId, name: input.name } });
      if (taken > 0) throw new AppError("CONFLICT", `${input.name} is on this tech pack already.`);
      saved = (
        await tx.techPackColour.create({
          data: { companyId: ctx.company.id, techPackId, ...data },
          select: { id: true },
        })
      ).id;
    }
    await logTechPack(
      ctx,
      meta,
      tp,
      {
        action: colourId ? "UPDATE" : "CREATE",
        summary: `${tp.code}: ${colourId ? "changed" : "added"} the colour ${input.name}${input.code ? ` (${input.code})` : ""}, limit ΔE ${input.deltaLimit.toFixed(2)}`,
      },
      tx,
    );
    return saved;
  });
  return { id };
}

export async function removeColour(
  ctx: CompanyContext,
  techPackId: string,
  colourId: string,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const { tp, colour } = await loadColour(ctx, techPackId, colourId);
  assertCanChange(tp);
  await ctx.db.techPackColour.delete({ where: { id: colour.id } });
  await logTechPack(ctx, meta, tp, {
    action: "DELETE",
    summary: `${tp.code}: took the colour ${colour.name} off the tech pack`,
  });
  return { id: colour.id };
}

const delta = z
  .union([z.literal("").transform(() => null), z.null(), z.coerce.number().min(-20).max(20)])
  .optional()
  .transform((v) => v ?? null);

export const labDipsSchema = z.object({
  round: z.coerce.number().int().min(1).max(20),
  /** Read from the mill's report by the AI, then checked by the person saving them. */
  readByAi: z.boolean().default(false),
  options: z
    .array(
      z.object({
        letter: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{1,2}$/, "Use the mill's option letter (A to L)."),
        deltaE: z.coerce
          .number({ message: "Give the ΔE CMC from the mill's report." })
          .min(0)
          .max(50),
        dl: delta,
        dc: delta,
        dh: delta,
        mi: z
          .union([z.literal("").transform(() => null), z.null(), z.coerce.number().min(0).max(20)])
          .optional()
          .transform((v) => v ?? null),
        light: z
          .enum(LIGHTS)
          .nullish()
          .or(z.literal("").transform(() => null)),
      }),
    )
    .min(1, "Add the mill's options.")
    .max(12)
    .refine(
      (options) => new Set(options.map((o) => o.letter)).size === options.length,
      "An option letter is given twice.",
    ),
});

/** A round of the mill's lab dip options with their measured report. */
export async function addLabDips(
  ctx: CompanyContext,
  techPackId: string,
  colourId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const input = labDipsSchema.parse(raw);
  const { tp, colour } = await loadColour(ctx, techPackId, colourId);
  assertCanChange(tp);
  const taken = await ctx.db.labDipOption.findMany({
    where: {
      colourId: colour.id,
      round: input.round,
      letter: { in: input.options.map((o) => o.letter) },
    },
    select: { letter: true },
  });
  if (taken.length > 0) {
    throw new AppError(
      "CONFLICT",
      `Round ${input.round} has option ${taken.map((t) => t.letter).join(", ")} already.`,
    );
  }
  await ctx.db.labDipOption.createMany({
    data: input.options.map((o) => ({
      companyId: ctx.company.id,
      colourId: colour.id,
      round: input.round,
      ...o,
      readByAi: input.readByAi,
    })),
  });
  const limit = Number(colour.deltaLimit);
  const passing = input.options.filter((o) => checkOption(o, limit).verdict === "PASS");
  await logTechPack(ctx, meta, tp, {
    action: "UPDATE",
    summary: `${tp.code}: ${colour.name} lab dips, round ${input.round}: ${input.options.length} option(s), ${passing.length} within ΔE ${limit.toFixed(2)}${input.readByAi ? " (read by AI, checked by a person)" : ""}`,
  });
  return { id: colour.id, passing: passing.map((o) => o.letter) };
}

export async function removeLabDip(
  ctx: CompanyContext,
  techPackId: string,
  optionId: string,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const tp = await loadTechPack(ctx, techPackId);
  const option = await ctx.db.labDipOption.findFirst({
    where: { id: optionId, colour: { techPackId: tp.id } },
    include: { colour: { select: { name: true } } },
  });
  if (!option) throw new AppError("NOT_FOUND", "That lab dip is not on this tech pack.");
  await ctx.db.labDipOption.delete({ where: { id: option.id } });
  await logTechPack(ctx, meta, tp, {
    action: "DELETE",
    summary: `${tp.code}: took lab dip ${option.letter} (round ${option.round}) off ${option.colour.name}`,
  });
  return { id: option.id };
}

export const labDipStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("OPEN") }),
  z.object({ status: z.literal("BEST_CAN_DO") }),
  /** No option for a colour approved by eye (heather, white, neon, French terry). */
  z.object({ status: z.literal("BUYER_APPROVED"), optionId: z.string().optional() }),
]);

/**
 * What came back from the buyer: the option they approved (bulk dyeing may
 * start), or the mill's best can do after two rounds without a match.
 */
export async function setLabDipStatus(
  ctx: CompanyContext,
  techPackId: string,
  colourId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const input = labDipStatusSchema.parse(raw);
  const { tp, colour } = await loadColour(ctx, techPackId, colourId);
  let approvedOption: string | null = null;
  if (input.status === "BUYER_APPROVED" && !input.optionId) {
    if (!visualOnly(colour.name)) {
      throw new AppError("VALIDATION", "Pick the option the buyer approved.", {
        optionId: ["Pick the option the buyer approved."],
      });
    }
    approvedOption = "by eye";
  } else if (input.status === "BUYER_APPROVED") {
    const option = await ctx.db.labDipOption.findFirst({
      where: { id: input.optionId, colourId: colour.id },
    });
    if (!option) throw new AppError("NOT_FOUND", "That lab dip is not on this colour.");
    approvedOption = `${option.letter}, round ${option.round}`;
  }
  await ctx.db.techPackColour.update({
    where: { id: colour.id },
    data: { status: input.status, approvedOption },
  });
  await logTechPack(ctx, meta, tp, {
    action: "STATUS_CHANGE",
    summary:
      input.status === "BUYER_APPROVED"
        ? `${tp.code}: the buyer approved ${colour.name} lab dip ${approvedOption}`
        : input.status === "BEST_CAN_DO"
          ? `${tp.code}: ${colour.name} goes ahead as the mill's best can do`
          : `${tp.code}: ${colour.name} lab dips are open again`,
  });
  return { id: colour.id };
}

/** The mill's lab dip report, kept on the colour (the AI may read it). */
export async function attachLabDipReport(
  ctx: CompanyContext,
  techPackId: string,
  colourId: string,
  upload: { fileName: string; bytes: Buffer },
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const { tp, colour } = await loadColour(ctx, techPackId, colourId);
  const file = await storeUpload(ctx, upload, meta);
  await ctx.db.techPackColour.update({
    where: { id: colour.id },
    data: { reportFileId: file.id },
  });
  return { id: colour.id, fileId: file.id, techPackId: tp.id };
}
