import {
  collectPdf,
  createPdf,
  drawText,
  fitText,
  PDF_MIME,
  pdfInfo,
  pdfText,
  safeHex,
  textWidth,
  tint,
  wrapText,
} from "@/lib/pdf";
import {
  type ColumnKind,
  formatCell,
  formatRange,
  type ReportDocument,
  type ReportFigure,
  type ReportRow,
  type ReportSection,
  type ReportTable,
} from "@/modules/reports/document";

/*
 * The PDF version of a report: A4 portrait, the company's logo, name, details
 * and registration numbers (BIN, trade licence) on top, each section with its
 * headline figures as cards and its tables (numbers right-aligned, header
 * repeated on every page, totals in bold), and a footer with the page number
 * on every page.
 *
 * Text is placed line by line at exact positions (never through pdfkit's own
 * wrapping), so a long name is cut with "…" instead of spilling over, and no
 * page is ever added by surprise. Helvetica covers Western European text and
 * Noto Sans Bengali covers Bengali; other scripts show as "?" in the PDF and
 * stay intact in Excel.
 */

export { PDF_MIME, pdfText };

const PAGE = { width: 595.28, height: 841.89 }; // A4 in points
const MARGIN = { top: 40, bottom: 48, left: 40, right: 40 };
const WIDTH = PAGE.width - MARGIN.left - MARGIN.right;
const BOTTOM = PAGE.height - MARGIN.bottom;

const REGULAR = "Helvetica";
const BOLD = "Helvetica-Bold";
const ITALIC = "Helvetica-Oblique";

const INK = "#1F2933";
const MUTED = "#6B7280";
const RULE = "#9AA5A0";
const ZEBRA = "#F4F6F5";

/** The most room the company's logo takes, beside its name. */
const LOGO_BOX = { width: 110, height: 44 };

/** pdfkit's opened image (its type definitions leave openImage out). */
type OpenedImage = { width: number; height: number; orientation?: number };
type PdfImages = {
  openImage(src: Buffer): OpenedImage;
  image(src: OpenedImage, x: number, y: number, options: { width: number; height: number }): void;
};

const ROW = 14;
const HEADER_ROW = 16;
/** Extra height for a second header line. */
const LINE_STEP = 9;
const CELL_PAD = 4;
const TABLE_SIZE = 7.5;

const DEFAULT_WEIGHT: Record<ColumnKind, number> = {
  text: 2,
  int: 1,
  money: 1.5,
  percent: 1,
  day: 1.4,
  month: 1.2,
};

type Align = "left" | "right";
const alignOf = (kind: ColumnKind): Align =>
  kind === "text" || kind === "day" || kind === "month" ? "left" : "right";

class Writer {
  private y = MARGIN.top;
  private readonly primary: string;
  private readonly currency: string;

  constructor(
    private readonly doc: PDFKit.PDFDocument,
    private readonly report: ReportDocument,
    private readonly logo: Buffer | null = null,
  ) {
    this.primary = safeHex(report.company.primaryColor, "#0B3D2E");
    this.currency = report.company.currency;
  }

  // --- Primitives -----------------------------------------------------------

  private newPage() {
    this.doc.addPage();
    this.y = MARGIN.top;
  }

  /** Starts a new page when `height` does not fit on this one; true if it did. */
  private ensure(height: number): boolean {
    if (this.y + height <= BOTTOM) return false;
    this.newPage();
    return true;
  }

  /** One line of text in a box, cut to fit, aligned left or right. */
  private line(
    text: string,
    x: number,
    y: number,
    width: number,
    style: { font?: string; size: number; color?: string; align?: Align },
  ) {
    const doc = this.doc;
    const textStyle = { font: style.font ?? REGULAR, size: style.size };
    const fitted = fitText(doc, text, width, textStyle);
    if (!fitted) return;
    const dx = style.align === "right" ? width - textWidth(doc, fitted, textStyle) : 0;
    doc.fillColor(style.color ?? INK);
    drawText(doc, fitted, x + dx, y, textStyle);
  }

  /** Greedy word wrap into lines no wider than `width`. */
  private wrap(text: string, width: number, font: string, size: number): string[] {
    return wrapText(this.doc, text, width, { font, size });
  }

