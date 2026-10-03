import { createHash } from "node:crypto";

import { Prisma, type TemplateFormat } from "@prisma/client";

import { AppError } from "@/lib/errors";
import { PDF_MIME } from "@/lib/pdf";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { documentFileName } from "@/modules/documents/model";
import {
  assertMayPrint,
  documentInclude,
  type DocumentRow,
  PRINT_INFO,
  PRINT_PER_MINUTE,
  presentDocument,
  type PrintedDocument,
} from "@/modules/documents/print.service";
import {
  deleteStoredFile,
  MAX_UPLOAD_BYTES,
  readStoredFile,
  safeFileName,
  storedFileExists,
  writeGeneratedFile,
} from "@/modules/files/file.service";
import { templateData } from "@/modules/templates/data";
import { DOCX_MIME, docxTags, fillDocx, isZip, TemplateFileError } from "@/modules/templates/docx";
import { checkHtml, decodeHtml, fillHtml, HTML_MIME, htmlTags } from "@/modules/templates/html";
import {
  fillImageTemplate,
  fillPdfTemplate,
  type PageSize,
  type Placement,
  readImageTemplate,
  readPdfTemplate,
} from "@/modules/templates/overlay";
import { makeResolver, type TagMapping } from "@/modules/templates/resolve";
import {
  createHtmlTemplateSchema,
  fillTemplateSchema,
  listTemplatesSchema,
  placeholdersSchema,
  updateTemplateSchema,
  uploadTemplateSchema,
} from "@/modules/templates/schemas";
import {
  catalogFor,
  defaultPath,
  isItemPath,
  isTemplateType,
  parseTagInput,
  pathsFor,
  TAG_CATALOG,
  tagLabel,
  TEMPLATE_TYPES,
  type TemplateType,
} from "@/modules/templates/tags";

/*
 * Custom document templates (blueprint section 7): a company's own quotation,
 * invoice, challan or letter design, uploaded as a Word file (.docx), an HTML
 * page, a PDF or a scanned image, with tags like {BuyerName} where the data
 * goes. On upload the file is checked and read: the tags in a Word or HTML
 * template are found and matched to the data they stand for (tags.ts); tags
 * the system does not know are kept unmapped until someone maps them (or
 * they print empty). PDF and image templates have no tags in them: their tags
 * are placed on the page (overlay.ts).
 *
 * Filling a template with a quotation, proforma, invoice, challan or (for a
 * letter) a buyer makes a .docx, .html or .pdf that is kept with the printed
 * documents and downloads from there. As with printing, filling unchanged data
 * again returns the kept copy.
 *
 *   templates.manage            upload, map, change and delete templates
 *   the document's print right  see active templates of that type and fill them
 *                               (sales.view, or documents.letterhead for letters)
 */

/** Bump when filling changes, so documents filled again get the new output. */
const FILL_VERSION = 1;
const MAX_TAGS = 300;

const FORMAT_LABEL: Record<TemplateFormat, string> = {
  WORD: "Word",
  HTML: "HTML",
  PDF: "PDF",
  IMAGE: "image",
};

const templateInclude = {
  file: {
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      storagePath: true,
      checksum: true,
    },
  },
  placeholders: { orderBy: [{ page: { sort: "asc", nulls: "first" } }, { tag: "asc" }] },
} satisfies Prisma.DocumentTemplateInclude;

type TemplateRow = Prisma.DocumentTemplateGetPayload<{ include: typeof templateInclude }>;
type PlaceholderRow = TemplateRow["placeholders"][number];

const isOverlay = (format: TemplateFormat) => format === "PDF" || format === "IMAGE";

const tagNameOf = (tag: string) => parseTagInput(tag) ?? tag.replace(/[{}\s]/g, "");

/** Unplaced tags first, then page by page, then by name: the same on every database. */
function inOrder(placeholders: PlaceholderRow[]): PlaceholderRow[] {
  const key = (p: PlaceholderRow) => tagNameOf(p.tag);
  return [...placeholders].sort(
    (a, b) => (a.page ?? 0) - (b.page ?? 0) || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0),
  );
}

