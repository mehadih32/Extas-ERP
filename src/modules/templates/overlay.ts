import { PDFDocument, type PDFPage } from "pdf-lib";

import { ImageCheckError, type ImageInfo, type ImageLimits, inspectImage } from "@/lib/images";
import {
  collectPdf,
  createPdf,
  drawText,
  fitText,
  pdfImageSize,
  pdfInfo,
  pdfText,
  type TextStyle,
  textWidth,
} from "@/lib/pdf";
import { TemplateFileError } from "@/modules/templates/docx";
import type { Resolver } from "@/modules/templates/resolve";

/*
 * PDF and image templates: a ready-made form (a PDF from the printer, a scanned
 * invoice pad) with the values written on top at chosen places. Each tag has a
 * page, the top-left corner of its text (points from the top-left of the page;
 * 72 points = 1 inch), a size, bold or not, and optionally a box width to align
 * in and cut long text to. A value with several lines, or an item tag (one line
 * per document line), continues downwards. Bengali prints as in every PDF.
 *
 * The text is drawn on a see-through page by the same PDF writer as all other
 * documents, then laid over the template's page, so the template itself is
 * never changed. An image becomes an A4-wide page (A4 landscape when it is wider
 * than tall) with the picture filling it.
 */

export const MAX_PDF_PAGES = 20;
/** Enough for an A4 scan at 300 dpi; bigger pictures make slow, heavy PDFs. */
export const TEMPLATE_IMAGE_LIMITS: ImageLimits = { maxSide: 5000, maxPixels: 12_000_000 };

const A4_WIDTH = 595.28;
const A4_LANDSCAPE_WIDTH = 841.89;

export type PageSize = { width: number; height: number };

