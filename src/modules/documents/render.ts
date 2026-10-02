import PDFDocument from "pdfkit";

import { collectPdf, fitText, pdfText, safeHex, tint, wrapText } from "@/lib/pdf";
import type { Align, Block, Column, PrintDocument, Row, RowStyle } from "@/modules/documents/model";

/*
 * Lays a printed document out on the company letterhead: A4 portrait, the logo,
 * name and contact details on top of the first page (a slim header on the pages
 * after it), the footer line and page numbers at the bottom of every page.
 *
 * The look follows the brand: the company colour (dark green by default) for the
 * name, titles, rules and table headers, the accent colour (deep red) for a fine
 * line under the letterhead and for VOID / CANCELLED marks, Times for the name
 * and titles, Helvetica for everything else, on plain white paper so it prints
 * well. Text is placed line by line (cut with "…" when it cannot wrap), tables
 * repeat their header on every page, and nothing is ever drawn past the margins.
 */

const PAGE = { width: 595.28, height: 841.89 }; // A4 in points
const MARGIN = { top: 36, bottom: 60, left: 46, right: 46 };
const WIDTH = PAGE.width - MARGIN.left - MARGIN.right;
const BOTTOM = PAGE.height - MARGIN.bottom;

const SERIF_BOLD = "Times-Bold";
const SANS = "Helvetica";
const SANS_BOLD = "Helvetica-Bold";
const SANS_ITALIC = "Helvetica-Oblique";

const INK = "#1F2933";
const MUTED = "#6B7280";
const HAIRLINE = "#D5DBD8";
const ZEBRA = "#F7F8F7";
const WHITE = "#FFFFFF";
const DEFAULT_PRIMARY = "#0B3D2E";
const DEFAULT_ACCENT = "#BE1434";

const LOGO_BOX = { width: 150, height: 52 };

const CELL_PAD = 5;
const TABLE_SIZE = 8.2;
const TABLE_LINE = 10.8;
const DETAIL_SIZE = 7;
const DETAIL_LINE = 9.4;
const TABLE_HEADER = 18;
const MAX_CELL_LINES = 8;

type TextStyle = {
  font: string;
  size: number;
  color?: string;
  align?: Align;
  /** Letter spacing in points. */
  spacing?: number;
};

type ColumnBox = { x: number; width: number; align: Align };

/** pdfkit's opened image (its type definitions leave openImage out). */
type OpenedImage = { width: number; height: number; orientation?: number };
type PdfImages = {
  openImage(src: Buffer): OpenedImage;
  image(src: OpenedImage, x: number, y: number, options: { width: number; height: number }): void;
};

class Writer {
  private y = MARGIN.top;
  private readonly primary: string;
  private readonly accent: string;

  constructor(
    private readonly doc: PDFKit.PDFDocument,
    private readonly model: PrintDocument,
    private readonly logo: Buffer | null,
  ) {
    this.primary = safeHex(model.letterhead.primaryColor, DEFAULT_PRIMARY);
    this.accent = safeHex(model.letterhead.accentColor, DEFAULT_ACCENT);
  }

  // --- Primitives -----------------------------------------------------------

  /** One line of text in a box `width` wide, cut to fit; returns the width drawn. */
  private line(text: string, x: number, y: number, width: number, style: TextStyle): number {
    const doc = this.doc;
    const spacing = style.spacing ?? 0;
    doc
      .font(style.font)
      .fontSize(style.size)
      .fillColor(style.color ?? INK);
    const fitted = fitText(doc, text, width, spacing);
    if (!fitted) return 0;
    const drawn = doc.widthOfString(fitted, { characterSpacing: spacing });
    const dx =
      style.align === "right" ? width - drawn : style.align === "center" ? (width - drawn) / 2 : 0;
    doc.text(fitted, x + dx, y, { lineBreak: false, characterSpacing: spacing });
    return drawn;
  }

