import { randomBytes } from "node:crypto";

import qrcode from "qrcode-generator";

import {
  collectPdf,
  createPdf,
  drawText,
  fitText,
  pdfInfo,
  pdfText,
  safeHex,
  type TextStyle,
  textWidth,
  tint,
  wrapText,
} from "@/lib/pdf";
import {
  type Align,
  type Block,
  type BookFrame,
  type Column,
  type PrintDocument,
  type Row,
  type RowStyle,
  TICK,
} from "@/modules/documents/model";

/*
 * Lays a printed document out on the company letterhead: A4 portrait, the logo,
 * name, contact details and registration numbers (BIN, trade licence) on top of
 * the first page (a slim header on the pages after it), the footer line and page
 * numbers at the bottom of every page.
 *
 * The look follows the brand: the company colour (dark green by default) for the
 * name, titles, rules and table headers, the accent colour (deep red) for a fine
 * line under the letterhead and for VOID / CANCELLED marks, Times for the name
 * and titles, Helvetica for everything else (Bengali in Noto Sans Bengali), on
 * plain white paper so it prints well. Text is placed line by line (cut with "…"
 * when it cannot wrap), tables repeat their header on every page, and nothing is
 * ever drawn past the margins.
 *
 * A document meant to be bound (`binding`, a booking spiral-bound for the
 * supplier) keeps a wider margin on the left for the holes on every page; it
 * can carry a QR code beside its title (`qr`) and a line for initials at the
 * foot of every page (`initials`), so each loose page is signed for.
 *
 * A document in the book frame (`frame`, a booking book) prints instead on A4
 * either way round: a blank strip 15 mm tall at the top of every page for
 * binding, then the header on every page (the company and its tagline on the
 * left, the title and the part of the book in the middle, DOC NO, BUYER, DATE
 * and PREPARED BY on the right) over a navy rule, navy tables with a grid and
 * every other row shaded, and the footer with the company's contacts and
 * "PAGE 2 OF 9". Each part (`section`) starts on a page of its own.
 */

const PAGE = { width: 595.28, height: 841.89 }; // A4 in points
const MARGIN = { top: 36, bottom: 60, left: 46, right: 46 };
/** The extra left margin of a bound document: room for the spiral's holes (about 8 mm). */
const BINDING_GUTTER = 22;
const BOTTOM = PAGE.height - MARGIN.bottom;
/** The QR code beside the title: a square this wide, with its caption under it. */
const QR_SIZE = 62;

/** One millimetre in points. */
const MM = 72 / 25.4;
/**
 * The book frame's margins: the blank strip at the top is for binding (no spiral
 * holes at the side), with 11 mm at the sides and 6 mm at the foot.
 */
const BOOK_MARGIN = { top: 15 * MM, bottom: 6 * MM, left: 11 * MM, right: 11 * MM };
/** The book header's height under the binding strip (its navy rule is at the bottom). */
const BOOK_HEADER = 36;
/** The room the footer takes above the bottom margin. */
const BOOK_FOOTER = 15;
const NAVY = "#1F4E79";
const BOOK_ZEBRA = "#F1F5F9";
const BOOK_BORDER = "#9FB4C8";
const BOOK_TOTAL = "#DBE8F4";

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

/**
 * PDF security for a signed record: AES-256, opened and printed by anyone, but
 * changing it needs a password nobody keeps (a fresh random one each time).
 */
function lockedPdf(): Partial<PDFKit.PDFDocumentOptions> {
  return {
    pdfVersion: "1.7ext3",
    ownerPassword: randomBytes(24).toString("base64url"),
    permissions: {
      printing: "highResolution",
      modifying: false,
      copying: true,
      annotating: false,
      fillingForms: false,
      contentAccessibility: true,
      documentAssembly: false,
    },
  };
}

const CELL_PAD = 5;
const TABLE_SIZE = 8.2;
const TABLE_LINE = 10.8;
/**
 * The smallest a table's text gets so its figures fit (many sizes on a booking):
 * below it, the figure columns are split over two or more tables instead. A
 * figure is never cut.
 */
const MIN_TABLE_SIZE = 6;
/** A column heading's size, in step with the table's text. */
const HEADER_RATIO = 7.4 / TABLE_SIZE;
const DETAIL_SIZE = 7;
const DETAIL_LINE = 9.4;
const TABLE_HEADER = 18;
/** The most a text column claims for its longest word; a longer one may still be cut. */
const MAX_WORD_NEED = 80;
/** A column heading too wide for its column wraps to this many lines; it is never cut. */
const MAX_HEADER_LINES = 3;
const MAX_CELL_LINES = 8;
/** A row's reference picture: a square this wide, before the details' text. */
const THUMB = 58;
const THUMB_GAP = 7;

type LineStyle = TextStyle & { color?: string; align?: Align };

type ColumnBox = { x: number; width: number; align: Align; check: boolean };

/** pdfkit's opened image (its type definitions leave openImage out). */
type OpenedImage = { width: number; height: number; orientation?: number };
type PdfImages = {
  openImage(src: Buffer): OpenedImage;
  image(src: OpenedImage, x: number, y: number, options: { width: number; height: number }): void;
};

class Writer {
  private y: number;
  private readonly primary: string;
  private readonly accent: string;
  /** Where the page's text starts (further in on a bound document) and how wide it runs. */
  private readonly left: number;
  private readonly width: number;
  /** The page (A4, either way round in the book frame) and where its text must end. */
  private readonly page: { width: number; height: number };
  private readonly bottom: number;
  /** The book frame, when the document is printed in it instead of on letterhead. */
  private readonly frame: BookFrame | null;
  /** Where a book page's text starts, under its header. */
  private readonly bookTop: number;
  /** The part of the book each page belongs to (for its header), by page. */
  private readonly sections: string[] = [];
  private section = "";
  /** The page each named part starts on (0-based), in order. */
  readonly partStarts: Array<{ key: string; page: number }> = [];
  /** Whether the QR code is already printed (by the book's first page title). */
  private qrDone = false;
  /** Row pictures opened by pdfkit, by file id (null: it could not be read). */
  private readonly opened = new Map<string, OpenedImage | null>();
  /** The text size of the table being drawn (smaller when its figures need the room). */
  private tableSize = TABLE_SIZE;

  private get tableLine() {
    return (TABLE_LINE / TABLE_SIZE) * this.tableSize;
  }

