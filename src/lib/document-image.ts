import { safeHex, tint } from "@/lib/colors";
import type { Align, Block, Column, PrintDocument, Row } from "@/modules/documents/model";

/*
 * Draws a printed document as one tall picture in the browser (a canvas saved
 * as JPG), to share an invoice's page 1 on WhatsApp without a screenshot and
 * without making a file on the server. It follows the PDF writer's layout
 * (documents/render.ts): the letterhead with the logo, the title and details,
 * the address boxes, tables, totals, figures and notes, signature lines, the
 * footer line and a VOID mark, in the app's own fonts (Bengali included), on
 * white. Measured once to find the height, then drawn at about 2.5x for a sharp
 * picture on a phone.
 */

const PAGE_WIDTH = 595.28; // A4 width in points, like the PDF
const MARGIN = { top: 36, left: 46, right: 46 };
const WIDTH = PAGE_WIDTH - MARGIN.left - MARGIN.right;

const INK = "#1F2933";
const MUTED = "#6B7280";
const HAIRLINE = "#D5DBD8";
const ZEBRA = "#F7F8F7";
const WHITE = "#FFFFFF";
const DEFAULT_PRIMARY = "#0B3D2E";
const DEFAULT_ACCENT = "#BE1434";
/** A ticked box in a `check` column (TICK in documents/model.ts). */
const TICK = "✓";

const LOGO_BOX = { width: 150, height: 52 };
const CELL_PAD = 5;
const TABLE_SIZE = 8.2;
const TABLE_LINE = 10.8;
const DETAIL_SIZE = 7;
const DETAIL_LINE = 9.4;
const TABLE_HEADER = 18;
const MAX_CELL_LINES = 8;

/** Browsers refuse larger canvases (iOS Safari's limit is about 16.7 million pixels). */
const MAX_PIXELS = 16_000_000;
const MAX_SIDE = 16_000;

type Face = "sans" | "sansBold" | "sansItalic" | "serifBold";
type Style = { face: Face; size: number; color?: string; align?: Align; spacing?: number };
type Fonts = { sans: string; serif: string };
type ColumnBox = { x: number; width: number; align: Align; check: boolean };

/** The font family a Tailwind class gives (font-sans, font-serif) on this page. */
function familyOf(className: string, fallback: string): string {
  const probe = document.createElement("span");
  probe.className = className;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.body.append(probe);
  const family = getComputedStyle(probe).fontFamily;
  probe.remove();
  return family || fallback;
}