function pagesOf(template: { pageSizes: Prisma.JsonValue }): PageSize[] {
  return Array.isArray(template.pageSizes) ? (template.pageSizes as PageSize[]) : [];
}

const LABEL_BY_PATH = new Map(TAG_CATALOG.map((e) => [e.path, e.label]));

function presentPlaceholder(p: PlaceholderRow, format: TemplateFormat) {
  return {
    id: p.id,
    tag: p.tag,
    sourcePath: p.sourcePath,
    /** What it prints ("Buyer name"); null when it is not mapped (it prints nothing). */
    label: p.sourcePath ? (LABEL_BY_PATH.get(p.sourcePath) ?? null) : null,
    /** Repeats per line of the document. */
    item: isItemPath(p.sourcePath),
    format: p.format,
    ...(isOverlay(format)
      ? {
          page: p.page,
          x: p.pageX === null ? null : Number(p.pageX),
          y: p.pageY === null ? null : Number(p.pageY),
          fontSize: p.fontSize ?? 10,
          bold: p.bold,
          align: p.align ?? "left",
          width: p.width === null ? null : Number(p.width),
        }
      : {}),
  };
}

function present(t: TemplateRow) {
  const type = t.documentType as TemplateType;
  return {
    id: t.id,
    name: t.name,
    documentType: type,
    documentLabel: PRINT_INFO[type].label,
    format: t.format,
    isDefault: t.isDefault,
    isActive: t.isActive,
    /** The uploaded file (HTML templates are kept as text). */
    source: t.file
      ? { fileName: t.file.fileName, mimeType: t.file.mimeType, sizeBytes: t.file.sizeBytes }
      : {
          fileName: `${t.name}.html`,
          mimeType: HTML_MIME,
          sizeBytes: Buffer.byteLength(t.htmlContent ?? ""),
        },
    /** PDF and image templates: each page's size in points (72 points = 1 inch). */
    pages: isOverlay(t.format) ? pagesOf(t) : null,
    placeholders: inOrder(t.placeholders).map((p) => presentPlaceholder(p, t.format)),
    /** Tags with no data behind them yet: map them, or they print empty. */
    unmapped: inOrder(t.placeholders)
      .filter((p) => !p.sourcePath)
      .map((p) => p.tag),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export type TemplateView = ReturnType<typeof present>;

function assertCanManage(ctx: CompanyContext) {
  if (!ctx.can("templates.manage")) {
    throw new AppError("FORBIDDEN", "You do not have permission to change document templates.");
  }
}

/** Templates of a type are open to managers, and (active ones) to whoever may print the type. */
function canUse(ctx: CompanyContext, type: TemplateType) {
  return ctx.can(PRINT_INFO[type].permission);
}

async function load(ctx: CompanyContext, id: string): Promise<TemplateRow> {
  const template = await ctx.db.documentTemplate.findUnique({
    where: { id },
    include: templateInclude,
  });
  if (!template || !isTemplateType(template.documentType)) {
    throw new AppError("NOT_FOUND", "Template not found.");
  }
  return template;
}

async function loadVisible(ctx: CompanyContext, id: string): Promise<TemplateRow> {
  const template = await load(ctx, id);
  const type = template.documentType as TemplateType;
  if (ctx.can("templates.manage")) return template;
  if (!template.isActive || !canUse(ctx, type))
    throw new AppError("NOT_FOUND", "Template not found.");
  return template;
}

/** The tags a document type can fill, for people designing a template. */
export function tagCatalog(type: string) {
  if (!isTemplateType(type)) {
    throw new AppError(
      "VALIDATION",
      "Templates can be made for quotations, proforma invoices, invoices, delivery challans and letters.",
    );
  }
  return { documentType: type, documentLabel: PRINT_INFO[type].label, tags: catalogFor(type) };
}

// --- Reading an uploaded file -----------------------------------------------------------

type Source =
  | { format: "WORD"; ext: ".docx"; mimeType: string; tags: string[] }
  | { format: "HTML"; html: string; tags: string[] }
  | { format: "PDF"; ext: ".pdf"; mimeType: string; pages: PageSize[] }
  | { format: "IMAGE"; ext: string; mimeType: string; pages: PageSize[] };

const isOle = (bytes: Buffer) =>
  bytes.length > 8 &&
  bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
const isPng = (bytes: Buffer) =>
  bytes.length > 8 && bytes[0] === 0x89 && bytes.toString("ascii", 1, 4) === "PNG";
const isJpeg = (bytes: Buffer) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;

/** Works out what kind of template a file is and reads it; refuses anything unusable. */
async function readSource(bytes: Buffer): Promise<Source> {
  if (bytes.length === 0) throw new AppError("VALIDATION", "The file is empty.");
  if (bytes.length > MAX_UPLOAD_BYTES)
    throw new AppError("VALIDATION", "Files can be up to 10 MB.");
  try {
    if (bytes.toString("ascii", 0, 5) === "%PDF-") {
      return {
        format: "PDF",
        ext: ".pdf",
        mimeType: PDF_MIME,
        pages: await readPdfTemplate(bytes),
      };
    }
    if (isPng(bytes) || isJpeg(bytes)) {
      const { image, page } = readImageTemplate(bytes);
      return { format: "IMAGE", ext: image.ext, mimeType: image.mimeType, pages: [page] };
    }
    if (isZip(bytes)) {
      return { format: "WORD", ext: ".docx", mimeType: DOCX_MIME, tags: docxTags(bytes) };
    }
    if (isOle(bytes)) {
      throw new TemplateFileError(
        "Old Word files (.doc) cannot be read. Save it as .docx (Word 2007 or later) and upload that.",
      );
    }
    const html = decodeHtml(bytes);
    if (html !== null) return { format: "HTML", html: checkHtml(html), tags: htmlTags(html) };
  } catch (error) {
    if (error instanceof TemplateFileError) throw new AppError("VALIDATION", error.message);
    throw error;
  }
  throw new AppError(
    "VALIDATION",
    "Upload a Word file (.docx), an HTML page, a PDF or a JPG / PNG image.",
  );
}

function checkTagCount(tags: string[]) {
  if (tags.length > MAX_TAGS) {
    throw new AppError("VALIDATION", `A template can use up to ${MAX_TAGS} different tags.`);
  }
}

function htmlSource(html: string): Source {
  try {
    const checked = checkHtml(html);
    return { format: "HTML", html: checked, tags: htmlTags(checked) };
  } catch (error) {
    if (error instanceof TemplateFileError) throw new AppError("VALIDATION", error.message);
    throw error;
  }
}

const uniqueName = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const nameTaken = () =>
  new AppError("CONFLICT", "A template with this name already exists. Choose another name.", {
    name: ["Already used"],
  });

/** Creates the template from a read source (the file is already stored when it has one). */
async function createFromSource(
  ctx: CompanyContext,
  input: { name: string; documentType: TemplateType; isDefault?: boolean },
  source: Source,
  file: {
    fileName: string;
    saved: { storagePath: string; sizeBytes: number; checksum: string };
  } | null,
  meta: RequestMeta | undefined,
) {
  const type = input.documentType;
  const tags = "tags" in source ? source.tags : [];
  checkTagCount(tags);
  return prisma.$transaction(async (tx) => {
    const asset =
      file && "mimeType" in source
        ? await tx.fileAsset.create({
            data: {
              companyId: ctx.company.id,
              uploadedById: ctx.user.id,
              fileName: safeFileName(file.fileName),
              mimeType: source.mimeType,
              sizeBytes: file.saved.sizeBytes,
              storagePath: file.saved.storagePath,
              checksum: file.saved.checksum,
            },
            select: { id: true },
          })
        : null;
    if (input.isDefault) {
      await tx.documentTemplate.updateMany({
        where: { companyId: ctx.company.id, documentType: type, isDefault: true },
        data: { isDefault: false },
      });
    }
    const template = await tx.documentTemplate.create({
      data: {
        companyId: ctx.company.id,
        name: input.name,
        documentType: type,
        format: source.format,
        fileId: asset?.id ?? null,
        htmlContent: source.format === "HTML" ? source.html : null,
        pageSizes: "pages" in source ? source.pages : Prisma.DbNull,
        isDefault: input.isDefault ?? false,
        placeholders: {
          create: tags.map((name) => ({
            tag: tagLabel(name),
            sourcePath: defaultPath(name, type),
          })),
        },
      },
      include: templateInclude,
    });
    const unmapped = template.placeholders.filter((p) => !p.sourcePath).length;
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "DocumentTemplate",
        entityId: template.id,
        summary: `Added ${FORMAT_LABEL[source.format]} template "${template.name}" for ${PRINT_INFO[type].plural}${
          isOverlay(source.format)
            ? ` (${"pages" in source ? source.pages.length : 1} page${"pages" in source && source.pages.length === 1 ? "" : "s"})`
            : `: ${tags.length} tag${tags.length === 1 ? "" : "s"}${unmapped ? `, ${unmapped} not recognised` : ""}`
        }`,
      },
      tx,
    );
    return template;
  });
}