  private paragraph(text: string, style: { font: string; size: number; color: string }) {
    const lineHeight = style.size * 1.35;
    for (const l of this.wrap(text, WIDTH, style.font, style.size)) {
      this.ensure(lineHeight);
      this.line(l, MARGIN.left, this.y, WIDTH, style);
      this.y += lineHeight;
    }
  }

  private rule(y: number, color: string, width = 0.6, x = MARGIN.left, length = WIDTH) {
    this.doc
      .moveTo(x, y)
      .lineTo(x + length, y)
      .lineWidth(width)
      .strokeColor(color)
      .stroke();
  }

  // --- Page parts -----------------------------------------------------------

  /**
   * The company's logo, then its name and details, on the left; the report's
   * title and period on the right.
   */
  header() {
    const { company } = this.report;
    const left = WIDTH * 0.55;
    const right = WIDTH - left - 10;
    const rx = MARGIN.left + left + 10;
    const logo = this.drawLogo();
    const nameX = MARGIN.left + (logo ? logo.width + 10 : 0);
    const nameWidth = left - (nameX - MARGIN.left);
    let ly = MARGIN.top;
    // A long name gets smaller (down to 11 pt) before it is cut.
    let nameSize = 16;
    while (
      nameSize > 11 &&
      textWidth(this.doc, company.name, { font: BOLD, size: nameSize }) > nameWidth
    ) {
      nameSize -= 0.5;
    }
    this.line(company.name, nameX, ly, nameWidth, {
      font: BOLD,
      size: nameSize,
      color: this.primary,
    });
    ly += 21;
    const details = [
      company.legalName && company.legalName !== company.name ? company.legalName : null,
      company.address,
      [company.phone, company.email, company.website].filter(Boolean).join("  ·  ") || null,
      ...(company.registrations ?? []),
    ].filter((d): d is string => Boolean(d));
    for (const d of details) {
      this.line(d, nameX, ly, nameWidth, { size: 8, color: MUTED });
      ly += 11;
    }
    if (logo) ly = Math.max(ly, MARGIN.top + logo.height);

    let ry = MARGIN.top + 2;
    this.line(this.report.title, rx, ry, right, { font: BOLD, size: 13, align: "right" });
    ry += 18;
    this.line(this.report.period.label, rx, ry, right, { size: 8.5, align: "right" });
    ry += 12;
    this.line(`Made ${this.report.generatedOn} by ${this.report.generatedBy}`, rx, ry, right, {
      size: 7.5,
      color: MUTED,
      align: "right",
    });
    ry += 11;
    this.line(`Amounts in ${this.currency}`, rx, ry, right, {
      size: 7.5,
      color: MUTED,
      align: "right",
    });
    ry += 11;

    this.y = Math.max(ly, ry) + 6;
    this.rule(this.y, this.primary, 1.6);
    this.y += 14;
  }

  /**
   * The logo at the top left, scaled into its box; its size, or null when there
   * is none or the image cannot be read (the report then prints without it).
   */
  private drawLogo(): { width: number; height: number } | null {
    if (!this.logo) return null;
    try {
      // Always a Buffer: given a string, pdfkit would read it as a file path.
      const images = this.doc as unknown as PdfImages;
      const image = images.openImage(this.logo);
      const rotated = (image.orientation ?? 1) > 4;
      const width = rotated ? image.height : image.width;
      const height = rotated ? image.width : image.height;
      const scale = Math.min(LOGO_BOX.width / width, LOGO_BOX.height / height);
      const size = { width: width * scale, height: height * scale };
      images.image(image, MARGIN.left, MARGIN.top, size);
      return size;
    } catch {
      return null;
    }
  }