  constructor(
    private readonly doc: PDFKit.PDFDocument,
    private readonly model: PrintDocument,
    private readonly logo: Buffer | null,
    private readonly images: ReadonlyMap<string, Buffer> = new Map(),
    private readonly signed: ReadonlyMap<string, Buffer> = new Map(),
  ) {
    this.frame = model.frame ?? null;
    this.accent = safeHex(model.letterhead.accentColor, DEFAULT_ACCENT);
    if (this.frame) {
      const landscape = this.frame.orientation === "landscape";
      this.page = landscape ? { width: PAGE.height, height: PAGE.width } : PAGE;
      this.primary = NAVY;
      this.left = BOOK_MARGIN.left;
      this.width = this.page.width - BOOK_MARGIN.left - BOOK_MARGIN.right;
      this.bookTop = BOOK_MARGIN.top + BOOK_HEADER + 12;
      // The initials line sits above the footer, on the right.
      this.bottom = this.page.height - BOOK_MARGIN.bottom - BOOK_FOOTER - (model.initials ? 16 : 0);
    } else {
      this.page = PAGE;
      this.primary = safeHex(model.letterhead.primaryColor, DEFAULT_PRIMARY);
      this.left = MARGIN.left + (model.binding ? BINDING_GUTTER : 0);
      this.width = PAGE.width - this.left - MARGIN.right;
      this.bookTop = MARGIN.top;
      this.bottom = BOTTOM;
    }
    this.y = this.bookTop;
  }

  /** The font of titles and big figures: Times on letterhead, Helvetica in a book. */
  private get display(): string {
    return this.frame ? SANS_BOLD : SERIF_BOLD;
  }

  // --- Primitives -----------------------------------------------------------

  /** One line of text in a box `width` wide, cut to fit; returns the width drawn. */
  private line(text: string, x: number, y: number, width: number, style: LineStyle): number {
    const doc = this.doc;
    const fitted = fitText(doc, text, width, style);
    if (!fitted) return 0;
    const drawn = textWidth(doc, fitted, style);
    const dx =
      style.align === "right" ? width - drawn : style.align === "center" ? (width - drawn) / 2 : 0;
    doc.fillColor(style.color ?? INK);
    drawText(doc, fitted, x + dx, y, style);
    return drawn;
  }

  private rule(y: number, color: string, weight: number, x = this.left, length = this.width) {
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
      .flatMap((part) => (part.trim() ? wrapText(this.doc, part, width, { font, size }) : [""]));
  }

  /**
   * Long text that must not be cut (a company's name, a buyer, an address): its
   * size and lines. One line at the given size if it fits, else smaller down to
   * `minSize`, else wrapped onto up to `maxLines` lines at the largest size that
   * takes (and, when `fits` is given, whose lines it says have the room); only
   * past all that is the last line cut.
   */
  private fitLines(
    text: string,
    width: number,
    style: TextStyle,
    minSize: number,
    maxLines: number,
    fits: (lines: number, size: number) => boolean = () => true,
  ): { size: number; lines: string[] } {
    const one = (size: number) => textWidth(this.doc, pdfText(text), { ...style, size }) <= width;
    for (let size = style.size; size >= minSize - 0.001; size -= 0.5) {
      if (one(size)) return { size, lines: [pdfText(text)] };
    }
    for (let size = style.size; size >= minSize - 0.001; size -= 0.5) {
      const lines = wrapText(this.doc, text, width, { ...style, size });
      const whole = !lines.some((l) => l.endsWith("…"));
      if (lines.length <= maxLines && whole && fits(lines.length, size)) return { size, lines };
    }
    const lines = wrapText(this.doc, text, width, { ...style, size: minSize });
    if (lines.length <= maxLines) return { size: minSize, lines };
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = fitText(
      this.doc,
      `${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`,
      width,
      { ...style, size: minSize },
    );
    return { size: minSize, lines: kept };
  }

  /** Starts a new page with the slim header when `height` does not fit; true if it did. */
  private ensure(height: number): boolean {
    if (this.y + height <= this.bottom) return false;
    this.newPage();
    return true;
  }