  private rule(y: number, color: string, weight: number, x = MARGIN.left, length = WIDTH) {
    this.doc
      .moveTo(x, y)
      .lineTo(x + length, y)
      .lineWidth(weight)
      .strokeColor(color)
      .stroke();
  }

  /** Lines of `text` (kept paragraphs: one per "\n") at most `width` wide. */
  private wrap(text: string, width: number, font: string, size: number): string[] {
    return text
      .split(/\r?\n/)
      .flatMap((part) => (part.trim() ? wrapText(this.doc, part, width, font, size) : [""]));
  }

  /** Starts a new page with the slim header when `height` does not fit; true if it did. */
  private ensure(height: number): boolean {
    if (this.y + height <= BOTTOM) return false;
    this.newPage();
    return true;
  }

  private newPage() {
    this.doc.addPage();
    this.continuationHeader();
  }

  /** Uppercase small label with letter spacing (section and column headings). */
  private label(text: string, x: number, y: number, width: number, color = MUTED, align?: Align) {
    this.line(text.toUpperCase(), x, y, width, {
      font: SANS_BOLD,
      size: 6.8,
      color,
      spacing: 1.1,
      align,
    });
  }

  // --- Letterhead -------------------------------------------------------------

  /** Logo, name and contact details across the top of the first page. */
  letterhead() {
    const { letterhead } = this.model;
    const top = MARGIN.top;
    const nameColumn = WIDTH * 0.6;
    let nameX = MARGIN.left;
    let logoHeight = 0;

    if (this.logo) {
      // Always a Buffer: given a string, pdfkit would read it as a file path.
      const image = (this.doc as unknown as PdfImages).openImage(this.logo);
      const rotated = (image.orientation ?? 1) > 4;
      const width = rotated ? image.height : image.width;
      const height = rotated ? image.width : image.height;
      const scale = Math.min(LOGO_BOX.width / width, LOGO_BOX.height / height);
      const drawnWidth = width * scale;
      logoHeight = height * scale;
      (this.doc as unknown as PdfImages).image(image, MARGIN.left, top, {
        width: drawnWidth,
        height: logoHeight,
      });
      nameX = MARGIN.left + drawnWidth + 14;
    }

    const showLegal = Boolean(letterhead.legalName && letterhead.legalName !== letterhead.name);
    const nameBlock = showLegal ? 34 : 22;
    const nameTop = top + Math.max(0, (logoHeight - nameBlock) / 2);
    const nameWidth = MARGIN.left + nameColumn - nameX;
    this.line(letterhead.name, nameX, nameTop, nameWidth, {
      font: SERIF_BOLD,
      size: 20,
      color: this.primary,
    });
    if (showLegal) {
      this.line(letterhead.legalName!.toUpperCase(), nameX, nameTop + 25, nameWidth, {
        font: SANS,
        size: 6.8,
        color: MUTED,
        spacing: 1.3,
      });
    }

    const contactX = MARGIN.left + nameColumn + 10;
    const contactWidth = WIDTH - nameColumn - 10;
    let contactY = top + 2;
    for (const contact of letterhead.contacts) {
      for (const text of this.wrap(contact, contactWidth, SANS, 7.6).slice(0, 2)) {
        this.line(text, contactX, contactY, contactWidth, {
          font: SANS,
          size: 7.6,
          color: MUTED,
          align: "right",
        });
        contactY += 10.6;
      }
    }

    const bottom = Math.max(top + logoHeight, nameTop + nameBlock, contactY);
    const ruleY = bottom + 9;
    this.rule(ruleY, this.primary, 1.3);
    this.rule(ruleY + 3.4, this.accent, 0.8, MARGIN.left, 64);
    this.y = ruleY + 22;
  }

  /** Pages after the first: the name and the document's title, with one rule. */
  private continuationHeader() {
    const top = MARGIN.top;
    const { letterhead, title, reference } = this.model;
    this.line(letterhead.name, MARGIN.left, top, WIDTH * 0.55, {
      font: SERIF_BOLD,
      size: 11.5,
      color: this.primary,
    });
    const right = [title, reference].filter(Boolean).join(" · ");
    this.line(right, MARGIN.left + WIDTH * 0.55, top + 2.5, WIDTH * 0.45, {
      font: SANS,
      size: 7.5,
      color: MUTED,
      align: "right",
    });
    this.rule(top + 18, this.primary, 0.8);
    this.y = top + 32;
  }