/**
 * Uploads a template: a Word file (.docx), an HTML page, a PDF or a JPG / PNG
 * image, with `name`, `documentType` and `isDefault` as form fields. The tags of
 * a Word or HTML template are read and matched to their data at once.
 */
export async function uploadTemplate(
  ctx: CompanyContext,
  fields: unknown,
  upload: { fileName: string; bytes: Buffer },
  meta?: RequestMeta,
) {
  assertCanManage(ctx);
  const input = uploadTemplateSchema.parse(fields);
  const source = await readSource(upload.bytes);
  const saved =
    "ext" in source
      ? await writeGeneratedFile(ctx.company.id, "templates", source.ext, upload.bytes)
      : null;
  try {
    const template = await createFromSource(
      ctx,
      input,
      source,
      saved ? { fileName: upload.fileName, saved } : null,
      meta,
    );
    return present(template);
  } catch (error) {
    if (saved) await deleteStoredFile(saved).catch(() => undefined);
    if (uniqueName(error)) throw nameTaken();
    throw error;
  }
}

/** Creates an HTML template from its text (instead of uploading a file). */
export async function createHtmlTemplate(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManage(ctx);
  const input = createHtmlTemplateSchema.parse(raw);
  try {
    return present(await createFromSource(ctx, input, htmlSource(input.html), null, meta));
  } catch (error) {
    if (uniqueName(error)) throw nameTaken();
    throw error;
  }
}