  /** Company, report and period on the left; "Page 2 of 5" on the right, on every page. */
  footers() {
    const range = this.doc.bufferedPageRange();
    const text = `${this.report.company.name}  ·  ${this.report.title}  ·  ${formatRange(
      this.report.period.from,
      this.report.period.to,
    )}`;
    const y = PAGE.height - MARGIN.bottom + 18;
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);
      this.rule(y - 6, RULE, 0.4);
      this.line(text, MARGIN.left, y, WIDTH * 0.75, { size: 7, color: MUTED });
      this.line(`Page ${i - range.start + 1} of ${range.count}`, MARGIN.left, y, WIDTH, {
        size: 7,
        color: MUTED,
        align: "right",
      });
    }
  }

  // --- Sections ---------------------------------------------------------------

  section(section: ReportSection) {
    // Keep the title with the start of its content.
    if (!this.ensure(110) && this.y > MARGIN.top) this.y += 8;
    this.line(section.title, MARGIN.left, this.y, WIDTH, {
      font: BOLD,
      size: 12.5,
      color: this.primary,
    });
    this.y += 17;
    this.line(section.subtitle, MARGIN.left, this.y, WIDTH, { size: 8, color: MUTED });
    this.y += 14;
    if (section.figures.length > 0) this.figures(section.figures);
    for (const table of section.tables) this.table(table);
    if (section.notes.length > 0) {
      this.y += 2;
      for (const note of section.notes) {
        this.paragraph(note, { font: ITALIC, size: 7, color: MUTED });
        this.y += 2;
      }
    }
    this.y += 6;
  }

  private figures(figures: ReportFigure[]) {
    const perRow = figures.length === 4 ? 4 : Math.min(3, figures.length);
    const gap = 8;
    const width = (WIDTH - gap * (perRow - 1)) / perRow;
    const height = 48;
    for (let i = 0; i < figures.length; i += perRow) {
      this.ensure(height + gap);
      figures.slice(i, i + perRow).forEach((f, j) => {
        const x = MARGIN.left + j * (width + gap);
        this.doc.roundedRect(x, this.y, width, height, 3).fill(tint(this.primary, 0.92));
        this.line(f.label, x + 8, this.y + 7, width - 16, { size: 7.5, color: MUTED });
        this.line(formatCell(f.value, f.kind, this.currency), x + 8, this.y + 18, width - 16, {
          font: BOLD,
          size: 12.5,
        });
        if (f.hint) this.line(f.hint, x + 8, this.y + 35, width - 16, { size: 6.5, color: MUTED });
      });
      this.y += height + gap;
    }
    this.y += 2;
  }

  /**
   * The columns' widths, by weight; a column too narrow for its heading's longest
   * word or its widest cell ("Available", "Bottle Green") takes the room it needs
   * from the columns that have room to spare. When the table cannot fit it all,
   * the figures keep their room and the text columns share the rest by weight.
   */
  private columnLayout(table: ReportTable) {
    const weights = table.columns.map((c) => c.weight ?? DEFAULT_WEIGHT[c.kind]);
    const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);
    const total = sum(weights);
    const need = table.columns.map((c, i) => {
      const words = c.label
        .split(/\s+/)
        .map((w) => textWidth(this.doc, w, { font: BOLD, size: TABLE_SIZE }));
      const cells = table.rows.map(
        (r) =>
          textWidth(this.doc, formatCell(r.cells[i] ?? null, c.kind, this.currency), {
            font: (r.style ?? "normal") === "normal" ? REGULAR : BOLD,
            size: TABLE_SIZE,
          }) + (i === 0 && r.indent ? 10 : 0),
      );
      return Math.max(0, ...words, ...cells) + 2 * CELL_PAD + 1;
    });
    let widths = weights.map((w) => (w / total) * WIDTH);
    const short = sum(widths.map((w, i) => Math.max(0, need[i]! - w)));
    if (short > 0) {
      const slack = widths.map((w, i) => Math.max(0, w - need[i]!));
      if (sum(slack) >= short) {
        const take = short / sum(slack);
        widths = widths.map((w, i) => (need[i]! > w ? need[i]! : w - slack[i]! * take));
      } else {
        const text = table.columns.map((c) => c.kind === "text");
        const fixed = sum(widths.map((w, i) => (text[i] ? 0 : Math.max(w, need[i]!))));
        const textWeight = sum(weights.filter((_, i) => text[i]));
        const rest = Math.max(0, WIDTH - fixed);
        widths = widths.map((w, i) =>
          text[i] ? (weights[i]! / textWeight) * rest : Math.max(w, need[i]!),
        );
        // Never wider than the page: scale everything down when even the figures are too wide.
        const scale = Math.min(1, WIDTH / sum(widths));
        widths = widths.map((w) => w * scale);
      }
    }
    let x = MARGIN.left;
    return table.columns.map((c, i) => {
      const width = widths[i]!;
      const col = { x, width, kind: c.kind, align: alignOf(c.kind) };
      x += width;
      return col;
    });
  }

  /** Header labels, on two lines where a column is too narrow for one. */
  private headerLines(table: ReportTable, cols: ReturnType<Writer["columnLayout"]>) {
    return table.columns.map((c, i) => {
      const lines = this.wrap(c.label, cols[i]!.width - 2 * CELL_PAD, BOLD, TABLE_SIZE);
      return lines.length <= 2 ? lines : [lines[0]!, lines.slice(1).join(" ")];
    });
  }

  private tableHeader(table: ReportTable, cols: ReturnType<Writer["columnLayout"]>) {
    const labels = this.headerLines(table, cols);
    const height = labels.some((l) => l.length > 1) ? HEADER_ROW + LINE_STEP : HEADER_ROW;
    this.doc.rect(MARGIN.left, this.y, WIDTH, height).fill(this.primary);
    labels.forEach((lines, i) => {
      const col = cols[i]!;
      lines.forEach((text, k) => {
        this.line(text, col.x + CELL_PAD, this.y + 5 + k * LINE_STEP, col.width - 2 * CELL_PAD, {
          font: BOLD,
          size: TABLE_SIZE,
          color: "#FFFFFF",
          align: col.align,
        });
      });
    });
    this.y += height;
  }

  private table(table: ReportTable) {
    const cols = this.columnLayout(table);
    // The title, header and at least two rows stay together.
    this.ensure(18 + HEADER_ROW + LINE_STEP + ROW * Math.min(2, Math.max(table.rows.length, 1)));
    this.y += 4;
    this.line(table.title, MARGIN.left, this.y, WIDTH, { font: BOLD, size: 9.5 });
    this.y += 14;
    this.tableHeader(table, cols);

    if (table.rows.length === 0) {
      this.line(table.empty, MARGIN.left + CELL_PAD, this.y + 4, WIDTH, {
        font: ITALIC,
        size: TABLE_SIZE,
        color: MUTED,
      });
      this.y += ROW + 6;
      return;
    }

    let zebra = false;
    for (const row of table.rows) {
      if (this.ensure(ROW)) {
        this.line(`${table.title} (continued)`, MARGIN.left, this.y, WIDTH, {
          size: 7.5,
          color: MUTED,
        });
        this.y += 12;
        this.tableHeader(table, cols);
        zebra = false;
      }
      this.row(row, cols, zebra);
      zebra = row.style === "normal" || row.style === undefined ? !zebra : false;
    }
    this.y += 8;
  }

  private row(row: ReportRow, cols: ReturnType<Writer["columnLayout"]>, zebra: boolean) {
    const style = row.style ?? "normal";
    if (style === "heading") {
      this.doc.rect(MARGIN.left, this.y, WIDTH, ROW).fill(tint(this.primary, 0.88));
    } else if (zebra) {
      this.doc.rect(MARGIN.left, this.y, WIDTH, ROW).fill(ZEBRA);
    }
    if (style === "subtotal" || style === "total") {
      this.rule(this.y + 0.5, style === "total" ? INK : RULE, style === "total" ? 0.8 : 0.5);
    }
    const bold = style !== "normal";
    cols.forEach((col, i) => {
      const indent = i === 0 && row.indent ? 10 : 0;
      this.line(
        formatCell(row.cells[i] ?? null, col.kind, this.currency),
        col.x + CELL_PAD + indent,
        this.y + 4,
        col.width - 2 * CELL_PAD - indent,
        { font: bold ? BOLD : REGULAR, size: TABLE_SIZE, align: col.align },
      );
    });
    this.y += ROW;
  }
}

/**
 * The report as a PDF file, with the company's logo when given. `compress: false`
 * keeps the page text readable (tests).
 */
export async function renderPdf(
  report: ReportDocument,
  options: { compress?: boolean; logo?: Buffer | null } = {},
): Promise<Buffer> {
  const doc = await createPdf({
    size: "A4",
    margins: MARGIN,
    bufferPages: true,
    compress: options.compress ?? true,
    info: {
      Title: pdfInfo(`${report.company.name}: ${report.title}`),
      Author: pdfInfo(report.generatedBy),
      Subject: pdfInfo(report.period.label),
      Creator: "Extas ERP",
      Producer: "Extas ERP",
      CreationDate: new Date(report.generatedAt),
    },
  });
  const done = collectPdf(doc);
  const writer = new Writer(doc, report, options.logo ?? null);
  writer.header();
  for (const section of report.sections) writer.section(section);
  writer.footers();
  doc.end();
  return done;
}