  /** The footer line on every page, with the reference and "Page 2 of 3" on documents. */
  footers() {
    const range = this.doc.bufferedPageRange();
    const y = PAGE.height - MARGIN.bottom + 18;
    const { letterhead, reference, type } = this.model;
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);
      this.rule(y - 8, HAIRLINE, 0.6);
      if (type === "LETTERHEAD") {
        this.line(letterhead.footer, MARGIN.left, y, WIDTH, {
          font: SANS,
          size: 7.2,
          color: MUTED,
          align: "center",
          spacing: 0.2,
        });
        continue;
      }
      this.line(letterhead.footer, MARGIN.left, y, WIDTH * 0.62, {
        font: SANS,
        size: 7,
        color: MUTED,
      });
      const page = range.count > 1 ? `Page ${i - range.start + 1} of ${range.count}` : "";
      this.line(
        [reference, page].filter(Boolean).join(" · "),
        MARGIN.left + WIDTH * 0.62,
        y,
        WIDTH * 0.38,
        { font: SANS, size: 7, color: MUTED, align: "right" },
      );
    }
  }

  /** A faint diagonal VOID / CANCELLED across every page. */
  watermarks() {
    const stamp = this.model.stamp;
    if (stamp?.tone !== "danger") return;
    const range = this.doc.bufferedPageRange();
    const size = 96;
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);
      const text = pdfText(stamp.text.toUpperCase());
      this.doc.save();
      this.doc.font(SANS_BOLD).fontSize(size);
      const width = this.doc.widthOfString(text, { characterSpacing: 6 });
      const cx = PAGE.width / 2;
      const cy = PAGE.height / 2;
      this.doc.rotate(-32, { origin: [cx, cy] });
      this.doc.fillColor(this.accent).fillOpacity(0.07);
      this.doc.text(text, cx - width / 2, cy - size * 0.36, {
        lineBreak: false,
        characterSpacing: 6,
      });
      this.doc.restore();
    }
  }

  // --- Title, details and parties --------------------------------------------

  titleBlock() {
    const { title, subtitle, stamp, meta } = this.model;
    const top = this.y;
    const leftWidth = WIDTH * 0.56;

    const stampText = stamp ? pdfText(stamp.text.toUpperCase()) : "";
    this.doc.font(SANS_BOLD).fontSize(7.5);
    const badgeWidth = stamp
      ? this.doc.widthOfString(stampText, { characterSpacing: 1.2 }) + 12
      : 0;
    const room = leftWidth - (stamp ? badgeWidth + 12 : 0);

    // 19 pt, or smaller for a long title so it fits beside the badge.
    const titleText = title.toUpperCase();
    const spacingFor = (size: number) => size * 0.115;
    let size = 19;
    this.doc.font(SERIF_BOLD);
    const widthAt = (s: number) =>
      this.doc.fontSize(s).widthOfString(pdfText(titleText), { characterSpacing: spacingFor(s) });
    while (size > 12 && widthAt(size) > room) size -= 0.5;
    const titleWidth = this.line(titleText, MARGIN.left, top + (19 - size) * 0.55, room, {
      font: SERIF_BOLD,
      size,
      color: this.primary,
      spacing: spacingFor(size),
    });
    if (stamp) {
      const color = stamp.tone === "danger" ? this.accent : this.primary;
      const x = MARGIN.left + titleWidth + 12;
      this.doc
        .roundedRect(x, top + 2.5, badgeWidth, 15, 2)
        .lineWidth(0.9)
        .strokeColor(color)
        .stroke();
      this.line(stampText, x + 6, top + 6.5, badgeWidth - 10, {
        font: SANS_BOLD,
        size: 7.5,
        color,
        spacing: 1.2,
      });
    }
    let leftY = top + 25;
    if (subtitle) {
      for (const text of this.wrap(subtitle, leftWidth, SANS, 9.5).slice(0, 2)) {
        this.line(text, MARGIN.left, leftY, leftWidth, { font: SANS, size: 9.5 });
        leftY += 12.5;
      }
    }

    const boxX = MARGIN.left + WIDTH * 0.58;
    const boxWidth = WIDTH * 0.42;
    const labelWidth = boxWidth * 0.42;
    let rightY = top + 2;
    for (const { label, value } of meta) {
      this.label(label, boxX, rightY + 1.5, labelWidth);
      this.line(value, boxX + labelWidth, rightY, boxWidth - labelWidth, {
        font: SANS_BOLD,
        size: 8.8,
        align: "right",
      });
      rightY += 13.5;
    }
    this.y = Math.max(leftY, rightY) + 12;
  }

  parties() {
    const { parties } = this.model;
    if (parties.length === 0) return;
    const gap = 12;
    // At most half the page wide, so a single address does not stretch across.
    const columns = Math.max(2, parties.length);
    const width = (WIDTH - gap * (columns - 1)) / columns;
    const inner = width - 20;
    const boxes = parties.map((p) => {
      const lines: Array<{ text: string; strong: boolean }> = [];
      p.lines.forEach((text, i) => {
        const font = i === 0 ? SANS_BOLD : SANS;
        const size = i === 0 ? 9.5 : 8.2;
        for (const l of this.wrap(text, inner, font, size))
          lines.push({ text: l, strong: i === 0 });
      });
      return { heading: p.heading, lines: lines.slice(0, 9) };
    });
    const height =
      Math.max(...boxes.map((b) => b.lines.reduce((h, l) => h + (l.strong ? 13 : 11.2), 0)), 11) +
      30;
    this.ensure(height);
    boxes.forEach((box, i) => {
      const x = MARGIN.left + i * (width + gap);
      this.doc.roundedRect(x, this.y, width, height, 3).fill(tint(this.primary, 0.95));
      this.doc.rect(x, this.y, 2, height).fill(this.primary);
      this.label(box.heading, x + 12, this.y + 9, inner);
      let ly = this.y + 22;
      for (const l of box.lines) {
        this.line(l.text, x + 12, ly, inner, {
          font: l.strong ? SANS_BOLD : SANS,
          size: l.strong ? 9.5 : 8.2,
        });
        ly += l.strong ? 13 : 11.2;
      }
    });
    this.y += height + 16;
  }

  // --- Blocks -----------------------------------------------------------------

  block(block: Block) {
    switch (block.kind) {
      case "table":
        return this.table(block);
      case "totals":
        return this.totals(block);
      case "figures":
        return this.figures(block);
      case "text":
        return this.text(block);
      case "list":
        return this.list(block);
      case "note":
        return this.note(block.text);
      case "pageBreak":
        return this.newPage();
    }
  }

  private sectionTitle(title: string) {
    this.label(title, MARGIN.left, this.y, WIDTH, this.primary);
    this.y += 13;
  }

  private columnBoxes(columns: Column[]): ColumnBox[] {
    const total = columns.reduce((sum, c) => sum + (c.weight ?? 1), 0);
    let x = MARGIN.left;
    return columns.map((c) => {
      const width = ((c.weight ?? 1) / total) * WIDTH;
      const box = { x, width, align: c.align ?? "left" };
      x += width;
      return box;
    });
  }

  private tableHeader(columns: Column[], boxes: ColumnBox[]) {
    this.doc.rect(MARGIN.left, this.y, WIDTH, TABLE_HEADER).fill(this.primary);
    columns.forEach((c, i) => {
      const box = boxes[i]!;
      this.line(c.label, box.x + CELL_PAD, this.y + 5.6, box.width - 2 * CELL_PAD, {
        font: SANS_BOLD,
        size: 7.4,
        color: WHITE,
        align: box.align,
        spacing: 0.3,
      });
    });
    this.y += TABLE_HEADER;
  }

  /** What a row prints in each column, and its height. */
  private layoutRow(row: Row, boxes: ColumnBox[], detailColumn: number) {
    const bold = (row.style ?? "normal") !== "normal";
    const font = bold ? SANS_BOLD : SANS;
    const cells = boxes.map((box, i) => {
      const indent = i === 0 && row.swatch ? 11 : 0;
      const width = box.width - 2 * CELL_PAD - indent;
      const text = row.cells[i] ?? "";
      const lines =
        box.align === "left"
          ? this.wrap(text, width, font, TABLE_SIZE).slice(0, MAX_CELL_LINES)
          : [text];
      const details =
        i === detailColumn
          ? (row.details ?? [])
              .flatMap((d) => this.wrap(d, width, SANS, DETAIL_SIZE))
              .slice(0, MAX_CELL_LINES)
          : [];
      return { lines, details, indent, width };
    });
    const height =
      Math.max(
        ...cells.map(
          (c) =>
            c.lines.length * TABLE_LINE +
            c.details.length * DETAIL_LINE +
            (c.details.length ? 1.5 : 0),
        ),
        TABLE_LINE,
      ) +
      2 * CELL_PAD -
      1;
    return { cells, height, font };
  }

  private table(block: Extract<Block, { kind: "table" }>) {
    const boxes = this.columnBoxes(block.columns);
    // Details go under the widest left-aligned column (the description).
    let detailColumn = 0;
    boxes.forEach((b, i) => {
      if (b.align === "left" && b.width > boxes[detailColumn]!.width) detailColumn = i;
    });
    const layouts = block.rows.map((row) => this.layoutRow(row, boxes, detailColumn));
    const titleHeight = block.title ? 13 : 0;
    this.ensure(titleHeight + TABLE_HEADER + (layouts[0]?.height ?? 20));
    if (block.title) this.sectionTitle(block.title);
    this.tableHeader(block.columns, boxes);

    if (block.rows.length === 0) {
      this.line(block.empty ?? "Nothing to show.", MARGIN.left + CELL_PAD, this.y + 6, WIDTH, {
        font: SANS_ITALIC,
        size: TABLE_SIZE,
        color: MUTED,
      });
      this.y += 22;
      this.rule(this.y, HAIRLINE, 0.6);
      this.y += 14;
      return;
    }

    let shade = false;
    block.rows.forEach((row, index) => {
      const layout = layouts[index]!;
      if (this.ensure(layout.height)) {
        if (block.title) {
          this.line(`${block.title} (continued)`, MARGIN.left, this.y, WIDTH, {
            font: SANS,
            size: 7.4,
            color: MUTED,
          });
          this.y += 12;
        }
        this.tableHeader(block.columns, boxes);
        shade = false;
      }
      const style: RowStyle = row.style ?? "normal";
      this.row(row, layout, boxes, style === "normal" && shade);
      // Every other plain row is shaded; a subtotal or total starts the pattern again.
      shade = style === "normal" ? !shade : false;
    });
    this.rule(this.y, HAIRLINE, 0.6);
    this.y += 12;
  }

  private row(
    row: Row,
    layout: ReturnType<Writer["layoutRow"]>,
    boxes: ColumnBox[],
    shaded: boolean,
  ) {
    const style = row.style ?? "normal";
    const top = this.y;
    if (shaded) this.doc.rect(MARGIN.left, top, WIDTH, layout.height).fill(ZEBRA);
    if (style !== "normal") {
      this.rule(
        top + 0.4,
        style === "total" ? this.primary : HAIRLINE,
        style === "total" ? 1 : 0.6,
      );
    }
    layout.cells.forEach((cell, i) => {
      const box = boxes[i]!;
      const x = box.x + CELL_PAD + cell.indent;
      if (i === 0 && row.swatch) {
        const color = safeHex(row.swatch, "#FFFFFF");
        this.doc
          .rect(box.x + CELL_PAD, top + CELL_PAD + 1.2, 7, 7)
          .lineWidth(0.5)
          .fillAndStroke(color, "#9AA5A0");
      }
      let ly = top + CELL_PAD;
      for (const text of cell.lines) {
        this.line(text, x, ly, cell.width, {
          font: layout.font,
          size: TABLE_SIZE,
          align: box.align,
        });
        ly += TABLE_LINE;
      }
      if (cell.details.length) ly += 1.5;
      for (const text of cell.details) {
        this.line(text, x, ly, cell.width, { font: SANS, size: DETAIL_SIZE, color: MUTED });
        ly += DETAIL_LINE;
      }
    });
    this.y += layout.height;
  }

  private totals(block: Extract<Block, { kind: "totals" }>) {
    const width = 236;
    const x = MARGIN.left + WIDTH - width;
    const height = block.rows.reduce((h, r) => h + (r.strong ? 19 : 14.5), 0) + 4;
    const words = block.words ? this.wrap(`In words: ${block.words}`, WIDTH, SANS_ITALIC, 8) : [];
    this.ensure(height + words.length * 11 + 6);
    let y = this.y;
    for (const r of block.rows) {
      if (r.strong) {
        this.rule(y + 1, this.primary, 0.9, x, width);
        y += 5;
        this.line(r.label, x + 4, y, width * 0.5, { font: SANS_BOLD, size: 9.4 });
        this.line(r.value, x + width * 0.4, y - 0.5, width * 0.6 - 4, {
          font: SANS_BOLD,
          size: 10,
          color: this.primary,
          align: "right",
        });
        y += 14;
      } else {
        this.line(r.label, x + 4, y, width * 0.55, { font: SANS, size: 8.4, color: MUTED });
        this.line(r.value, x + width * 0.4, y, width * 0.6 - 4, {
          font: SANS,
          size: 8.4,
          align: "right",
        });
        y += 14.5;
      }
    }
    this.y = y + 4;
    for (const text of words) {
      this.line(text, MARGIN.left, this.y, WIDTH, { font: SANS_ITALIC, size: 8 });
      this.y += 11;
    }
    this.y += 12;
  }

  private figures(block: Extract<Block, { kind: "figures" }>) {
    const perRow = Math.min(4, block.figures.length);
    const gap = 8;
    const width = (WIDTH - gap * (perRow - 1)) / perRow;
    const height = 54;
    for (let i = 0; i < block.figures.length; i += perRow) {
      this.ensure(height + gap);
      block.figures.slice(i, i + perRow).forEach((f, j) => {
        const x = MARGIN.left + j * (width + gap);
        this.doc.roundedRect(x, this.y, width, height, 3).fill(tint(this.primary, 0.94));
        this.label(f.label, x + 9, this.y + 9, width - 18);
        this.line(f.value, x + 9, this.y + 21, width - 18, { font: SERIF_BOLD, size: 13.5 });
        if (f.hint) {
          this.line(f.hint, x + 9, this.y + 39, width - 18, {
            font: SANS,
            size: 6.8,
            color: MUTED,
          });
        }
      });
      this.y += height + gap;
    }
    this.y += 8;
  }

  private text(block: Extract<Block, { kind: "text" }>) {
    const lines = block.paragraphs.flatMap((p) => this.wrap(p, WIDTH, SANS, 8.4));
    this.ensure(13 + Math.min(lines.length, 3) * 11.8);
    this.sectionTitle(block.title);
    for (const text of lines) {
      if (!text) {
        this.y += 4;
        continue;
      }
      this.ensure(11.8);
      this.line(text, MARGIN.left, this.y, WIDTH, { font: SANS, size: 8.4 });
      this.y += 11.8;
    }
    this.y += 10;
  }

  /** "• Collar & cuff: the golden colour should be a little brighter", wrapped under the bullet. */
  private list(block: Extract<Block, { kind: "list" }>) {
    const indent = 12;
    const width = WIDTH - indent;
    const items = block.items.map((item) => {
      const label = item.label ? pdfText(`${item.label}:`) : "";
      this.doc.font(SANS_BOLD).fontSize(8.4);
      const labelWidth = label ? this.doc.widthOfString(label) + 4 : 0;
      // The first line leaves room for the bold label; the rest use the full width.
      const words = pdfText(item.text).split(" ").filter(Boolean);
      this.doc.font(SANS).fontSize(8.4);
      const lines: string[] = [];
      let current = "";
      for (const word of words) {
        const limit = lines.length === 0 ? width - labelWidth : width;
        const next = current ? `${current} ${word}` : word;
        if (current && this.doc.widthOfString(next) > limit) {
          lines.push(current);
          current = word;
        } else {
          current = next;
        }
      }
      if (current || lines.length === 0) lines.push(current);
      return { label, labelWidth, lines };
    });
    this.ensure(13 + 11.8 * Math.min(2, items[0]?.lines.length ?? 1));
    this.sectionTitle(block.title);
    for (const item of items) {
      this.ensure(item.lines.length * 11.8);
      this.line("•", MARGIN.left + 2, this.y, 8, {
        font: SANS_BOLD,
        size: 8.4,
        color: this.primary,
      });
      item.lines.forEach((text, i) => {
        let x = MARGIN.left + indent;
        let room = width;
        if (i === 0 && item.label) {
          this.line(item.label, x, this.y, width, { font: SANS_BOLD, size: 8.4 });
          x += item.labelWidth;
          room -= item.labelWidth;
        }
        this.line(text, x, this.y, room, { font: SANS, size: 8.4 });
        this.y += 11.8;
      });
      this.y += 2;
    }
    this.y += 8;
  }

  private note(text: string) {
    const lines = this.wrap(text, WIDTH, SANS_ITALIC, 7.4);
    for (const l of lines) {
      this.ensure(10);
      this.line(l, MARGIN.left, this.y, WIDTH, { font: SANS_ITALIC, size: 7.4, color: MUTED });
      this.y += 10;
    }
    this.y += 8;
  }

  /** Signature lines near the bottom of the last page. */
  signatures() {
    const labels = this.model.signatures;
    if (labels.length === 0) return;
    if (this.y + 60 > BOTTOM) this.newPage();
    const y = Math.max(this.y + 40, BOTTOM - 34);
    const gap = 40;
    const width = Math.min(170, (WIDTH - gap * (labels.length - 1)) / labels.length);
    labels.forEach((label, i) => {
      // One line sits on the right; two or more spread across the page.
      const x =
        labels.length === 1
          ? MARGIN.left + WIDTH - width
          : MARGIN.left + (i * (WIDTH - width)) / (labels.length - 1);
      this.rule(y, INK, 0.6, x, width);
      this.line(label, x, y + 5, width, { font: SANS, size: 7.4, color: MUTED, align: "center" });
    });
    this.y = y + 20;
  }
}

/** The document as a PDF on letterhead. `compress: false` keeps the page text readable (tests). */
export async function renderDocumentPdf(
  model: PrintDocument,
  options: { logo?: Buffer | null; compress?: boolean } = {},
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: MARGIN,
    bufferPages: true,
    compress: options.compress ?? true,
    info: {
      Title: pdfText(
        [model.letterhead.name, model.title, model.reference].filter(Boolean).join(" - "),
      ),
      Author: pdfText(model.letterhead.name),
      Subject: pdfText(model.title || "Letterhead"),
      Creator: "Extras ERP",
      Producer: "Extras ERP",
    },
  });
  const done = collectPdf(doc);
  const writer = new Writer(doc, model, options.logo ?? null);
  writer.letterhead();
  if (model.type !== "LETTERHEAD") {
    writer.titleBlock();
    writer.parties();
    for (const block of model.blocks) writer.block(block);
    writer.signatures();
  }
  writer.watermarks();
  writer.footers();
  doc.end();
  return done;
}