/** Keeps the mapping of tags still in the template, adds new tags and drops the ones gone. */
async function syncTags(
  tx: Prisma.TransactionClient,
  template: TemplateRow,
  tags: string[],
): Promise<{ added: number; removed: number }> {
  const type = template.documentType as TemplateType;
  const wanted = new Set(tags.map(tagLabel));
  const have = new Set(template.placeholders.map((p) => p.tag));
  const gone = template.placeholders.filter((p) => !wanted.has(p.tag)).map((p) => p.id);
  if (gone.length > 0) await tx.templatePlaceholder.deleteMany({ where: { id: { in: gone } } });
  const added = tags.filter((name) => !have.has(tagLabel(name)));
  if (added.length > 0) {
    await tx.templatePlaceholder.createMany({
      data: added.map((name) => ({
        templateId: template.id,
        tag: tagLabel(name),
        sourcePath: defaultPath(name, type),
      })),
    });
  }
  return { added: added.length, removed: gone.length };
}

/**
 * Replaces a template's file with a new version of the same kind. Word and HTML
 * templates keep the mapping of the tags still in them; PDF and image templates
 * keep their placed tags (those beyond the new last page go).
 */
export async function replaceTemplateFile(
  ctx: CompanyContext,
  id: string,
  upload: { fileName: string; bytes: Buffer },
  meta?: RequestMeta,
) {
  assertCanManage(ctx);
  const template = await load(ctx, id);
  const source = await readSource(upload.bytes);
  if (source.format !== template.format) {
    throw new AppError(
      "VALIDATION",
      `This is a ${FORMAT_LABEL[template.format]} template; upload a ${FORMAT_LABEL[template.format]} file, or add a new template.`,
    );
  }
  if ("tags" in source) checkTagCount(source.tags);
  const saved =
    "ext" in source
      ? await writeGeneratedFile(ctx.company.id, "templates", source.ext, upload.bytes)
      : null;
  try {
    const { row, oldFile } = await prisma.$transaction(async (tx) => {
      await lockRow(tx, "DocumentTemplate", template.id);
      const current = await tx.documentTemplate.findUniqueOrThrow({
        where: { id: template.id },
        include: templateInclude,
      });
      const asset =
        saved && "mimeType" in source
          ? await tx.fileAsset.create({
              data: {
                companyId: ctx.company.id,
                uploadedById: ctx.user.id,
                fileName: safeFileName(upload.fileName),
                mimeType: source.mimeType,
                sizeBytes: saved.sizeBytes,
                storagePath: saved.storagePath,
                checksum: saved.checksum,
              },
              select: { id: true },
            })
          : null;
      let change = "";
      if ("tags" in source) {
        const { added, removed } = await syncTags(tx, current, source.tags);
        change = `${source.tags.length} tags (${added} new, ${removed} gone)`;
      } else {
        const { count } = await tx.templatePlaceholder.deleteMany({
          where: { templateId: current.id, page: { gt: source.pages.length } },
        });
        change = `${source.pages.length} page${source.pages.length === 1 ? "" : "s"}${count ? `, ${count} placed tags beyond the last page removed` : ""}`;
      }
      const updated = await tx.documentTemplate.update({
        where: { id: current.id },
        data: {
          ...(asset ? { fileId: asset.id } : {}),
          ...(source.format === "HTML" ? { htmlContent: source.html } : {}),
          ...("pages" in source ? { pageSizes: source.pages } : {}),
        },
        include: templateInclude,
      });
      if (asset && current.file) await tx.fileAsset.delete({ where: { id: current.file.id } });
      await auditInCompany(
        ctx,
        meta,
        {
          action: "UPDATE",
          entityType: "DocumentTemplate",
          entityId: current.id,
          summary: `New file for template "${current.name}": ${change}`,
        },
        tx,
      );
      return { row: updated, oldFile: asset ? current.file : null };
    });
    if (oldFile) await deleteStoredFile(oldFile).catch(() => undefined);
    return present(row);
  } catch (error) {
    if (saved) await deleteStoredFile(saved).catch(() => undefined);
    throw error;
  }
}