  private newPage() {
    this.doc.addPage();
    if (this.frame) {
      // The header and footer are drawn at the end, with the page count.
      this.sections.push(this.section);
      this.y = this.bookTop;
    } else {
      this.continuationHeader();
    }
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

  /** Logo, name, contact details and registration numbers across the top of the first page. */
  letterhead() {
    const { letterhead } = this.model;
    const top = MARGIN.top;
    const nameColumn = this.width * 0.6;
    let nameX = this.left;
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
      (this.doc as unknown as PdfImages).image(image, this.left, top, {
        width: drawnWidth,
        height: logoHeight,
      });
      nameX = this.left + drawnWidth + 14;
    }

    const showLegal = Boolean(letterhead.legalName && letterhead.legalName !== letterhead.name);
    const nameBlock = showLegal ? 34 : 22;
    const nameTop = top + Math.max(0, (logoHeight - nameBlock) / 2);
    const nameWidth = this.left + nameColumn - nameX;
    // A long name gets smaller, then takes a second line: it is never cut.
    const name = this.fitLines(letterhead.name, nameWidth, { font: SERIF_BOLD, size: 20 }, 14, 2);
    const nameStep = name.size * 1.15;
    name.lines.forEach((text, i) => {
      this.line(text, nameX, nameTop + i * nameStep, nameWidth, {
        font: SERIF_BOLD,
        size: name.size,
        color: this.primary,
      });
    });
    const nameDrop = (name.lines.length - 1) * nameStep;
    if (showLegal) {
      this.line(letterhead.legalName!.toUpperCase(), nameX, nameTop + 25 + nameDrop, nameWidth, {
        font: SANS,
        size: 6.8,
        color: MUTED,
        spacing: 1.3,
      });
    }

    const contactX = this.left + nameColumn + 10;
    const contactWidth = this.width - nameColumn - 10;
    let contactY = top + 2;
    const contactLines = (texts: string[]) => {
      for (const contact of texts) {
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
    };
    contactLines(letterhead.contacts);
    // The BIN and trade licence number, a little apart from the address and phone.
    const registrations = letterhead.registrations ?? [];
    if (registrations.length > 0) {
      if (letterhead.contacts.length > 0) contactY += 3;
      contactLines(registrations);
    }

    const bottom = Math.max(top + logoHeight, nameTop + nameBlock + nameDrop, contactY);
    const ruleY = bottom + 9;
    this.rule(ruleY, this.primary, 1.3);
    this.rule(ruleY + 3.4, this.accent, 0.8, this.left, 64);
    this.y = ruleY + 22;
  }

  /** Pages after the first: the name and the document's title, with one rule. */
  private continuationHeader() {
    const top = MARGIN.top;
    const { letterhead, title, reference } = this.model;
    const name = this.fitLines(
      letterhead.name,
      this.width * 0.55,
      { font: SERIF_BOLD, size: 11.5 },
      8.5,
      2,
    );
    name.lines.forEach((text, i) => {
      this.line(text, this.left, top + i * (name.size + 2), this.width * 0.55, {
        font: SERIF_BOLD,
        size: name.size,
        color: this.primary,
      });
    });
    const right = this.fitLines(
      [title, reference].filter(Boolean).join(" · "),
      this.width * 0.45 - 6,
      { font: SANS, size: 7.5 },
      6.5,
      2,
    );
    right.lines.forEach((text, i) => {
      this.line(text, this.left + this.width * 0.55 + 6, top + 2.5 + i * 9, this.width * 0.45 - 6, {
        font: SANS,
        size: right.size,
        color: MUTED,
        align: "right",
      });
    });
    const drop = Math.max((name.lines.length - 1) * (name.size + 2), (right.lines.length - 1) * 9);
    this.rule(top + 18 + drop, this.primary, 0.8);
    this.y = top + 32 + drop;
  }

  // --- The book frame -----------------------------------------------------------

  /**
   * A book's first page: its text starts under the header. A book that does not
   * open with a part of its own gets its subtitle (or title) as the page title.
   */
  bookStart() {
    this.sections.push(this.section);
    this.y = this.bookTop;
    if (this.model.blocks[0]?.kind !== "section") {
      this.pageTitle(this.model.subtitle || this.model.title);
    }
    if (this.model.parties.length > 0) this.partyBoxes(this.model.parties);
  }

  /** A part of the book on a page of its own, its title on top and its label in the header. */
  private sectionStart(block: Extract<Block, { kind: "section" }>) {
    if (!this.frame) {
      this.newPage();
      this.heading({ kind: "heading", title: block.title, subtitle: block.subtitle });
      return;
    }
    if (this.y > this.bookTop + 0.5) this.newPage();
    this.section = block.label ?? "";
    this.sections[this.sections.length - 1] = this.section;
    if (block.key) this.partStarts.push({ key: block.key, page: this.sections.length - 1 });
    this.pageTitle(block.title, block.subtitle);
  }

  /** The page title in navy under the header, with the QR code beside the first one. */
  private pageTitle(title: string, subtitle?: string) {
    const qr = this.model.qr && !this.qrDone ? this.model.qr : null;
    const room = this.width - (qr ? QR_SIZE + 14 : 0);
    const top = this.y;
    let y = top;
    for (const text of this.wrap(title, room, SANS_BOLD, 13).slice(0, 2)) {
      this.line(text, this.left, y, room, { font: SANS_BOLD, size: 13, color: NAVY });
      y += 16;
    }
    if (subtitle) {
      y += 1;
      for (const text of this.wrap(subtitle, room, SANS, 8.6).slice(0, 3)) {
        this.line(text, this.left, y, room, { font: SANS, size: 8.6, color: MUTED });
        y += 11;
      }
    }
    let qrBottom = 0;
    if (qr) {
      qrBottom = this.qrCode(qr, this.left + this.width - QR_SIZE, top);
      this.qrDone = true;
    }
    this.y = Math.max(y, qrBottom) + 8;
  }

  /** Every book page's header and footer, now that the pages are counted. */
  bookFrames() {
    const frame = this.frame;
    if (!frame) return;
    const range = this.doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);
      const n = i - range.start;
      this.bookHeader(frame, this.sections[n] ?? "");
      const ruleY = this.page.height - BOOK_MARGIN.bottom - BOOK_FOOTER + 2;
      this.rule(ruleY, NAVY, 0.9);
      this.bookFooter(frame.contact, `PAGE ${n + 1} OF ${range.count}`, ruleY + 4.5);
      if (this.model.initials) this.initialsLine(this.model.initials, ruleY - 14);
    }
  }

  /**
   * The book footer: "contacts • PAGE 2 OF 9" centred when it fits. Else the page
   * number stays whole on the right and the contacts wrap onto two lines beside
   * it: the page number is never cut.
   */
  private bookFooter(contact: string, page: string, y: number) {
    const style = { font: SANS_BOLD, size: 6.4, spacing: 0.2 };
    const whole = `${contact} • ${page}`;
    if (textWidth(this.doc, pdfText(whole), style) <= this.width) {
      this.line(whole, this.left, y, this.width, { ...style, color: NAVY, align: "center" });
      return;
    }
    const pageWidth = textWidth(this.doc, page, style);
    this.line(page, this.left + this.width - pageWidth, y, pageWidth + 1, {
      ...style,
      color: NAVY,
    });
    const room = this.width - pageWidth - 14;
    const text = this.fitLines(contact, room, style, 5.6, 2);
    text.lines.forEach((line, i) => {
      this.line(line, this.left, y + i * 7, room, { ...style, size: text.size, color: NAVY });
    });
  }

  /**
   * The header under the binding strip: the company and its tagline on the left,
   * the document's title and the part of the book in the middle, the document's
   * details in small capitals on the right (a line to write on when one is
   * empty), and a navy rule under it all.
   */
  private bookHeader(frame: BookFrame, section: string) {
    const top = BOOK_MARGIN.top;
    const side = this.width * 0.3;
    const middle = this.width - 2 * side;
    // A long name gets smaller, then takes a second line (the tagline moves down), and a
    // third in portrait if it must (the tagline then has no room), always above the
    // rule: never cut.
    const name = this.fitLines(
      this.model.letterhead.name,
      side - 8,
      { font: SANS_BOLD, size: 13 },
      9,
      3,
      (lines, size) => 2 + (lines - 1) * (size + 1.5) + size * 1.16 <= BOOK_HEADER - 1.5,
    );
    name.lines.forEach((text, i) => {
      this.line(text, this.left, top + 2 + i * (name.size + 1.5), side - 8, {
        font: SANS_BOLD,
        size: name.size,
        color: NAVY,
      });
    });
    const taglineY =
      name.lines.length > 1 ? top + 2 + name.lines.length * (name.size + 1.5) + 1 : top + 19;
    if (frame.tagline && taglineY + 7 <= top + BOOK_HEADER - 1) {
      this.line(frame.tagline, this.left, taglineY, side - 8, {
        font: SANS,
        size: 7,
        color: MUTED,
        spacing: 0.3,
      });
    }
    const mx = this.left + side + 6;
    const mw = middle - 12;
    const titles = this.wrap(this.model.title, mw, SANS_BOLD, 10).slice(0, 2);
    titles.forEach((text, i) => {
      this.line(text, mx, top + 2 + i * 12, mw, {
        font: SANS_BOLD,
        size: 10,
        color: NAVY,
        align: "center",
      });
    });
    if (section) {
      this.line(section.toUpperCase(), mx, top + 4 + titles.length * 12, mw, {
        font: SANS_BOLD,
        size: 7.2,
        color: MUTED,
        align: "center",
        spacing: 1,
      });
    }
    const rx = this.left + side + middle + 6;
    const rw = side - 6;
    const labelWidth = Math.min(62, rw * 0.4);
    const room = rw - labelWidth;
    const fields = frame.fields.slice(0, 4).map((field) => {
      // A name signed for keeps room for the signature line beside it.
      const width = field.sign ? room * 0.55 : room;
      const fit = field.value
        ? this.fitLines(field.value, width, { font: SANS_BOLD, size: 6.9 }, 5.4, 2)
        : { size: 6.9, lines: [] as string[] };
      return { field, width, fit };
    });
    // A value that needs a second line (a long buyer or batch name) gets it: the rows
    // close up so the column still ends above the rule. Nothing is cut.
    const lineCount = fields.reduce((n, f) => n + Math.max(1, f.fit.lines.length), 0);
    const step = Math.min(8.6, (BOOK_HEADER - 2) / lineCount);
    let y = top + 1;
    for (const { field, width, fit } of fields) {
      this.line(field.label.toUpperCase(), rx, y + 0.7, labelWidth, {
        font: SANS_BOLD,
        size: 5.9,
        color: MUTED,
        spacing: 0.6,
      });
      if (fit.lines.length === 0) {
        this.rule(y + 6.8, MUTED, 0.5, rx + labelWidth + 4, room - 4);
      } else if (field.sign) {
        // The name, then the line to sign on beside it.
        let drawn = 0;
        fit.lines.forEach((text, i) => {
          drawn = Math.max(
            drawn,
            this.line(text, rx + labelWidth + 2, y + i * step, width, {
              font: SANS_BOLD,
              size: fit.size,
            }),
          );
        });
        const lineX = rx + labelWidth + 2 + drawn + 5;
        this.rule(y + 6.8, MUTED, 0.5, lineX, rx + rw - lineX);
      } else {
        fit.lines.forEach((text, i) => {
          this.line(text, rx + labelWidth, y + i * step, width, {
            font: SANS_BOLD,
            size: fit.size,
            align: "right",
          });
        });
      }
      y += Math.max(1, fit.lines.length) * step;
    }
    this.rule(top + BOOK_HEADER, NAVY, 2);
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
        this.line(letterhead.footer, this.left, y, this.width, {
          font: SANS,
          size: 7.2,
          color: MUTED,
          align: "center",
          spacing: 0.2,
        });
        continue;
      }
      this.line(letterhead.footer, this.left, y, this.width * 0.62, {
        font: SANS,
        size: 7,
        color: MUTED,
      });
      const page = range.count > 1 ? `Page ${i - range.start + 1} of ${range.count}` : "";
      this.line(
        [reference, page].filter(Boolean).join(" · "),
        this.left + this.width * 0.62,
        y,
        this.width * 0.38,
        { font: SANS, size: 7, color: MUTED, align: "right" },
      );
      if (this.model.initials) this.initialsLine(this.model.initials, y + 13);
    }
  }

  /** "Supplier's initials ________" at the foot of a page, on the right. */
  private initialsLine(label: string, y: number) {
    const style = { font: SANS, size: 7, color: MUTED };
    const text = pdfText(label);
    const width = textWidth(this.doc, text, style);
    const lineLength = 110;
    const x = this.left + this.width - lineLength;
    this.line(text, x - width - 6, y, width + 2, { ...style, align: "right" });
    this.rule(y + 8, MUTED, 0.5, x, lineLength);
  }

  /** A faint diagonal VOID / CANCELLED across every page. */
  watermarks() {
    const stamp = this.model.stamp;
    if (stamp?.tone !== "danger") return;
    const range = this.doc.bufferedPageRange();
    const size = this.frame?.orientation === "landscape" ? 120 : 96;
    const style = { font: SANS_BOLD, size, spacing: 6 };
    const text = pdfText(stamp.text.toUpperCase());
    const width = textWidth(this.doc, text, style);
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);
      this.doc.save();
      const cx = this.page.width / 2;
      const cy = this.page.height / 2;
      this.doc.rotate(-32, { origin: [cx, cy] });
      this.doc.fillColor(this.accent).fillOpacity(0.07);
      drawText(this.doc, text, cx - width / 2, cy - size * 0.36, style);
      this.doc.restore();
    }
  }

  // --- Title, details and parties --------------------------------------------

  titleBlock() {
    const { title, subtitle, stamp, meta, qr } = this.model;
    const top = this.y;
    // A QR code takes the right-hand edge; the title and the details share the rest.
    const qrRoom = qr ? QR_SIZE + 14 : 0;
    const usable = this.width - qrRoom;
    const leftWidth = usable * 0.56;

    const stampText = stamp ? pdfText(stamp.text.toUpperCase()) : "";
    const badgeWidth = stamp
      ? textWidth(this.doc, stampText, { font: SANS_BOLD, size: 7.5, spacing: 1.2 }) + 12
      : 0;
    const room = leftWidth - (stamp ? badgeWidth + 12 : 0);

    // 19 pt, or smaller for a long title so it fits beside the badge; one still
    // too long at 12 pt goes on two lines at 15 pt rather than being cut.
    const titleText = title.toUpperCase();
    const spacingFor = (size: number) => size * 0.115;
    const styleAt = (s: number) => ({ font: SERIF_BOLD, size: s, spacing: spacingFor(s) });
    let size = 19;
    const widthAt = (s: number) => textWidth(this.doc, titleText, styleAt(s));
    while (size > 12 && widthAt(size) > room) size -= 0.5;
    let lines = [titleText];
    if (widthAt(size) > room) {
      size = 15;
      lines = wrapText(this.doc, titleText, room, styleAt(size)).slice(0, 2);
    }
    let titleWidth = 0;
    lines.forEach((text, i) => {
      const drawn = this.line(text, this.left, top + (19 - size) * 0.55 + i * 19, room, {
        ...styleAt(size),
        color: this.primary,
      });
      if (i === 0) titleWidth = drawn;
    });
    if (stamp) {
      const color = stamp.tone === "danger" ? this.accent : this.primary;
      const x = this.left + titleWidth + 12;
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
    let leftY = top + 25 + (lines.length - 1) * 19;
    if (subtitle) {
      for (const text of this.wrap(subtitle, leftWidth, SANS, 9.5).slice(0, 2)) {
        this.line(text, this.left, leftY, leftWidth, { font: SANS, size: 9.5 });
        leftY += 12.5;
      }
    }

    const boxX = this.left + usable * 0.58;
    const boxWidth = usable * 0.42;
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
    let qrBottom = 0;
    if (qr) qrBottom = this.qrCode(qr, this.left + this.width - QR_SIZE, top);
    this.y = Math.max(leftY, rightY, qrBottom) + 12;
  }

  /**
   * A QR code of `qr.data` in a QR_SIZE square at (x, y), dark modules in ink on
   * white with the quiet zone inside the square, and its caption under it.
   * Returns where it ends. Data too long for a QR code is left out.
   */
  private qrCode(qr: NonNullable<PrintDocument["qr"]>, x: number, y: number): number {
    let code: ReturnType<typeof qrcode>;
    try {
      code = qrcode(0, "M");
      code.addData(qr.data);
      code.make();
    } catch {
      return 0;
    }
    const count = code.getModuleCount();
    const quiet = 2; // modules of white around it
    const cell = QR_SIZE / (count + quiet * 2);
    this.doc.rect(x, y, QR_SIZE, QR_SIZE).fill(WHITE);
    this.doc.fillColor(INK);
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (!code.isDark(row, col)) continue;
        // A hair wider than the cell, so neighbouring modules meet without seams.
        this.doc
          .rect(x + (col + quiet) * cell, y + (row + quiet) * cell, cell + 0.08, cell + 0.08)
          .fill(INK);
      }
    }
    this.doc.rect(x, y, QR_SIZE, QR_SIZE).lineWidth(0.5).strokeColor(HAIRLINE).stroke();
    if (!qr.caption) return y + QR_SIZE;
    this.line(qr.caption, x - 10, y + QR_SIZE + 3, QR_SIZE + 20, {
      font: SANS,
      size: 6,
      color: MUTED,
      align: "center",
    });
    return y + QR_SIZE + 11;
  }

  parties() {
    this.partyBoxes(this.model.parties);
  }

  /** Address boxes side by side, in a tint of the company colour. */
  private partyBoxes(parties: PrintDocument["parties"]) {
    if (parties.length === 0) return;
    const gap = 12;
    // At most half the page wide, so a single address does not stretch across.
    const columns = Math.max(2, parties.length);
    const width = (this.width - gap * (columns - 1)) / columns;
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
      const x = this.left + i * (width + gap);
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
      case "heading":
        return this.heading(block);
      case "signatures":
        return this.signatureLines(block.labels);
      case "pageBreak":
        return this.newPage();
      case "section":
        return this.sectionStart(block);
      case "parties":
        return this.partyBoxes(block.parties);
    }
  }

  private sectionTitle(title: string) {
    this.label(title, this.left, this.y, this.width, this.primary);
    this.y += 13;
  }

  /** How wide each right-aligned column (figures) must be for its figures and heading at `size`. */
  private figureNeeds(columns: Column[], rows: Row[], size: number): number[] {
    return columns.map((c, i) => {
      if (c.align !== "right") return 0;
      const widest = Math.max(
        textWidth(this.doc, this.columnLabel(c), {
          font: SANS_BOLD,
          size: size * HEADER_RATIO,
          spacing: 0.3,
        }),
        ...rows.map((r) =>
          textWidth(this.doc, r.cells[i] ?? "", {
            font: (r.style ?? "normal") === "normal" ? SANS : SANS_BOLD,
            size,
          }),
        ),
      );
      return widest + 2 * CELL_PAD + 1;
    });
  }

  /**
   * How much room the figure columns lack at `size`, and the text columns' room
   * they may take it from (up to half of it).
   */
  private shortfall(columns: Column[], rows: Row[], size: number) {
    const total = columns.reduce((sum, c) => sum + (c.weight ?? 1), 0);
    const widths = columns.map((c) => ((c.weight ?? 1) / total) * this.width);
    const need = this.figureNeeds(columns, rows, size);
    const short = widths.reduce((sum, w, i) => sum + Math.max(0, need[i]! - w), 0);
    const flexible = widths.reduce(
      (sum, w, i) => (columns[i]!.align === "right" ? sum : sum + w),
      0,
    );
    return { widths, need, short, flexible };
  }

  /**
   * How wide each text column must be so no word in it is cut (its heading, its
   * cells and the details under them), up to MAX_WORD_NEED: a word longer than
   * that may still be cut, as before.
   */
  private wordNeeds(columns: Column[], rows: Row[], size: number): number[] {
    const longest = (text: string, style: TextStyle) =>
      Math.max(
        0,
        ...text.split(/\s+/).map((word) => (word ? textWidth(this.doc, word, style) : 0)),
      );
    return columns.map((c, i) => {
      if (c.align === "right" || c.check) return 0;
      let widest = longest(this.columnLabel(c), {
        font: SANS_BOLD,
        size: size * HEADER_RATIO,
        spacing: 0.3,
      });
      for (const r of rows) {
        const font = (r.style ?? "normal") === "normal" ? SANS : SANS_BOLD;
        widest = Math.max(widest, longest(r.cells[i] ?? "", { font, size }));
        for (const d of r.details ?? []) {
          widest = Math.max(widest, longest(d, { font: SANS, size: DETAIL_SIZE }));
        }
      }
      const swatch = i === 0 && rows.some((r) => r.swatch) ? 11 : 0;
      return Math.min(MAX_WORD_NEED, widest) + swatch + 2 * CELL_PAD + 1;
    });
  }

  /**
   * Each column's width at `size`, or null when it cannot be done without cutting
   * a figure or a word. First the usual way: figure columns take what they lack
   * from the text columns (at most half of their room). When that would leave a
   * text column too narrow for its words (a booking with many sizes in portrait),
   * every column gets what it needs and the room comes from the columns with more.
   */
  private layoutWidths(columns: Column[], rows: Row[], size: number): number[] | null {
    const { need, short, flexible, widths } = this.shortfall(columns, rows, size);
    const words = this.wordNeeds(columns, rows, size);
    let usual: number[] | null = widths;
    if (short > 0) {
      usual =
        flexible > 2 * short
          ? widths.map((w, i) =>
              columns[i]!.align === "right" ? Math.max(w, need[i]!) : w - short * (w / flexible),
            )
          : null;
    }
    if (usual && usual.every((w, i) => w >= words[i]! - 0.01)) return usual;
    const least = columns.map((c, i) => (c.align === "right" ? need[i]! : words[i]!));
    const deficit = widths.reduce((sum, w, i) => sum + Math.max(0, least[i]! - w), 0);
    const surplus = widths.reduce((sum, w, i) => sum + Math.max(0, w - least[i]!), 0);
    if (deficit > surplus) return null;
    return widths.map((w, i) =>
      w <= least[i]! ? least[i]! : w - (deficit * (w - least[i]!)) / surplus,
    );
  }

  /** Whether every figure, and every word of the text columns, fits at `size`. */
  private figuresFit(columns: Column[], rows: Row[], size: number): boolean {
    return this.layoutWidths(columns, rows, size) !== null;
  }

  /** The largest text size, from the usual one down to the smallest, at which the figures fit. */
  private sizeFor(columns: Column[], rows: Row[]): number | null {
    for (let size = TABLE_SIZE; size >= MIN_TABLE_SIZE - 0.001; size -= 0.4) {
      if (this.figuresFit(columns, rows, size)) return Math.round(size * 10) / 10;
    }
    return null;
  }

  private columnBoxes(columns: Column[], rows: Row[] = []): ColumnBox[] {
    // A right-aligned column (quantities, rates, amounts) prints on one line: when its
    // longest figure or its heading would be cut, it takes the room it needs from the
    // text columns, so no figure ever ends in "…", and no text column gets too narrow
    // for its words (layoutWidths). Tables that already fit are unchanged.
    const widths =
      this.layoutWidths(columns, rows, this.tableSize) ??
      this.shortfall(columns, rows, this.tableSize).widths;
    let x = this.left;
    return columns.map((c, i) => {
      const width = widths[i]!;
      const box = { x, width, align: c.align ?? "left", check: c.check ?? false };
      x += width;
      return box;
    });
  }

  /** A column's heading: in capitals in the book frame. */
  private columnLabel(c: Column): string {
    return this.frame ? c.label.toUpperCase() : c.label;
  }

  /** Each column heading's lines: one, or wrapped when the column is narrower than it. */
  private headerLines(columns: Column[], boxes: ColumnBox[]): string[][] {
    const style = { font: SANS_BOLD, size: this.tableSize * HEADER_RATIO, spacing: 0.3 };
    return columns.map((c, i) => {
      const text = this.columnLabel(c);
      const width = boxes[i]!.width - 2 * CELL_PAD;
      if (textWidth(this.doc, text, style) <= width) return [text];
      return wrapText(this.doc, text, width, style).slice(0, MAX_HEADER_LINES);
    });
  }

  /** The heading row's height: taller when a heading wraps. */
  private headerHeight(lines: string[][]): number {
    const most = Math.max(1, ...lines.map((l) => l.length));
    return TABLE_HEADER + (most - 1) * this.tableSize * HEADER_RATIO * 1.25;
  }

  private tableHeader(columns: Column[], boxes: ColumnBox[]) {
    const lines = this.headerLines(columns, boxes);
    const height = this.headerHeight(lines);
    const size = this.tableSize * HEADER_RATIO;
    this.doc.rect(this.left, this.y, this.width, height).fill(this.primary);
    columns.forEach((c, i) => {
      const box = boxes[i]!;
      lines[i]!.forEach((text, n) => {
        this.line(
          text,
          box.x + CELL_PAD,
          this.y + 5.6 + n * size * 1.25,
          box.width - 2 * CELL_PAD,
          {
            font: SANS_BOLD,
            size,
            color: WHITE,
            align: box.align,
            spacing: 0.3,
          },
        );
      });
    });
    if (this.frame) this.grid(boxes, this.y, height);
    this.y += height;
  }

  /** The book frame's table grid: a thin blue-grey line round every cell of a row. */
  private grid(boxes: ColumnBox[], top: number, height: number) {
    this.doc.lineWidth(0.5).strokeColor(BOOK_BORDER);
    for (const box of boxes) this.doc.rect(box.x, top, box.width, height).stroke();
  }

  /** A row's picture, opened once; null when it was not handed over or cannot be read. */
  private picture(id: string | undefined): OpenedImage | null {
    if (!id) return null;
    if (!this.opened.has(id)) {
      const bytes = this.images.get(id);
      let image: OpenedImage | null = null;
      if (bytes) {
        try {
          image = (this.doc as unknown as PdfImages).openImage(bytes);
        } catch {
          image = null; // printed without it rather than not at all
        }
      }
      this.opened.set(id, image);
    }
    return this.opened.get(id) ?? null;
  }

  /** What a row prints in each column, and its height. */
  private layoutRow(row: Row, boxes: ColumnBox[], detailColumn: number) {
    const bold = (row.style ?? "normal") !== "normal";
    const font = bold ? SANS_BOLD : SANS;
    const picture = this.picture(row.image);
    const cells = boxes.map((box, i) => {
      const indent =
        (i === 0 && row.swatch ? 11 : 0) + (i === detailColumn && picture ? THUMB + THUMB_GAP : 0);
      const width = box.width - 2 * CELL_PAD - indent;
      const text = row.cells[i] ?? "";
      const lines =
        box.check && !bold
          ? [] // a tick box instead of text
          : box.align === "left"
            ? this.wrap(text, width, font, this.tableSize).slice(0, MAX_CELL_LINES)
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
            c.lines.length * this.tableLine +
            c.details.length * DETAIL_LINE +
            (c.details.length ? 1.5 : 0),
        ),
        this.tableLine,
        picture ? THUMB : 0,
      ) +
      2 * CELL_PAD -
      1;
    const tall = Math.max(height, row.height ?? 0);
    return { cells, height: tall, font, picture, detailColumn };
  }

  /**
   * A table at the largest text size its figures fit at. When they do not fit
   * even at the smallest, its figure columns are split over two or more tables,
   * each with the text columns again (a booking with many sizes): no figure is
   * ever cut.
   */
  private table(block: Extract<Block, { kind: "table" }>) {
    const size = this.sizeFor(block.columns, block.rows);
    if (size !== null) return this.tableAt(block, size);
    const keep = block.columns.flatMap((c, i) => (c.align === "right" ? [] : [i]));
    const figures = block.columns.flatMap((c, i) => (c.align === "right" ? [i] : []));
    const pick = (indexes: number[]) => {
      const order = [...indexes].sort((a, b) => a - b);
      return {
        ...block,
        columns: order.map((i) => block.columns[i]!),
        rows: block.rows.map((r) => ({ ...r, cells: order.map((i) => r.cells[i] ?? "") })),
      };
    };
    const groups: number[][] = [];
    let group: number[] = [];
    for (const i of figures) {
      const next = [...group, i];
      const part = pick([...keep, ...next]);
      if (group.length > 0 && !this.figuresFit(part.columns, part.rows, MIN_TABLE_SIZE)) {
        groups.push(group);
        group = [i];
      } else {
        group = next;
      }
    }
    if (group.length > 0) groups.push(group);
    groups.forEach((g, n) => {
      const part = pick([...keep, ...g]);
      const first = block.columns[g[0]!]!.label;
      const last = block.columns[g[g.length - 1]!]!.label;
      const title =
        n === 0
          ? block.title
          : `${block.title ?? "Table"} (continued: ${first === last ? first : `${first} to ${last}`})`;
      this.tableAt({ ...part, title }, this.sizeFor(part.columns, part.rows) ?? MIN_TABLE_SIZE);
    });
  }

  private tableAt(block: Extract<Block, { kind: "table" }>, size: number) {
    this.tableSize = size;
    try {
      this.drawTable(block);
    } finally {
      this.tableSize = TABLE_SIZE;
    }
  }

  private drawTable(block: Extract<Block, { kind: "table" }>) {
    const boxes = this.columnBoxes(block.columns, block.rows);
    // Details go under the widest left-aligned column (the description).
    let detailColumn = 0;
    boxes.forEach((b, i) => {
      if (b.align === "left" && b.width > boxes[detailColumn]!.width) detailColumn = i;
    });
    const layouts = block.rows.map((row) => this.layoutRow(row, boxes, detailColumn));
    const titleHeight = block.title ? 13 : 0;
    const header = this.headerHeight(this.headerLines(block.columns, boxes));
    this.ensure(titleHeight + header + (layouts[0]?.height ?? 20));
    if (block.title) this.sectionTitle(block.title);
    this.tableHeader(block.columns, boxes);

    if (block.rows.length === 0) {
      this.line(block.empty ?? "Nothing to show.", this.left + CELL_PAD, this.y + 6, this.width, {
        font: SANS_ITALIC,
        size: this.tableSize,
        color: MUTED,
      });
      this.y += 22;
      this.rule(this.y, this.frame ? BOOK_BORDER : HAIRLINE, 0.6);
      this.y += 14;
      return;
    }

    let shade = false;
    block.rows.forEach((row, index) => {
      const layout = layouts[index]!;
      if (this.ensure(layout.height)) {
        if (block.title) {
          this.line(`${block.title} (continued)`, this.left, this.y, this.width, {
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
    if (!this.frame) this.rule(this.y, HAIRLINE, 0.6);
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
    if (this.frame) {
      const fill = style === "total" ? BOOK_TOTAL : shaded ? BOOK_ZEBRA : null;
      if (fill) this.doc.rect(this.left, top, this.width, layout.height).fill(fill);
    } else if (shaded) {
      this.doc.rect(this.left, top, this.width, layout.height).fill(ZEBRA);
    }
    if (style !== "normal" && !this.frame) {
      this.rule(
        top + 0.4,
        style === "total" ? this.primary : HAIRLINE,
        style === "total" ? 1 : 0.6,
      );
    }
    layout.cells.forEach((cell, i) => {
      const box = boxes[i]!;
      const x = box.x + CELL_PAD + cell.indent;
      if (box.check && style === "normal") {
        this.tickBox(box, top, row.cells[i] === TICK);
        return;
      }
      if (i === 0 && row.swatch) {
        const color = safeHex(row.swatch, "#FFFFFF");
        this.doc
          .rect(box.x + CELL_PAD, top + CELL_PAD + 1.2, 7, 7)
          .lineWidth(0.5)
          .fillAndStroke(color, "#9AA5A0");
      }
      if (i === layout.detailColumn && layout.picture) {
        this.thumbnail(layout.picture, x - THUMB - THUMB_GAP, top + CELL_PAD - 0.5);
      }
      let ly = top + CELL_PAD;
      for (const text of cell.lines) {
        this.line(text, x, ly, cell.width, {
          font: layout.font,
          size: this.tableSize,
          align: box.align,
        });
        ly += this.tableLine;
      }
      if (cell.details.length) ly += 1.5;
      for (const text of cell.details) {
        this.line(text, x, ly, cell.width, { font: SANS, size: DETAIL_SIZE, color: MUTED });
        ly += DETAIL_LINE;
      }
    });
    if (this.frame) this.grid(boxes, top, layout.height);
    this.y += layout.height;
  }

  /** A picture fitted into a THUMB square on white, with a hairline frame. */
  private thumbnail(image: OpenedImage, x: number, y: number) {
    const rotated = (image.orientation ?? 1) > 4;
    const width = rotated ? image.height : image.width;
    const height = rotated ? image.width : image.height;
    const scale = Math.min(THUMB / width, THUMB / height);
    const w = width * scale;
    const h = height * scale;
    this.doc.rect(x, y, THUMB, THUMB).fill(WHITE);
    (this.doc as unknown as PdfImages).image(image, x + (THUMB - w) / 2, y + (THUMB - h) / 2, {
      width: w,
      height: h,
    });
    this.doc.rect(x, y, THUMB, THUMB).lineWidth(0.5).strokeColor(HAIRLINE).stroke();
  }

  /** A small box in the cell, with a tick in the company colour when `ticked`. */
  private tickBox(box: ColumnBox, top: number, ticked: boolean) {
    const size = 7;
    const x =
      box.align === "center"
        ? box.x + (box.width - size) / 2
        : box.align === "right"
          ? box.x + box.width - CELL_PAD - size
          : box.x + CELL_PAD;
    const y = top + CELL_PAD - 0.5; // level with the row's capitals and figures
    this.doc.rect(x, y, size, size).lineWidth(0.6).strokeColor(INK).stroke();
    if (ticked) {
      this.doc
        .moveTo(x + 1.5, y + size * 0.52)
        .lineTo(x + size * 0.42, y + size - 1.5)
        .lineTo(x + size - 1.3, y + 1.4)
        .lineWidth(1.2)
        .strokeColor(this.primary)
        .stroke();
    }
  }

  private totals(block: Extract<Block, { kind: "totals" }>) {
    const width = 236;
    const x = this.left + this.width - width;
    const height = block.rows.reduce((h, r) => h + (r.strong ? 19 : 14.5), 0) + 4;
    const words = block.words
      ? this.wrap(`In words: ${block.words}`, this.width, SANS_ITALIC, 8)
      : [];
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
      this.line(text, this.left, this.y, this.width, { font: SANS_ITALIC, size: 8 });
      this.y += 11;
    }
    this.y += 12;
  }

  private figures(block: Extract<Block, { kind: "figures" }>) {
    const perRow = Math.min(4, block.figures.length);
    const gap = 8;
    const width = (this.width - gap * (perRow - 1)) / perRow;
    const height = 54;
    for (let i = 0; i < block.figures.length; i += perRow) {
      this.ensure(height + gap);
      block.figures.slice(i, i + perRow).forEach((f, j) => {
        const x = this.left + j * (width + gap);
        this.doc.roundedRect(x, this.y, width, height, 3).fill(tint(this.primary, 0.94));
        this.label(f.label, x + 9, this.y + 9, width - 18);
        this.line(f.value, x + 9, this.y + 21, width - 18, { font: this.display, size: 13.5 });
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
    const lines = block.paragraphs.flatMap((p) => this.wrap(p, this.width, SANS, 8.4));
    this.ensure(13 + Math.min(lines.length, 3) * 11.8);
    this.sectionTitle(block.title);
    for (const text of lines) {
      if (!text) {
        this.y += 4;
        continue;
      }
      this.ensure(11.8);
      this.line(text, this.left, this.y, this.width, { font: SANS, size: 8.4 });
      this.y += 11.8;
    }
    this.y += 10;
  }

  /** "• Collar & cuff: the golden colour should be a little brighter", wrapped under the bullet. */
  private list(block: Extract<Block, { kind: "list" }>) {
    const indent = block.numbered ? 19 : 12;
    const width = this.width - indent;
    const items = block.items.map((item) => {
      const label = item.label ? pdfText(`${item.label}:`) : "";
      const labelWidth = label ? textWidth(this.doc, label, { font: SANS_BOLD, size: 8.4 }) + 4 : 0;
      // The first line leaves room for the bold label; the rest use the full width.
      const words = pdfText(item.text).split(" ").filter(Boolean);
      const lines: string[] = [];
      let current = "";
      for (const word of words) {
        const limit = lines.length === 0 ? width - labelWidth : width;
        const next = current ? `${current} ${word}` : word;
        if (current && textWidth(this.doc, next, { font: SANS, size: 8.4 }) > limit) {
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
    for (const [n, item] of items.entries()) {
      this.ensure(item.lines.length * 11.8);
      if (block.numbered) {
        this.line(`${n + 1}.`, this.left, this.y, indent - 5, {
          font: SANS_BOLD,
          size: 8.4,
          color: this.primary,
          align: "right",
        });
      } else {
        this.line("•", this.left + 2, this.y, 8, {
          font: SANS_BOLD,
          size: 8.4,
          color: this.primary,
        });
      }
      item.lines.forEach((text, i) => {
        let x = this.left + indent;
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
    const lines = this.wrap(text, this.width, SANS_ITALIC, 7.4);
    for (const l of lines) {
      this.ensure(10);
      this.line(l, this.left, this.y, this.width, { font: SANS_ITALIC, size: 7.4, color: MUTED });
      this.y += 10;
    }
    this.y += 8;
  }

  /** A part's title in the company colour, with a line under it and a rule. */
  private heading(block: Extract<Block, { kind: "heading" }>) {
    if (this.frame) {
      // In a book, a part's title looks like the page titles.
      this.ensure(40 + 60);
      this.pageTitle(block.title, block.subtitle);
      return;
    }
    const subtitle = block.subtitle
      ? this.wrap(block.subtitle, this.width, SANS, 9).slice(0, 2)
      : [];
    this.ensure(26 + subtitle.length * 12 + 60);
    this.line(block.title.toUpperCase(), this.left, this.y, this.width, {
      font: this.display,
      size: this.frame ? 12 : 15,
      color: this.primary,
      spacing: 1.7,
    });
    this.y += 21;
    for (const text of subtitle) {
      this.line(text, this.left, this.y, this.width, { font: SANS, size: 9, color: MUTED });
      this.y += 12;
    }
    this.rule(this.y + 2, this.primary, 0.8);
    this.y += 16;
  }

  /** Signature lines near the bottom of the last page. */
  signatures() {
    this.signatureLines(this.model.signatures);
  }

  /** Signature lines near the bottom of this page (on a new one when there is no room). */
  private signatureLines(labels: string[]) {
    if (labels.length === 0) return;
    if (this.y + 60 > this.bottom) this.newPage();
    const y = Math.max(this.y + 40, this.bottom - 34);
    const gap = 40;
    const width = Math.min(170, (this.width - gap * (labels.length - 1)) / labels.length);
    labels.forEach((label, i) => {
      // One line sits on the right; two or more spread across the page.
      const x =
        labels.length === 1
          ? this.left + this.width - width
          : this.left + (i * (this.width - width)) / (labels.length - 1);
      this.signatureImage(this.signed.get(label), x, y, width);
      this.rule(y, INK, 0.6, x, width);
      this.line(label, x, y + 5, width, { font: SANS, size: 7.4, color: MUTED, align: "center" });
    });
    this.y = y + 20;
  }

  /** A signature drawn by hand, standing on its line (a picture pdfkit cannot open is left out). */
  private signatureImage(bytes: Buffer | undefined, x: number, lineY: number, width: number) {
    if (!bytes) return;
    let image: OpenedImage;
    try {
      image = (this.doc as unknown as PdfImages).openImage(bytes);
    } catch {
      return;
    }
    const box = { width, height: 44 };
    const scale = Math.min(box.width / image.width, box.height / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    (this.doc as unknown as PdfImages).image(image, x + (width - w) / 2, lineY - h - 2, {
      width: w,
      height: h,
    });
  }
}

/**
 * The document as a PDF on letterhead. `images` holds the bytes of the rows'
 * reference pictures by file id (checked when uploaded); a row whose picture is
 * not there prints without it. `signed` holds signatures drawn by hand (checked
 * PNGs), printed on the signature line of the same label. `protect` locks the
 * PDF against editing (it still opens, prints and copies without a password).
 * `compress: false` keeps the page text readable (tests).
 */
export async function renderDocumentPdf(
  model: PrintDocument,
  options: RenderOptions = {},
): Promise<Buffer> {
  return (await renderWithParts(model, options)).bytes;
}

type RenderOptions = {
  logo?: Buffer | null;
  images?: ReadonlyMap<string, Buffer>;
  signed?: ReadonlyMap<string, Buffer>;
  protect?: boolean;
  compress?: boolean;
};

/** The pages a named part of a book runs over, counted from 1. */
export type PartPages = { key: string; first: number; last: number };

/**
 * The document as a PDF, with the pages each named part (a `section` with a
 * `key`) runs over: a part runs until the next named part starts, the last one
 * to the end. A booking book renders twice to print them on its cover.
 */
export async function renderWithParts(
  model: PrintDocument,
  options: RenderOptions = {},
): Promise<{ bytes: Buffer; parts: PartPages[]; pages: number }> {
  const doc = await createPdf({
    size: "A4",
    layout: model.frame?.orientation === "landscape" ? "landscape" : "portrait",
    margins: model.frame ? BOOK_MARGIN : MARGIN,
    bufferPages: true,
    compress: options.compress ?? true,
    ...(options.protect ? lockedPdf() : {}),
    info: {
      Title: pdfInfo(
        [model.letterhead.name, model.title, model.reference].filter(Boolean).join(" - "),
      ),
      Author: pdfInfo(model.letterhead.name),
      Subject: pdfInfo(model.title || "Letterhead"),
      Creator: "Extas ERP",
      Producer: "Extas ERP",
    },
  });
  const done = collectPdf(doc);
  const writer = new Writer(doc, model, options.logo ?? null, options.images, options.signed);
  if (model.frame) {
    writer.bookStart();
    for (const block of model.blocks) writer.block(block);
    writer.signatures();
    writer.watermarks();
    writer.bookFrames();
  } else {
    writer.letterhead();
    if (model.type !== "LETTERHEAD") {
      writer.titleBlock();
      writer.parties();
      for (const block of model.blocks) writer.block(block);
      writer.signatures();
    }
    writer.watermarks();
    writer.footers();
  }
  const pages = doc.bufferedPageRange().count;
  doc.end();
  const starts = writer.partStarts;
  const parts = starts.map((p, i) => ({
    key: p.key,
    first: p.page + 1,
    last: Math.max(p.page + 1, i + 1 < starts.length ? starts[i + 1]!.page : pages),
  }));
  return { bytes: await done, parts, pages };
}