class Painter {
  y = MARGIN.top;
  private readonly primary: string;
  private readonly accent: string;
  private readonly spacing: boolean;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly model: PrintDocument,
    private readonly logo: HTMLImageElement | null,
    private readonly fonts: Fonts,
    /** false: only measure, to learn the height. */
    private readonly draw: boolean,
  ) {
    this.primary = safeHex(model.letterhead.primaryColor, DEFAULT_PRIMARY);
    this.accent = safeHex(model.letterhead.accentColor, DEFAULT_ACCENT);
    this.spacing = "letterSpacing" in ctx;
    ctx.textBaseline = "top";
  }

  // --- Primitives -----------------------------------------------------------

  private use(style: Style) {
    const family = style.face === "serifBold" ? this.fonts.serif : this.fonts.sans;
    const weight = style.face === "sans" || style.face === "sansItalic" ? 400 : 700;
    const italic = style.face === "sansItalic" ? "italic " : "";
    this.ctx.font = `${italic}${weight} ${style.size}px ${family}`;
    if (this.spacing) {
      (this.ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
        `${style.spacing ?? 0}px`;
    }
  }

  private measure(text: string, style: Style): number {
    this.use(style);
    return this.ctx.measureText(text).width;
  }

  /** The text cut with "…" to fit `width` ("" when not even that fits). */
  private fit(text: string, width: number, style: Style): string {
    const clean = text.replace(/\s+/g, " ").trim();
    if (this.measure(clean, style) <= width) return clean;
    const chars = [...clean];
    let low = 0;
    let high = chars.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.measure(`${chars.slice(0, mid).join("").trimEnd()}…`, style) <= width) low = mid;
      else high = mid - 1;
    }
    return low > 0 ? `${chars.slice(0, low).join("").trimEnd()}…` : "";
  }

  /** One line of text in a box `width` wide, cut to fit; returns the width drawn. */
  private line(text: string, x: number, y: number, width: number, style: Style): number {
    const fitted = this.fit(text, width, style);
    if (!fitted) return 0;
    const drawn = this.measure(fitted, style);
    if (this.draw) {
      const dx =
        style.align === "right"
          ? width - drawn
          : style.align === "center"
            ? (width - drawn) / 2
            : 0;
      this.ctx.fillStyle = style.color ?? INK;
      this.ctx.fillText(fitted, x + dx, y);
    }
    return drawn;
  }

  /** Lines of `text` at most `width` wide (one paragraph per "\n"; long words are cut). */
  private wrap(text: string, width: number, style: Style): string[] {
    const out: string[] = [];
    for (const part of text.split(/\r?\n/)) {
      const words = part.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
      if (words.length === 0) {
        out.push("");
        continue;
      }
      let current = "";
      for (const word of words) {
        const next = current ? `${current} ${word}` : word;
        if (this.measure(next, style) <= width) {
          current = next;
        } else {
          if (current) out.push(current);
          current = this.measure(word, style) <= width ? word : this.fit(word, width, style);
        }
      }
      if (current) out.push(current);
    }
    return out;
  }

  private rule(y: number, color: string, weight: number, x = MARGIN.left, length = WIDTH) {
    if (!this.draw) return;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y - weight / 2, length, weight);
  }

  private box(x: number, y: number, width: number, height: number, color: string, radius = 0) {
    if (!this.draw) return;
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.shape(x, y, width, height, radius);
    this.ctx.fill();
  }

  /** A rectangle path, with round corners where the browser draws them. */
  private shape(x: number, y: number, width: number, height: number, radius: number) {
    if (radius > 0 && "roundRect" in this.ctx) this.ctx.roundRect(x, y, width, height, radius);
    else this.ctx.rect(x, y, width, height);
  }

  private label(text: string, x: number, y: number, width: number, color = MUTED, align?: Align) {
    this.line(text.toUpperCase(), x, y, width, {
      face: "sansBold",
      size: 6.8,
      color,
      spacing: 1.1,
      align,
    });
  }

  // --- Letterhead, title and parties ------------------------------------------

  letterhead() {
    const { letterhead } = this.model;
    const top = MARGIN.top;
    const nameColumn = WIDTH * 0.6;
    let nameX = MARGIN.left;
    let logoHeight = 0;
    if (this.logo && this.logo.naturalWidth > 0) {
      const scale = Math.min(
        LOGO_BOX.width / this.logo.naturalWidth,
        LOGO_BOX.height / this.logo.naturalHeight,
      );
      const drawnWidth = this.logo.naturalWidth * scale;
      logoHeight = this.logo.naturalHeight * scale;
      if (this.draw) this.ctx.drawImage(this.logo, MARGIN.left, top, drawnWidth, logoHeight);
      nameX = MARGIN.left + drawnWidth + 14;
    }
    const showLegal = Boolean(letterhead.legalName && letterhead.legalName !== letterhead.name);
    const nameBlock = showLegal ? 34 : 22;
    const nameTop = top + Math.max(0, (logoHeight - nameBlock) / 2);
    const nameWidth = MARGIN.left + nameColumn - nameX;
    this.line(letterhead.name, nameX, nameTop, nameWidth, {
      face: "serifBold",
      size: 20,
      color: this.primary,
    });
    if (showLegal) {
      this.line(letterhead.legalName!.toUpperCase(), nameX, nameTop + 25, nameWidth, {
        face: "sans",
        size: 6.8,
        color: MUTED,
        spacing: 1.3,
      });
    }
    const contactX = MARGIN.left + nameColumn + 10;
    const contactWidth = WIDTH - nameColumn - 10;
    let contactY = top + 2;
    const contactStyle: Style = { face: "sans", size: 7.6, color: MUTED, align: "right" };
    const contactLines = (texts: string[]) => {
      for (const contact of texts) {
        for (const text of this.wrap(contact, contactWidth, contactStyle).slice(0, 2)) {
          this.line(text, contactX, contactY, contactWidth, contactStyle);
          contactY += 10.6;
        }
      }
    };
    contactLines(letterhead.contacts);
    const registrations = letterhead.registrations ?? [];
    if (registrations.length > 0) {
      if (letterhead.contacts.length > 0) contactY += 3;
      contactLines(registrations);
    }
    const bottom = Math.max(top + logoHeight, nameTop + nameBlock, contactY);
    const ruleY = bottom + 9;
    this.rule(ruleY, this.primary, 1.3);
    this.rule(ruleY + 3.4, this.accent, 0.8, MARGIN.left, 64);
    this.y = ruleY + 22;
  }

  titleBlock() {
    const { title, subtitle, stamp, meta } = this.model;
    const top = this.y;
    const leftWidth = WIDTH * 0.56;
    const stampText = stamp ? stamp.text.toUpperCase() : "";
    const stampStyle: Style = { face: "sansBold", size: 7.5, spacing: 1.2 };
    const badgeWidth = stamp ? this.measure(stampText, stampStyle) + 12 : 0;
    const room = leftWidth - (stamp ? badgeWidth + 12 : 0);
    const titleText = title.toUpperCase();
    const spacingFor = (size: number) => size * 0.115;
    let size = 19;
    while (
      size > 12 &&
      this.measure(titleText, { face: "serifBold", size, spacing: spacingFor(size) }) > room
    ) {
      size -= 0.5;
    }
    const titleWidth = this.line(titleText, MARGIN.left, top + (19 - size) * 0.55, room, {
      face: "serifBold",
      size,
      color: this.primary,
      spacing: spacingFor(size),
    });
    if (stamp) {
      const color = stamp.tone === "danger" ? this.accent : this.primary;
      const x = MARGIN.left + titleWidth + 12;
      if (this.draw) {
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 0.9;
        this.ctx.beginPath();
        this.shape(x, top + 2.5, badgeWidth, 15, 2);
        this.ctx.stroke();
      }
      this.line(stampText, x + 6, top + 6.5, badgeWidth - 10, { ...stampStyle, color });
    }
    let leftY = top + 25;
    if (subtitle) {
      const style: Style = { face: "sans", size: 9.5 };
      for (const text of this.wrap(subtitle, leftWidth, style).slice(0, 2)) {
        this.line(text, MARGIN.left, leftY, leftWidth, style);
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
        face: "sansBold",
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
    const columns = Math.max(2, parties.length);
    const width = (WIDTH - gap * (columns - 1)) / columns;
    const inner = width - 20;
    const boxes = parties.map((p) => {
      const lines: Array<{ text: string; strong: boolean }> = [];
      p.lines.forEach((text, i) => {
        const style: Style =
          i === 0 ? { face: "sansBold", size: 9.5 } : { face: "sans", size: 8.2 };
        for (const l of this.wrap(text, inner, style)) lines.push({ text: l, strong: i === 0 });
      });
      return { heading: p.heading, lines: lines.slice(0, 9) };
    });
    const height =
      Math.max(...boxes.map((b) => b.lines.reduce((h, l) => h + (l.strong ? 13 : 11.2), 0)), 11) +
      30;
    boxes.forEach((b, i) => {
      const x = MARGIN.left + i * (width + gap);
      this.box(x, this.y, width, height, tint(this.primary, 0.95), 3);
      this.box(x, this.y, 2, height, this.primary);
      this.label(b.heading, x + 12, this.y + 9, inner);
      let ly = this.y + 22;
      for (const l of b.lines) {
        this.line(
          l.text,
          x + 12,
          ly,
          inner,
          l.strong ? { face: "sansBold", size: 9.5 } : { face: "sans", size: 8.2 },
        );
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
      case "heading":
        return this.heading(block);
      case "signatures":
        return this.signatures(block.labels);
      case "pageBreak":
        // One picture has no pages: what follows is a new part, a little apart.
        this.y += 24;
        return;
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
      const b = { x, width, align: c.align ?? "left", check: c.check ?? false };
      x += width;
      return b;
    });
  }

  private layoutRow(row: Row, boxes: ColumnBox[], detailColumn: number) {
    const bold = (row.style ?? "normal") !== "normal";
    const face: Face = bold ? "sansBold" : "sans";
    const cells = boxes.map((b, i) => {
      const indent = i === 0 && row.swatch ? 11 : 0;
      const width = b.width - 2 * CELL_PAD - indent;
      const text = row.cells[i] ?? "";
      const lines =
        b.check && !bold
          ? []
          : b.align === "left"
            ? this.wrap(text, width, { face, size: TABLE_SIZE }).slice(0, MAX_CELL_LINES)
            : [text];
      const details =
        i === detailColumn
          ? (row.details ?? [])
              .flatMap((d) => this.wrap(d, width, { face: "sans", size: DETAIL_SIZE }))
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
    return { cells, height, face };
  }

  private table(block: Extract<Block, { kind: "table" }>) {
    const boxes = this.columnBoxes(block.columns);
    let detailColumn = 0;
    boxes.forEach((b, i) => {
      if (b.align === "left" && b.width > boxes[detailColumn]!.width) detailColumn = i;
    });
    if (block.title) this.sectionTitle(block.title);
    this.box(MARGIN.left, this.y, WIDTH, TABLE_HEADER, this.primary);
    block.columns.forEach((c, i) => {
      const b = boxes[i]!;
      this.line(c.label, b.x + CELL_PAD, this.y + 5.6, b.width - 2 * CELL_PAD, {
        face: "sansBold",
        size: 7.4,
        color: WHITE,
        align: b.align,
        spacing: 0.3,
      });
    });
    this.y += TABLE_HEADER;
    if (block.rows.length === 0) {
      this.line(block.empty ?? "Nothing to show.", MARGIN.left + CELL_PAD, this.y + 6, WIDTH, {
        face: "sansItalic",
        size: TABLE_SIZE,
        color: MUTED,
      });
      this.y += 22;
      this.rule(this.y, HAIRLINE, 0.6);
      this.y += 14;
      return;
    }
    let shade = false;
    for (const row of block.rows) {
      const layout = this.layoutRow(row, boxes, detailColumn);
      const style = row.style ?? "normal";
      const top = this.y;
      if (style === "normal" && shade) this.box(MARGIN.left, top, WIDTH, layout.height, ZEBRA);
      if (style !== "normal") {
        this.rule(
          top + 0.4,
          style === "total" ? this.primary : HAIRLINE,
          style === "total" ? 1 : 0.6,
        );
      }
      layout.cells.forEach((cell, i) => {
        const b = boxes[i]!;
        const x = b.x + CELL_PAD + cell.indent;
        if (b.check && style === "normal") {
          this.tickBox(b, top, row.cells[i] === TICK);
          return;
        }
        if (i === 0 && row.swatch && this.draw) {
          this.ctx.fillStyle = safeHex(row.swatch, "#FFFFFF");
          this.ctx.fillRect(b.x + CELL_PAD, top + CELL_PAD + 1.2, 7, 7);
          this.ctx.strokeStyle = "#9AA5A0";
          this.ctx.lineWidth = 0.5;
          this.ctx.strokeRect(b.x + CELL_PAD, top + CELL_PAD + 1.2, 7, 7);
        }
        let ly = top + CELL_PAD;
        for (const text of cell.lines) {
          this.line(text, x, ly, cell.width, {
            face: layout.face,
            size: TABLE_SIZE,
            align: b.align,
          });
          ly += TABLE_LINE;
        }
        if (cell.details.length) ly += 1.5;
        for (const text of cell.details) {
          this.line(text, x, ly, cell.width, { face: "sans", size: DETAIL_SIZE, color: MUTED });
          ly += DETAIL_LINE;
        }
      });
      this.y += layout.height;
      shade = style === "normal" ? !shade : false;
    }
    this.rule(this.y, HAIRLINE, 0.6);
    this.y += 12;
  }

  private tickBox(b: ColumnBox, top: number, ticked: boolean) {
    if (!this.draw) return;
    const size = 7;
    const x =
      b.align === "center"
        ? b.x + (b.width - size) / 2
        : b.align === "right"
          ? b.x + b.width - CELL_PAD - size
          : b.x + CELL_PAD;
    const y = top + CELL_PAD - 0.5;
    this.ctx.strokeStyle = INK;
    this.ctx.lineWidth = 0.6;
    this.ctx.strokeRect(x, y, size, size);
    if (ticked) {
      this.ctx.strokeStyle = this.primary;
      this.ctx.lineWidth = 1.2;
      this.ctx.beginPath();
      this.ctx.moveTo(x + 1.5, y + size * 0.52);
      this.ctx.lineTo(x + size * 0.42, y + size - 1.5);
      this.ctx.lineTo(x + size - 1.3, y + 1.4);
      this.ctx.stroke();
    }
  }

  private totals(block: Extract<Block, { kind: "totals" }>) {
    const width = 236;
    const x = MARGIN.left + WIDTH - width;
    const words = block.words
      ? this.wrap(`In words: ${block.words}`, WIDTH, { face: "sansItalic", size: 8 })
      : [];
    let y = this.y;
    for (const r of block.rows) {
      if (r.strong) {
        this.rule(y + 1, this.primary, 0.9, x, width);
        y += 5;
        this.line(r.label, x + 4, y, width * 0.5, { face: "sansBold", size: 9.4 });
        this.line(r.value, x + width * 0.4, y - 0.5, width * 0.6 - 4, {
          face: "sansBold",
          size: 10,
          color: this.primary,
          align: "right",
        });
        y += 14;
      } else {
        this.line(r.label, x + 4, y, width * 0.55, { face: "sans", size: 8.4, color: MUTED });
        this.line(r.value, x + width * 0.4, y, width * 0.6 - 4, {
          face: "sans",
          size: 8.4,
          align: "right",
        });
        y += 14.5;
      }
    }
    this.y = y + 4;
    for (const text of words) {
      this.line(text, MARGIN.left, this.y, WIDTH, { face: "sansItalic", size: 8 });
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
      block.figures.slice(i, i + perRow).forEach((f, j) => {
        const x = MARGIN.left + j * (width + gap);
        this.box(x, this.y, width, height, tint(this.primary, 0.94), 3);
        this.label(f.label, x + 9, this.y + 9, width - 18);
        this.line(f.value, x + 9, this.y + 21, width - 18, { face: "serifBold", size: 13.5 });
        if (f.hint) {
          this.line(f.hint, x + 9, this.y + 39, width - 18, {
            face: "sans",
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
    const style: Style = { face: "sans", size: 8.4 };
    this.sectionTitle(block.title);
    for (const text of block.paragraphs.flatMap((p) => this.wrap(p, WIDTH, style))) {
      if (!text) {
        this.y += 4;
        continue;
      }
      this.line(text, MARGIN.left, this.y, WIDTH, style);
      this.y += 11.8;
    }
    this.y += 10;
  }

  private list(block: Extract<Block, { kind: "list" }>) {
    const indent = 12;
    const style: Style = { face: "sans", size: 8.4 };
    this.sectionTitle(block.title);
    const width = WIDTH - indent;
    for (const item of block.items) {
      const label = item.label ? `${item.label}:` : "";
      const labelWidth = label ? this.measure(label, { face: "sansBold", size: 8.4 }) + 4 : 0;
      // The first line leaves room for the bold label; the rest use the full width.
      const lines: string[] = [];
      let current = "";
      for (const word of item.text.split(/\s+/).filter(Boolean)) {
        const limit = lines.length === 0 ? width - labelWidth : width;
        const next = current ? `${current} ${word}` : word;
        if (current && this.measure(next, style) > limit) {
          lines.push(current);
          current = word;
        } else {
          current = next;
        }
      }
      if (current || lines.length === 0) lines.push(current);
      this.line("•", MARGIN.left + 2, this.y, 8, {
        face: "sansBold",
        size: 8.4,
        color: this.primary,
      });
      lines.forEach((text, i) => {
        let x = MARGIN.left + indent;
        let room = width;
        if (i === 0 && label) {
          this.line(label, x, this.y, width, { face: "sansBold", size: 8.4 });
          x += labelWidth;
          room -= labelWidth;
        }
        this.line(text, x, this.y, room, style);
        this.y += 11.8;
      });
      this.y += 2;
    }
    this.y += 8;
  }

  private note(text: string) {
    const style: Style = { face: "sansItalic", size: 7.4, color: MUTED };
    for (const l of this.wrap(text, WIDTH, style)) {
      this.line(l, MARGIN.left, this.y, WIDTH, style);
      this.y += 10;
    }
    this.y += 8;
  }

  private heading(block: Extract<Block, { kind: "heading" }>) {
    this.line(block.title.toUpperCase(), MARGIN.left, this.y, WIDTH, {
      face: "serifBold",
      size: 15,
      color: this.primary,
      spacing: 1.7,
    });
    this.y += 21;
    if (block.subtitle) {
      const style: Style = { face: "sans", size: 9, color: MUTED };
      for (const text of this.wrap(block.subtitle, WIDTH, style).slice(0, 2)) {
        this.line(text, MARGIN.left, this.y, WIDTH, style);
        this.y += 12;
      }
    }
    this.rule(this.y + 2, this.primary, 0.8);
    this.y += 16;
  }

  /** Signature lines under what came before (a picture has no page foot to sit at). */
  signatures(labels: string[]) {
    if (labels.length === 0) return;
    const y = this.y + 40;
    const gap = 40;
    const width = Math.min(170, (WIDTH - gap * (labels.length - 1)) / labels.length);
    labels.forEach((label, i) => {
      const x =
        labels.length === 1
          ? MARGIN.left + WIDTH - width
          : MARGIN.left + (i * (WIDTH - width)) / (labels.length - 1);
      this.rule(y, INK, 0.6, x, width);
      this.line(label, x, y + 5, width, { face: "sans", size: 7.4, color: MUTED, align: "center" });
    });
    this.y = y + 20;
  }

  /** The footer line and the reference, under everything. */
  footer() {
    const { letterhead, reference } = this.model;
    this.y += 14;
    this.rule(this.y, HAIRLINE, 0.6);
    this.y += 8;
    this.line(letterhead.footer, MARGIN.left, this.y, WIDTH * 0.62, {
      face: "sans",
      size: 7,
      color: MUTED,
    });
    if (reference) {
      this.line(reference, MARGIN.left + WIDTH * 0.62, this.y, WIDTH * 0.38, {
        face: "sans",
        size: 7,
        color: MUTED,
        align: "right",
      });
    }
    this.y += 24;
  }

  /** A faint diagonal VOID across the middle. */
  watermark(height: number) {
    const stamp = this.model.stamp;
    if (stamp?.tone !== "danger" || !this.draw) return;
    const style: Style = { face: "sansBold", size: 96, spacing: 6, color: this.accent };
    const text = stamp.text.toUpperCase();
    const width = this.measure(text, style);
    this.ctx.save();
    this.ctx.globalAlpha = 0.07;
    this.ctx.translate(PAGE_WIDTH / 2, height / 2);
    this.ctx.rotate((-32 * Math.PI) / 180);
    this.ctx.fillStyle = this.accent;
    this.ctx.fillText(text, -width / 2, -96 * 0.36);
    this.ctx.restore();
  }

  run(): number {
    this.letterhead();
    this.titleBlock();
    this.parties();
    for (const block of this.model.blocks) this.block(block);
    this.signatures(this.model.signatures);
    this.footer();
    return this.y;
  }
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/** Every piece of text the picture shows, so the fonts it needs load first. */
function textOf(model: PrintDocument): string {
  return JSON.stringify(model);
}

/**
 * The document as a JPG picture: one tall page, about 2.5 times the PDF's
 * size. `logoUrl` is where the letterhead logo is fetched from (same site).
 */
export async function documentImage(
  model: PrintDocument,
  options: { logoUrl?: string | null; scale?: number; quality?: number } = {},
): Promise<Blob> {
  const fonts = {
    sans: familyOf("font-sans", "Helvetica, Arial, sans-serif"),
    serif: familyOf("font-serif", 'Georgia, "Times New Roman", serif'),
  };
  const sample = textOf(model);
  await Promise.all(
    [
      `400 12px ${fonts.sans}`,
      `700 12px ${fonts.sans}`,
      `italic 400 12px ${fonts.sans}`,
      `700 12px ${fonts.serif}`,
    ].map((font) => document.fonts.load(font, sample).catch(() => [])),
  );
  const logo = options.logoUrl ? await loadImage(options.logoUrl) : null;

  const measuring = document.createElement("canvas").getContext("2d");
  if (!measuring) throw new Error("This browser cannot draw pictures.");
  const height = Math.ceil(new Painter(measuring, model, logo, fonts, false).run());

  const wanted = options.scale ?? 2.5;
  const scale = Math.min(wanted, Math.sqrt(MAX_PIXELS / (PAGE_WIDTH * height)), MAX_SIDE / height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(PAGE_WIDTH * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw pictures.");
  ctx.scale(scale, scale);
  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, PAGE_WIDTH, height);
  const painter = new Painter(ctx, model, logo, fonts, true);
  painter.run();
  painter.watermark(height);

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The picture could not be made."))),
      "image/jpeg",
      options.quality ?? 0.92,
    ),
  );
}