/** Renames a template, makes it the default, switches it on or off, or (HTML) changes its page. */
export async function updateTemplate(
  ctx: CompanyContext,
  id: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManage(ctx);
  const input = updateTemplateSchema.parse(raw);
  const template = await load(ctx, id);
  if (input.html !== undefined && template.format !== "HTML") {
    throw new AppError(
      "VALIDATION",
      "Only HTML templates can be edited as text; upload a new file instead.",
    );
  }
  const source = input.html !== undefined ? htmlSource(input.html) : null;
  if (source && "tags" in source) checkTagCount(source.tags);
  try {
    const row = await prisma.$transaction(async (tx) => {
      await lockRow(tx, "DocumentTemplate", template.id);
      const current = await tx.documentTemplate.findUniqueOrThrow({
        where: { id: template.id },
        include: templateInclude,
      });
      if (input.isDefault) {
        await tx.documentTemplate.updateMany({
          where: {
            companyId: ctx.company.id,
            documentType: current.documentType,
            isDefault: true,
            id: { not: current.id },
          },
          data: { isDefault: false },
        });
      }
      if (source && source.format === "HTML") await syncTags(tx, current, source.tags);
      const updated = await tx.documentTemplate.update({
        where: { id: current.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(source && source.format === "HTML" ? { htmlContent: source.html } : {}),
        },
        include: templateInclude,
      });
      await auditInCompany(
        ctx,
        meta,
        {
          action: "UPDATE",
          entityType: "DocumentTemplate",
          entityId: current.id,
          summary: `Edited template "${updated.name}": ${Object.keys(input).join(", ")}`,
        },
        tx,
      );
      return updated;
    });
    return present(row);
  } catch (error) {
    if (uniqueName(error)) throw nameTaken();
    throw error;
  }
}

/**
 * Maps a template's tags to data and, on PDF and image templates, places them.
 * Word / HTML: each listed tag (one found in the file) gets its data and case
 * format. PDF / image: the list replaces the placed tags; each needs a page and
 * a position, and a tag can be placed once (give a second copy its own name,
 * e.g. {BuyerName2}, mapped to the same data).
 */