/** A tag placed on a page of a PDF or image template. */
export type Placement = {
  name: string;
  /** 1 = the first page. */
  page: number;
  x: number;
  y: number;
  fontSize: number;
  bold: boolean;
  align: "left" | "center" | "right";
  /** The box the text is aligned in and cut to; none = as wide as the text. */
  width: number | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const unreadable = () =>
  new TemplateFileError("This PDF cannot be read. Save it again as a PDF and upload it.");

/** The PDF and its pages; a damaged file (pdf-lib reads leniently, then trips) is refused. */
async function loadPdf(bytes: Buffer): Promise<{ pdf: PDFDocument; pages: PDFPage[] }> {
  try {
    const pdf = await PDFDocument.load(new Uint8Array(bytes), { updateMetadata: false });
    return { pdf, pages: pdf.getPages() };
  } catch (error) {
    if (error instanceof Error && /encrypt/i.test(error.message)) {
      throw new TemplateFileError(
        "This PDF is password-protected. Save a copy without the password and upload that.",
      );
    }
    throw unreadable();
  }
}

/** The size of each page of a PDF template (what the user sees), checked for use. */
export async function readPdfTemplate(bytes: Buffer): Promise<PageSize[]> {
  const { pages } = await loadPdf(bytes);
  if (pages.length === 0) throw new TemplateFileError("This PDF has no pages.");
  if (pages.length > MAX_PDF_PAGES) {
    throw new TemplateFileError(`PDF templates can have up to ${MAX_PDF_PAGES} pages.`);
  }
  return pages.map((page) => {
    let rotation: number;
    let box: { width: number; height: number };
    try {
      rotation = ((page.getRotation().angle % 360) + 360) % 360;
      box = page.getCropBox();
    } catch {
      throw unreadable();
    }
    if (rotation !== 0) {
      throw new TemplateFileError(
        "This PDF has turned (rotated) pages. Print it to a new PDF so the pages are upright, then upload that.",
      );
    }
    if (!(box.width > 0 && box.height > 0 && box.width <= 14_400 && box.height <= 14_400)) {
      throw unreadable();
    }
    return { width: round2(box.width), height: round2(box.height) };
  });
}

/** Checks a JPG or PNG template and works out its page size. */
export function readImageTemplate(bytes: Buffer): { image: ImageInfo; page: PageSize } {
  let image: ImageInfo;
  try {
    image = inspectImage(bytes, TEMPLATE_IMAGE_LIMITS);
  } catch (error) {
    if (error instanceof ImageCheckError) throw new TemplateFileError(error.message);
    throw error;
  }
  const seen = pdfImageSize(bytes);
  if (!seen || seen.width !== image.width || seen.height !== image.height) {
    throw new TemplateFileError(
      "This image cannot be printed; save it again as a standard PNG or JPG.",
    );
  }
  const width = image.width > image.height ? A4_LANDSCAPE_WIDTH : A4_WIDTH;
  return { image, page: { width, height: round2((width * image.height) / image.width) } };
}

function drawPlacements(doc: PDFKit.PDFDocument, placements: Placement[], resolver: Resolver) {
  doc.fillColor("#000000");
  for (const p of placements) {
    const style: TextStyle = { font: p.bold ? "Helvetica-Bold" : "Helvetica", size: p.fontSize };
    const lineHeight = p.fontSize * 1.25;
    resolver
      .value(p.name)
      .split(/\r\n|\r|\n/)
      .forEach((line, i) => {
        const text = p.width ? fitText(doc, line, p.width, style) : pdfText(line).trim();
        if (!text) return;
        const width = textWidth(doc, text, style);
        const x =
          p.width && p.align === "right"
            ? p.x + p.width - width
            : p.width && p.align === "center"
              ? p.x + (p.width - width) / 2
              : p.x;
        drawText(doc, text, x, p.y + i * lineHeight, style);
      });
  }
}

/** The values on see-through pages of the given sizes, to lay over a template's pages. */
export async function renderOverlay(
  pages: Array<{ page: number; size: PageSize }>,
  placements: Placement[],
  resolver: Resolver,
  title: string,
): Promise<Buffer> {
  const overlay = await createPdf({ autoFirstPage: false, info: { Title: pdfInfo(title) } });
  const done = collectPdf(overlay);
  for (const { page, size } of pages) {
    overlay.addPage({ size: [size.width, size.height], margin: 0 });
    drawPlacements(
      overlay,
      placements.filter((p) => p.page === page),
      resolver,
    );
  }
  overlay.end();
  return done;
}

/** The PDF template with the values written on its pages. */
export async function fillPdfTemplate(
  bytes: Buffer,
  placements: Placement[],
  resolver: Resolver,
  title: string,
): Promise<Buffer> {
  const { pdf, pages } = await loadPdf(bytes);
  const used = [...new Set(placements.map((p) => p.page))]
    .filter((n) => n >= 1 && n <= pages.length)
    .sort((a, b) => a - b);
  pdf.setTitle(pdfInfo(title));
  let boxes: Array<{ x: number; y: number; width: number; height: number }>;
  try {
    boxes = used.map((n) => pages[n - 1]!.getCropBox());
  } catch {
    throw unreadable();
  }
  const overlay =
    used.length > 0
      ? await renderOverlay(
          used.map((page, i) => ({ page, size: boxes[i]! })),
          placements,
          resolver,
          title,
        )
      : null;
  try {
    if (overlay) {
      // pdf-lib keeps each page's own drawing state apart (q / Q) before adding to it.
      const layers = await pdf.embedPdf(
        overlay,
        used.map((_, i) => i),
      );
      used.forEach((n, i) => {
        const box = boxes[i]!;
        pages[n - 1]!.drawPage(layers[i]!, {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        });
      });
    }
    return Buffer.from(await pdf.save());
  } catch {
    throw unreadable();
  }
}

/** An image template as a one-page PDF with the values written on it. */
export async function fillImageTemplate(
  bytes: Buffer,
  page: PageSize,
  placements: Placement[],
  resolver: Resolver,
  title: string,
): Promise<Buffer> {
  const doc = await createPdf({ autoFirstPage: false, info: { Title: pdfInfo(title) } });
  const done = collectPdf(doc);
  doc.addPage({ size: [page.width, page.height], margin: 0 });
  // Drawn as stored: the page size was worked out from the stored pixels.
  doc.image(bytes, 0, 0, {
    width: page.width,
    height: page.height,
    ignoreOrientation: true,
  } as PDFKit.Mixins.ImageOption);
  drawPlacements(
    doc,
    placements.filter((p) => p.page === 1),
    resolver,
  );
  doc.end();
  return done;
}