export async function setPlaceholders(
  ctx: CompanyContext,
  id: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManage(ctx);
  const input = placeholdersSchema.parse(raw);
  const template = await load(ctx, id);
  const type = template.documentType as TemplateType;
  const allowed = pathsFor(type);
  const pages = pagesOf(template);

  const items = input.placeholders.map((p, index) => {
    const name = parseTagInput(p.tag);
    const field = (key: string) => `placeholders.${index}.${key}`;
    if (!name) {
      throw new AppError("VALIDATION", `"${p.tag}" is not a tag. Write tags like {BuyerName}.`, {
        [field("tag")]: ["Use letters and digits in braces, like {BuyerName}"],
      });
    }
    if (p.sourcePath && !allowed.has(p.sourcePath)) {
      throw new AppError(
        "VALIDATION",
        `${PRINT_INFO[type].label} templates cannot print "${p.sourcePath}".`,
        { [field("sourcePath")]: ["Pick one of the catalog's data"] },
      );
    }
    return { ...p, name, index };
  });

  const seen = new Set<string>();
  for (const p of items) {
    if (seen.has(p.name)) {
      throw new AppError(
        "VALIDATION",
        `${tagLabel(p.name)} is listed twice. To print the same data twice, give the second one its own name (e.g. ${tagLabel(`${p.name}2`)}).`,
      );
    }
    seen.add(p.name);
  }

  if (isOverlay(template.format)) {
    for (const p of items) {
      const field = (key: string) => `placeholders.${p.index}.${key}`;
      if (p.page === undefined || p.x === undefined || p.y === undefined) {
        throw new AppError("VALIDATION", `Say where ${tagLabel(p.name)} goes: a page, x and y.`, {
          [field("page")]: ["Required"],
        });
      }
      const size = pages[p.page - 1];
      if (!size) {
        throw new AppError(
          "VALIDATION",
          `The template has ${pages.length} page${pages.length === 1 ? "" : "s"}.`,
          {
            [field("page")]: [`Pick a page from 1 to ${pages.length}`],
          },
        );
      }
      if (p.x > size.width || p.y > size.height) {
        throw new AppError(
          "VALIDATION",
          `${tagLabel(p.name)} is outside page ${p.page} (${size.width} × ${size.height} points).`,
          { [field("x")]: ["Must be on the page"] },
        );
      }
    }
  } else {
    const known = new Set(template.placeholders.map((p) => tagNameOf(p.tag)));
    const missing = items.filter((p) => !known.has(p.name));
    if (missing.length > 0) {
      throw new AppError(
        "VALIDATION",
        `${missing.map((p) => tagLabel(p.name)).join(", ")} ${missing.length === 1 ? "is" : "are"} not in this template. Add the tag to the file first.`,
      );
    }
  }

  const row = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "DocumentTemplate", template.id);
    if (isOverlay(template.format)) {
      await tx.templatePlaceholder.deleteMany({ where: { templateId: template.id } });
      await tx.templatePlaceholder.createMany({
        data: items.map((p) => ({
          templateId: template.id,
          tag: tagLabel(p.name),
          sourcePath: p.sourcePath !== undefined ? p.sourcePath : defaultPath(p.name, type),
          format: p.format ?? null,
          page: p.page!,
          pageX: p.x!,
          pageY: p.y!,
          fontSize: p.fontSize ?? 10,
          bold: p.bold ?? false,
          align: p.align ?? "left",
          width: p.width ?? null,
        })),
      });
    } else {
      for (const p of items) {
        const existing = template.placeholders.find((x) => tagNameOf(x.tag) === p.name)!;
        await tx.templatePlaceholder.update({
          where: { id: existing.id },
          data: {
            ...(p.sourcePath !== undefined ? { sourcePath: p.sourcePath } : {}),
            ...(p.format !== undefined ? { format: p.format } : {}),
          },
        });
      }
    }
    const updated = await tx.documentTemplate.update({
      where: { id: template.id },
      data: { updatedAt: new Date() },
      include: templateInclude,
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "DocumentTemplate",
        entityId: template.id,
        summary: `${isOverlay(template.format) ? "Placed" : "Mapped"} ${items.length} tag${items.length === 1 ? "" : "s"} on template "${template.name}"`,
      },
      tx,
    );
    return updated;
  });
  return present(row);
}

/** Deletes a template and its file; documents already filled from it are kept. */
export async function deleteTemplate(ctx: CompanyContext, id: string, meta?: RequestMeta) {
  assertCanManage(ctx);
  const template = await load(ctx, id);
  await prisma.$transaction(async (tx) => {
    await tx.documentTemplate.delete({ where: { id: template.id } });
    if (template.file) await tx.fileAsset.delete({ where: { id: template.file.id } });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "DELETE",
        entityType: "DocumentTemplate",
        entityId: template.id,
        summary: `Deleted ${FORMAT_LABEL[template.format]} template "${template.name}"`,
      },
      tx,
    );
  });
  if (template.file) await deleteStoredFile(template.file).catch(() => undefined);
  return { id: template.id, deleted: true };
}

export async function getTemplate(ctx: CompanyContext, id: string) {
  return present(await loadVisible(ctx, id));
}

/** Templates, defaults first. People without templates.manage see the active ones they can fill. */
export async function listTemplates(ctx: CompanyContext, raw: unknown = {}) {
  const input = listTemplatesSchema.parse(raw);
  const manager = ctx.can("templates.manage");
  const types = (input.documentType ? [input.documentType] : [...TEMPLATE_TYPES]).filter(
    (type) => manager || canUse(ctx, type),
  );
  if (types.length === 0) {
    throw new AppError("FORBIDDEN", "You do not have permission to use these templates.");
  }
  const rows = await ctx.db.documentTemplate.findMany({
    where: {
      documentType: { in: types },
      ...(!manager || input.active ? { isActive: true } : {}),
    },
    include: templateInclude,
    orderBy: [{ documentType: "asc" }, { isDefault: "desc" }, { name: "asc" }],
    take: 200,
  });
  return { items: rows.map(present) };
}

/** The uploaded file itself (templates.manage), to check or edit it. */
export async function downloadTemplateSource(ctx: CompanyContext, id: string) {
  assertCanManage(ctx);
  const template = await load(ctx, id);
  if (template.format === "HTML") {
    return {
      fileName: `${template.name}.html`,
      mimeType: HTML_MIME,
      bytes: Buffer.from(template.htmlContent ?? "", "utf8"),
    };
  }
  if (!template.file) throw new AppError("NOT_FOUND", "The template's file is missing.");
  return {
    fileName: template.file.fileName,
    mimeType: template.file.mimeType,
    bytes: await readStoredFile(template.file),
  };
}

// --- Filling ----------------------------------------------------------------------------

const OUTPUT: Record<TemplateFormat, { ext: string; mimeType: string }> = {
  WORD: { ext: ".docx", mimeType: DOCX_MIME },
  HTML: { ext: ".html", mimeType: HTML_MIME },
  PDF: { ext: ".pdf", mimeType: PDF_MIME },
  IMAGE: { ext: ".pdf", mimeType: PDF_MIME },
};

function placementsOf(template: TemplateRow): Placement[] {
  return template.placeholders
    .filter((p) => p.page !== null && p.pageX !== null && p.pageY !== null)
    .map((p) => ({
      name: tagNameOf(p.tag),
      page: p.page!,
      x: Number(p.pageX),
      y: Number(p.pageY),
      fontSize: p.fontSize ?? 10,
      bold: p.bold,
      align: p.align === "center" || p.align === "right" ? p.align : "left",
      width: p.width === null ? null : Number(p.width),
    }));
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Another fill took the same content at the same moment. */
class LostRace extends Error {}

/**
 * Fills a template with a document (`id` of the quotation, proforma, invoice or
 * challan; for a letter, optionally `partyId`) and keeps the result with the
 * printed documents. `reused` is true when nothing changed since the last fill.
 */
export async function fillTemplate(
  ctx: CompanyContext,
  id: string,
  raw: unknown,
  meta?: RequestMeta,
  now: Date = new Date(),
): Promise<PrintedDocument & { reused: boolean }> {
  const input = fillTemplateSchema.parse(raw);
  const template = await loadVisible(ctx, id);
  const type = template.documentType as TemplateType;
  assertMayPrint(ctx, type);
  if (!template.isActive) {
    throw new AppError("CONFLICT", "This template is switched off. Switch it on to use it.");
  }
  if (type === "LETTERHEAD" && input.partyId && !ctx.can("parties.view")) {
    throw new AppError("FORBIDDEN", "You do not have permission to see buyers and suppliers.");
  }
  checkRateLimit(`print:${ctx.user.id}`, PRINT_PER_MINUTE, 60_000);

  const { data, record } = await templateData(ctx, type, input, now);
  const mappings = new Map<string, TagMapping>(
    template.placeholders.map((p) => [tagNameOf(p.tag), { path: p.sourcePath, format: p.format }]),
  );
  const resolver = makeResolver(mappings, type, data);

  // The hash covers what this template prints: its file, its tags and their data.
  const used = new Set(template.placeholders.flatMap((p) => (p.sourcePath ? [p.sourcePath] : [])));
  const pick = (values: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(values)
        .filter(([path]) => used.has(path))
        .sort(),
    );
  const hash = sha256({
    fill: FILL_VERSION,
    template: template.id,
    source: template.file?.checksum ?? sha256(template.htmlContent ?? ""),
    placeholders: inOrder(template.placeholders).map((p) => [
      p.tag,
      p.sourcePath,
      p.format,
      p.page,
      p.pageX?.toString() ?? null,
      p.pageY?.toString() ?? null,
      p.fontSize,
      p.bold,
      p.align,
      p.width?.toString() ?? null,
    ]),
    values: pick(data.values),
    items: [...used].some(isItemPath) ? data.items.map(pick) : [],
  });

  const findByHash = () =>
    ctx.db.generatedDocument.findFirst({ where: { contentHash: hash }, include: documentInclude });
  const existing = await findByHash();
  if (existing?.file && (await storedFileExists(existing.file))) {
    return { ...presentDocument(existing), reused: true };
  }

  const title = `${record.title} (${template.name})`;
  const output = OUTPUT[template.format];
  const sourceBytes = template.file ? await readStoredFile(template.file) : null;
  let bytes: Buffer;
  try {
    switch (template.format) {
      case "WORD":
        bytes = fillDocx(sourceBytes!, resolver, data.items);
        break;
      case "HTML":
        bytes = Buffer.from(fillHtml(template.htmlContent ?? "", resolver, data.items), "utf8");
        break;
      case "PDF":
        bytes = await fillPdfTemplate(sourceBytes!, placementsOf(template), resolver, title);
        break;
      case "IMAGE":
        bytes = await fillImageTemplate(
          sourceBytes!,
          pagesOf(template)[0] ?? { width: 595.28, height: 841.89 },
          placementsOf(template),
          resolver,
          title,
        );
        break;
    }
  } catch (error) {
    if (error instanceof TemplateFileError) throw new AppError("VALIDATION", error.message);
    throw error;
  }

  const saved = await writeGeneratedFile(ctx.company.id, "documents", output.ext, bytes);
  const companyId = ctx.company.id;
  try {
    const row: DocumentRow = await prisma.$transaction(async (tx) => {
      const asset = await tx.fileAsset.create({
        data: {
          companyId,
          uploadedById: null,
          fileName: documentFileName(ctx.company.name, title, output.ext),
          mimeType: output.mimeType,
          sizeBytes: saved.sizeBytes,
          storagePath: saved.storagePath,
          checksum: saved.checksum,
        },
      });
      let documentId: string;
      if (existing) {
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
            documentType: type,
            referenceType: record.referenceType,
            referenceId: record.referenceId,
            partyId: record.partyId,
            templateId: template.id,
            fileId: asset.id,
            title,
            contentHash: hash,
            options: { templateId: template.id, templateName: template.name },
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
          summary: `Filled template "${template.name}": ${record.title}`,
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
    if (error instanceof LostRace || uniqueName(error)) {
      const winner = await findByHash();
      if (winner) return { ...presentDocument(winner), reused: true };
    }
    throw error;
  }
}
