import {
  collectPdf,
  createPdf,
  drawText,
  pdfInfo,
  pdfText,
  type TextStyle,
  textWidth,
  wrapText,
} from "@/lib/pdf";
import { pictureBox, placePicture } from "@/modules/backups/restore-guide-pictures";
import {
  DETAILS_TEXT,
  DRILL_PART,
  drillCommandLines,
  GUIDE_ERRORS,
  GUIDE_INTRO,
  GUIDE_NEEDS,
  GUIDE_PARTS,
  GUIDE_QUESTIONS,
  GUIDE_RULES,
  GUIDE_TITLE,
  GUIDE_WORDS,
  type GuideLang,
  type GuideStep,
  NO_GITHUB_PART,
  noGithubCommandLines,
  OTHER_MESSAGES,
  type Text,
} from "@/modules/backups/restore-guide";

/*
 * The restore guide as a PDF (G6): A4 portrait, in Bengali or English, for
 * someone who has never used a server. Big type, one action per step, a big
 * picture for most steps (a real screenshot when public/restore-guide has one,
 * else a drawing, each labelled as what it is) with what to click ringed in
 * red, the one command in a box to copy, "Your restore details", what to do
 * when GitHub cannot be reached, a practice drill with its own command, every
 * question the command asks and every error it can print.
 *
 * Words in “curly quotes” are what the screen shows and are printed in bold.
 * The command, codes, IDs and keys are printed in Courier and never cut: they
 * get smaller to fit, and else break over lines.
 *
 * The copy without details (`personal: null`) holds no secret: it goes into
 * every backup and stays on the server. The copy with details holds the Google
 * client (and the recovery key, only while the owner keeps it in Drive): it
 * goes only to the owner's Drive backup folder or straight to their computer.
 */

export type GuideDetails = {
  /** The one command (restoreCommandLines); null until the server recorded its version. */
  commandLines: string[] | null;
  commit: string | null;
  bootstrapSha256: string | null;
  version: string | null;
  builtAt: Date;
  /** "Your restore details"; null for the copy without them. */
  personal: {
    domain: string | null;
    clientId: string | null;
    clientSecret: string | null;
    /** Printed only in the Drive copy, while the owner keeps the key in Drive. */
    recoveryKey: string | null;
    /** The owner keeps the key in Drive (the restore reads it from there). */
    keyKept: boolean;
  } | null;
};

const PAGE = { width: 595.28, height: 841.89 };
const SIDE = 44;
const TOP = 54;
const BOTTOM = PAGE.height - 50;
const WIDTH = PAGE.width - 2 * SIDE;

const NAVY = "#1F4E79";
const INK = "#1F2933";
const MUTED = "#5B6573";
const RULE = "#C9D3DD";
const BOX = "#EEF4FA";
const TIP = "#FFF7DB";
const TIP_EDGE = "#E3B341";
const CODE_BG = "#F4F6F8";
const RED = "#B42318";
const AMBER = "#B54708";

/** Text Courier draws as it is: printable ASCII. */
const PLAIN = /^[\x20-\x7e]*$/;

const SANS = "Helvetica";
const SANS_BOLD = "Helvetica-Bold";
const SANS_ITALIC = "Helvetica-Oblique";
const MONO = "Courier";
const MONO_BOLD = "Courier-Bold";

const BODY = 11.5;
const BODY_LINE = 18;
const SMALL = 9.5;
const SMALL_LINE = 14.5;

type Piece = { text: string; bold: boolean };

/**
 * The words of a text, each made of pieces: what sits inside “curly quotes”
 * is bold. A word is never split; punctuation stays on its word.
 */
function words(text: string): Piece[][] {
  const out: Piece[][] = [];
  let word: Piece[] = [];
  let bold = false;
  let buffer = "";
  const flush = () => {
    if (buffer) word.push({ text: buffer, bold });
    buffer = "";
  };
  for (const ch of pdfText(text)) {
    if (ch === " ") {
      flush();
      if (word.length) out.push(word);
      word = [];
    } else if (ch === "“") {
      flush();
      bold = true;
      buffer = ch;
    } else if (ch === "”") {
      buffer += ch;
      flush();
      bold = false;
    } else buffer += ch;
  }
  flush();
  if (word.length) out.push(word);
  return out;
}

class GuideWriter {
  y = TOP;

  constructor(
    readonly doc: PDFKit.PDFDocument,
    readonly lang: GuideLang,
    readonly details: GuideDetails,
  ) {}

  t(text: Text) {
    return text[this.lang];
  }

  newPage() {
    this.doc.addPage();
    this.y = TOP;
  }

  /** A new page unless `height` still fits on this one. */
  need(height: number) {
    if (this.y + height > BOTTOM && this.y > TOP) this.newPage();
  }

  style(size: number, bold = false, italic = false): TextStyle {
    return { font: bold ? SANS_BOLD : italic ? SANS_ITALIC : SANS, size };
  }

  // --- Text with bold labels ------------------------------------------------------

  /** Lines of words that fit `width`; `lead` is a bold label before the text. */
  layout(text: string, width: number, size: number, bold = false, lead = ""): Piece[][][] {
    const space = textWidth(this.doc, " ", this.style(size));
    const widthOf = (word: Piece[]) =>
      word.reduce(
        (sum, p) => sum + textWidth(this.doc, p.text, this.style(size, bold || p.bold)),
        0,
      );
    const lines: Piece[][][] = [];
    let line: Piece[][] = [];
    let used = 0;
    const leading = lead ? words(lead).map((w) => w.map((p) => ({ ...p, bold: true }))) : [];
    for (const word of [...leading, ...words(text)]) {
      const w = widthOf(word);
      if (line.length && used + space + w > width) {
        lines.push(line);
        line = [];
        used = 0;
      }
      line.push(word);
      used += (line.length > 1 ? space : 0) + w;
    }
    if (line.length) lines.push(line);
    return lines;
  }

  richHeight(text: string, width: number, size = BODY, gap = BODY_LINE, bold = false, lead = "") {
    return this.layout(text, width, size, bold, lead).length * gap;
  }

  /** Draws a text at (x, this.y), moving down; labels in “quotes” in bold. */
  rich(
    text: string,
    o: {
      x?: number;
      width?: number;
      size?: number;
      gap?: number;
      color?: string;
      bold?: boolean;
      /** A bold label before the text ("What to do:"). */
      lead?: string;
    } = {},
  ) {
    const x = o.x ?? SIDE;
    const width = o.width ?? WIDTH;
    const size = o.size ?? BODY;
    const gap = o.gap ?? BODY_LINE;
    const space = textWidth(this.doc, " ", this.style(size));
    for (const line of this.layout(text, width, size, o.bold, o.lead)) {
      let cx = x;
      line.forEach((word, i) => {
        if (i > 0) cx += space;
        for (const piece of word) {
          this.doc.fillColor(o.color ?? INK);
          cx += drawText(this.doc, piece.text, cx, this.y, this.style(size, o.bold || piece.bold));
        }
      });
      this.y += gap;
    }
  }

  heading(text: string, size: number, color = NAVY) {
    const lines = wrapText(this.doc, text, WIDTH, this.style(size, true));
    for (const line of lines) {
      this.doc.fillColor(color);
      drawText(this.doc, line, SIDE, this.y, this.style(size, true));
      this.y += size * 1.45;
    }
  }

  // --- Monospace (commands, codes, keys): never cut ----------------------------------

  /** The width of a line in Courier (every letter is 0.6 of the size wide). */
  monoWidth(text: string, size: number) {
    return PLAIN.test(text)
      ? text.length * size * 0.6
      : textWidth(this.doc, text, { font: MONO, size });
  }

  /** One line in Courier with its top at y, every space kept (drawText would merge them). */
  mono(
    text: string,
    x: number,
    y: number,
    size: number,
    o: { bold?: boolean; color?: string } = {},
  ) {
    const font = o.bold ? MONO_BOLD : MONO;
    this.doc.fillColor(o.color ?? INK);
    if (PLAIN.test(text)) {
      this.doc.font(font).fontSize(size).text(text, x, y, { lineBreak: false });
    } else {
      drawText(this.doc, text, x, y, { font, size });
    }
  }

  /** A value in Courier within `width`: as large as fits (down to 7), else broken over lines. */
  monoLines(value: string, width: number, largest = 10): { size: number; lines: string[] } {
    const text = PLAIN.test(value) ? value : pdfText(value);
    for (let size = largest; size >= 7; size -= 0.5) {
      if (this.monoWidth(text, size) <= width) return { size, lines: [text] };
    }
    const size = 8;
    const per = Math.max(8, Math.floor(width / (size * 0.6)));
    const lines: string[] = [];
    for (let i = 0; i < text.length; i += per) lines.push(text.slice(i, i + per));
    return { size, lines };
  }

  /** Several lines in Courier, all at one size that fits the longest (never cut). */
  monoBlock(lines: string[], width: number, largest = 10): { size: number; lines: string[] } {
    let size = largest;
    const widest = () => Math.max(...lines.map((l) => this.monoWidth(l, size)));
    while (size > 6.5 && widest() > width) size -= 0.25;
    if (widest() <= width) return { size, lines };
    const per = Math.max(8, Math.floor(width / (size * 0.6)));
    return {
      size,
      lines: lines.flatMap((line) => {
        const parts: string[] = [];
        for (let i = 0; i < line.length; i += per) parts.push(line.slice(i, i + per));
        return parts;
      }),
    };
  }

  // --- Boxes ------------------------------------------------------------------------

  /**
   * A command in a box to copy from: the one command (C1), or the drill's or the
   * one without GitHub (with their own title and no checksum lines).
   */
  commandBox(
    lines = this.details.commandLines,
    title: Text = DETAILS_TEXT.commandTitle,
    missing: Text = DETAILS_TEXT.commandMissing,
    withFacts = true,
  ) {
    const inner = WIDTH - 24;
    const block = lines ? this.monoBlock(lines, inner, 10) : null;
    const lineGap = block ? block.size * 1.75 : 0;
    const noteH = this.richHeight(this.t(DETAILS_TEXT.commandNote), inner, SMALL, SMALL_LINE);
    const facts = withFacts ? this.commandFacts() : [];
    const factsH = facts.reduce((sum, f) => sum + f.lines.length * (f.size * 1.4) + 14, 0);
    const missingH = lines ? 0 : this.richHeight(this.t(missing), inner);
    const height = 34 + (block ? block.lines.length * lineGap + 16 : missingH) + noteH + factsH + 8;
    this.need(height);
    const top = this.y;
    this.doc.save();
    this.doc.roundedRect(SIDE, top, WIDTH, height, 6).lineWidth(1.2).fillAndStroke(BOX, NAVY);
    this.doc.restore();
    this.y = top + 10;
    this.doc.fillColor(NAVY);
    drawText(this.doc, this.t(title), SIDE + 12, this.y, this.style(13, true));
    this.y += 24;
    if (block) {
      this.doc.save();
      this.doc
        .rect(SIDE + 8, this.y - 6, WIDTH - 16, block.lines.length * lineGap + 8)
        .fill("#FFFFFF");
      this.doc.restore();
      for (const line of block.lines) {
        this.mono(line, SIDE + 12, this.y, block.size, { bold: true });
        this.y += lineGap;
      }
      this.y += 10;
    } else {
      this.rich(this.t(missing), { x: SIDE + 12, width: inner });
    }
    this.rich(this.t(DETAILS_TEXT.commandNote), {
      x: SIDE + 12,
      width: inner,
      size: SMALL,
      gap: SMALL_LINE,
      color: MUTED,
    });
    for (const fact of facts) {
      this.doc.fillColor(MUTED);
      drawText(this.doc, fact.label, SIDE + 12, this.y, this.style(8.5, true));
      this.y += 12;
      for (const line of fact.lines) {
        this.mono(line, SIDE + 12, this.y, fact.size);
        this.y += fact.size * 1.4;
      }
      this.y += 2;
    }
    this.y = top + height + 12;
  }

  commandFacts() {
    const out: Array<{ label: string; size: number; lines: string[] }> = [];
    const width = WIDTH - 24;
    if (this.details.bootstrapSha256) {
      out.push({
        label: `${this.t(DETAILS_TEXT.checksum)} (SHA-256)`,
        ...this.monoLines(this.details.bootstrapSha256, width, 8.5),
      });
    }
    if (this.details.commit) {
      const version = this.details.version
        ? `${this.details.version}, ${this.details.commit}`
        : this.details.commit;
      out.push({ label: this.t(DETAILS_TEXT.version), ...this.monoLines(version, width, 8.5) });
    }
    return out;
  }

  /** "Your restore details", or the note that this copy has none. */
  detailsBox() {
    const personal = this.details.personal;
    const inner = WIDTH - 24;
    const labelW = 150;
    const valueW = inner - labelW - 8;
    type Row = { label: string; mono?: { size: number; lines: string[] }; text?: string };
    const rows: Row[] = [];
    const missing = this.t(DETAILS_TEXT.missing);
    let reminder: string | null = null;
    if (personal) {
      rows.push({
        label: this.t(DETAILS_TEXT.domain),
        mono: this.monoLines(personal.domain ?? missing, valueW, 11),
      });
      rows.push({
        label: this.t(DETAILS_TEXT.clientId),
        mono: this.monoLines(personal.clientId ?? missing, valueW, 10),
      });
      rows.push({
        label: this.t(DETAILS_TEXT.clientSecret),
        mono: this.monoLines(personal.clientSecret ?? missing, valueW, 10),
      });
      if (personal.recoveryKey) {
        const exact = printsExactly(personal.recoveryKey);
        rows.push({
          label: this.t(DETAILS_TEXT.recoveryKey),
          mono: this.monoLines(personal.recoveryKey, valueW, 11),
        });
        rows.push({
          label: "",
          text: exact ? this.t(GUIDE_WORDS.keyPrinted) : this.t(GUIDE_WORDS.keyOdd),
        });
        reminder = this.t(GUIDE_WORDS.keep2Step);
      } else {
        rows.push({
          label: this.t(DETAILS_TEXT.recoveryKey),
          text: personal.keyKept ? this.t(DETAILS_TEXT.keyKept) : this.t(DETAILS_TEXT.keyNotKept),
        });
      }
    }
    const intro = personal ? this.t(DETAILS_TEXT.intro) : this.t(DETAILS_TEXT.empty);
    const rowHeight = (row: Row) =>
      Math.max(
        this.richHeight(row.label, labelW, SMALL, SMALL_LINE, true),
        row.mono
          ? row.mono.lines.length * row.mono.size * 1.45 + 2
          : this.richHeight(row.text ?? "", valueW, SMALL, SMALL_LINE),
      ) + 8;
    const height =
      34 +
      this.richHeight(intro, inner, SMALL, SMALL_LINE) +
      6 +
      rows.reduce((sum, r) => sum + rowHeight(r), 0) +
      (reminder ? this.richHeight(reminder, inner, SMALL, SMALL_LINE, true) + 6 : 0) +
      6;
    this.need(height);
    const top = this.y;
    this.doc.save();
    this.doc.roundedRect(SIDE, top, WIDTH, height, 6).lineWidth(1.6).fillAndStroke("#FFFFFF", NAVY);
    this.doc.roundedRect(SIDE, top, WIDTH, 28, 6).fill(NAVY);
    this.doc.rect(SIDE, top + 20, WIDTH, 8).fill(NAVY);
    this.doc.restore();
    this.doc.fillColor("#FFFFFF");
    const title = `${this.t(DETAILS_TEXT.title)}${this.lang === "bn" ? ` (${DETAILS_TEXT.title.en})` : ""}`;
    drawText(this.doc, title, SIDE + 12, top + 7, this.style(12.5, true));
    this.y = top + 36;
    this.rich(intro, { x: SIDE + 12, width: inner, size: SMALL, gap: SMALL_LINE });
    this.y += 6;
    for (const row of rows) {
      const rowTop = this.y;
      const h = rowHeight(row);
      if (row.label) {
        this.rich(row.label, {
          x: SIDE + 12,
          width: labelW,
          size: SMALL,
          gap: SMALL_LINE,
          bold: true,
        });
      }
      this.y = rowTop;
      if (row.mono) {
        for (const line of row.mono.lines) {
          this.mono(line, SIDE + 20 + labelW, this.y, row.mono.size, { bold: true });
          this.y += row.mono.size * 1.45;
        }
      } else if (row.text) {
        this.rich(row.text, {
          x: SIDE + 20 + labelW,
          width: valueW,
          size: SMALL,
          gap: SMALL_LINE,
        });
      }
      this.y = rowTop + h;
      this.doc.save();
      this.doc
        .moveTo(SIDE + 12, this.y - 4)
        .lineTo(SIDE + WIDTH - 12, this.y - 4)
        .lineWidth(0.4)
        .stroke(RULE);
      this.doc.restore();
    }
    if (reminder) {
      this.rich(reminder, {
        x: SIDE + 12,
        width: inner,
        size: SMALL,
        gap: SMALL_LINE,
        bold: true,
        color: RED,
      });
    }
    this.y = top + height + 14;
  }

  tipBox(text: string) {
    const lead = `${this.t(GUIDE_WORDS.tip)}:`;
    const inner = WIDTH - 28;
    const height = this.richHeight(text, inner, 10.5, 16, false, lead) + 14;
    const top = this.y;
    this.doc.save();
    this.doc.rect(SIDE, top, WIDTH, height).fill(TIP);
    this.doc.rect(SIDE, top, 4, height).fill(TIP_EDGE);
    this.doc.restore();
    this.y = top + 7;
    this.rich(text, { x: SIDE + 16, width: inner, size: 10.5, gap: 16, lead });
    this.y = top + height + 8;
  }

  // --- The parts of the guide -------------------------------------------------------

  cover() {
    this.y = TOP + 8;
    this.heading(this.t(GUIDE_TITLE), 21);
    this.y += 4;
    this.rich(this.t(GUIDE_INTRO));
    this.y += 8;
    this.heading(this.t(GUIDE_WORDS.needs), 13.5);
    for (const need of GUIDE_NEEDS) this.bullet(this.t(need));
    this.y += 6;
    this.heading(this.t(GUIDE_WORDS.rules), 13.5);
    GUIDE_RULES.forEach((rule, i) => this.bullet(this.t(rule), `${i + 1}.`));
    this.y += 8;
    this.detailsBox();
    this.need(30 + GUIDE_PARTS.length * BODY_LINE);
    this.heading(this.t(GUIDE_WORDS.glance), 13.5);
    for (const part of GUIDE_PARTS) {
      this.bullet(`${this.t(part.title)} (${part.steps.length}${this.t(GUIDE_WORDS.stepsCount)})`);
    }
    this.y += 4;
    this.rich(this.t(GUIDE_WORDS.otherCopy), { size: SMALL, gap: SMALL_LINE, color: MUTED });
  }

  bullet(text: string, mark = "•") {
    const h = this.richHeight(text, WIDTH - 18);
    this.need(h);
    this.doc.fillColor(NAVY);
    drawText(this.doc, mark, SIDE + 2, this.y, this.style(BODY, true));
    this.rich(text, { x: SIDE + 18, width: WIDTH - 18 });
  }

  partHeader(title: string, intro: string) {
    this.newPage();
    const top = this.y;
    this.doc.save();
    this.doc.roundedRect(SIDE, top, WIDTH, 34, 4).fill(NAVY);
    this.doc.restore();
    this.doc.fillColor("#FFFFFF");
    drawText(this.doc, title, SIDE + 14, top + 9, this.style(15, true));
    this.y = top + 46;
    this.rich(intro);
    this.y += 8;
  }

  /** A step's picture with its caption: the real screenshot's own shape, or the drawing's. */
  pictureHeight(step: GuideStep) {
    return step.picture ? pictureBox(step.picture, WIDTH).height + 20 : 0;
  }

  step(step: GuideStep) {
    const titleW = WIDTH - 56;
    const height =
      Math.max(26, this.richHeight(this.t(step.title), titleW, 13.5, 18, true)) +
      6 +
      this.richHeight(this.t(step.text), WIDTH) +
      (step.tip
        ? this.richHeight(
            this.t(step.tip),
            WIDTH - 28,
            10.5,
            16,
            false,
            `${this.t(GUIDE_WORDS.tip)}:`,
          ) + 24
        : 0) +
      this.pictureHeight(step) +
      16;
    this.need(height);
    const top = this.y;
    this.doc.save();
    this.doc.roundedRect(SIDE, top, 44, 26, 5).fill(NAVY);
    this.doc.restore();
    this.doc.fillColor("#FFFFFF");
    const idStyle = this.style(13, true);
    drawText(
      this.doc,
      step.id,
      SIDE + (44 - textWidth(this.doc, step.id, idStyle)) / 2,
      top + 6.5,
      idStyle,
    );
    this.y = top + 4;
    this.rich(this.t(step.title), { x: SIDE + 56, width: titleW, size: 13.5, gap: 18, bold: true });
    this.y = Math.max(this.y, top + 26) + 6;
    this.rich(this.t(step.text));
    this.y += 4;
    if (step.tip) this.tipBox(this.t(step.tip));
    if (step.command) this.commandBox();
    if (step.details) this.detailsBox();
    if (step.picture) {
      this.need(this.pictureHeight(step));
      const shown = placePicture(this.doc, step.picture, SIDE, this.y, WIDTH);
      this.y += shown.height + 4;
      this.doc.fillColor(MUTED);
      const caption = shown.screenshot ? GUIDE_WORDS.screenshot : GUIDE_WORDS.picture;
      drawText(this.doc, this.t(caption), SIDE, this.y, this.style(8.5, false, true));
      this.y += 16;
    }
    this.y += 10;
  }

  /** A part of numbered steps with its command box: without GitHub, or the drill. */
  numbered(
    part: { title: Text; intro: Text; steps: Text[]; commandMissing: Text },
    lines: string[] | null,
    commandTitle: Text,
  ) {
    this.partHeader(this.t(part.title), this.t(part.intro));
    part.steps.forEach((step, i) => {
      const h = this.richHeight(this.t(step), WIDTH - 26) + 8;
      this.need(h);
      const top = this.y;
      this.doc.fillColor(NAVY);
      drawText(this.doc, `${i + 1}.`, SIDE, top, this.style(BODY, true));
      this.rich(this.t(step), { x: SIDE + 26, width: WIDTH - 26 });
      this.y += 8;
    });
    this.y += 4;
    this.commandBox(lines, commandTitle, part.commandMissing, false);
  }

  questions() {
    this.partHeader(this.t(GUIDE_WORDS.questions), this.t(GUIDE_WORDS.questionsIntro));
    for (const q of GUIDE_QUESTIONS) {
      const block = this.monoLines(q.prompt.trimEnd(), WIDTH - 16, 9);
      const h =
        block.lines.length * block.size * 1.5 +
        12 +
        this.richHeight(this.t(q.answer), WIDTH - 16) +
        14;
      this.need(h);
      this.codeBlock(block);
      this.rich(this.t(q.answer), { x: SIDE + 8, width: WIDTH - 16 });
      this.y += 10;
    }
  }

  codeBlock(block: { size: number; lines: string[] }, color = INK) {
    const h = block.lines.length * block.size * 1.5 + 8;
    this.doc.save();
    this.doc.rect(SIDE, this.y, WIDTH, h).fill(CODE_BG);
    this.doc.restore();
    let y = this.y + 4;
    for (const line of block.lines) {
      this.mono(line, SIDE + 8, y, block.size, { bold: true, color });
      y += block.size * 1.5;
    }
    this.y += h + 6;
  }

  errors() {
    this.partHeader(this.t(GUIDE_WORDS.errors), this.t(GUIDE_WORDS.errorsIntro));
    const meaning = this.t(GUIDE_WORDS.meaning);
    const todo = this.t(GUIDE_WORDS.todo);
    for (const error of GUIDE_ERRORS) {
      const shown = `${error.code.startsWith("R") ? "Error" : "Note"} ${error.code}: ${error.shown}`;
      const block = this.monoLines(shown, WIDTH - 16, 9.5);
      const h =
        block.lines.length * block.size * 1.5 +
        14 +
        this.richHeight(this.t(error.meaning), WIDTH - 16, 10.5, 16, false, `${meaning}:`) +
        this.richHeight(this.t(error.todo), WIDTH - 16, 10.5, 16, false, `${todo}:`) +
        14;
      this.need(h);
      this.codeBlock(block, error.code.startsWith("R") ? RED : AMBER);
      const o = { x: SIDE + 8, width: WIDTH - 16, size: 10.5, gap: 16 };
      this.rich(this.t(error.meaning), { ...o, lead: `${meaning}:` });
      this.rich(this.t(error.todo), { ...o, lead: `${todo}:` });
      this.y += 10;
    }
  }

  others() {
    this.partHeader(this.t(GUIDE_WORDS.others), this.t(GUIDE_WORDS.othersIntro));
    for (const message of OTHER_MESSAGES) {
      const block = this.monoLines(message.shown, WIDTH - 16, 9.5);
      const where = `${this.t(GUIDE_WORDS.where)}:`;
      const todo = `${this.t(GUIDE_WORDS.todo)}:`;
      const h =
        block.lines.length * block.size * 1.5 +
        14 +
        this.richHeight(this.t(message.where), WIDTH - 16, 10.5, 16, false, where) +
        this.richHeight(this.t(message.todo), WIDTH - 16, 10.5, 16, false, todo) +
        14;
      this.need(h);
      this.codeBlock(block);
      const o = { x: SIDE + 8, width: WIDTH - 16, size: 10.5, gap: 16 };
      this.rich(this.t(message.where), { ...o, lead: where, color: MUTED });
      this.rich(this.t(message.todo), { ...o, lead: todo });
      this.y += 10;
    }
  }

  /** The header and footer of every page, once the pages are counted. */
  frames() {
    const range = this.doc.bufferedPageRange();
    const foot = this.style(8);
    const made = [
      `${this.t(GUIDE_WORDS.made)} ${this.details.builtAt.toISOString().slice(0, 10)}`,
      this.details.version,
      this.details.commit?.slice(0, 7),
    ]
      .filter(Boolean)
      .join(" · ");
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);
      const head = this.style(8.5, true);
      this.doc.fillColor(NAVY);
      drawText(this.doc, `Extas ERP · ${this.t(GUIDE_WORDS.guideName)}`, SIDE, 22, head);
      const lang = this.lang === "bn" ? "বাংলা" : "English";
      drawText(this.doc, lang, SIDE + WIDTH - textWidth(this.doc, lang, head), 22, head);
      this.doc.save();
      this.doc
        .moveTo(SIDE, 38)
        .lineTo(SIDE + WIDTH, 38)
        .lineWidth(1.2)
        .stroke(NAVY);
      this.doc
        .moveTo(SIDE, PAGE.height - 38)
        .lineTo(SIDE + WIDTH, PAGE.height - 38)
        .lineWidth(0.6)
        .stroke(RULE);
      this.doc.restore();
      const page = `${this.t(GUIDE_WORDS.page)} ${i - range.start + 1} / ${range.count}`;
      this.doc.fillColor(MUTED);
      drawText(this.doc, made, SIDE, PAGE.height - 31, foot);
      drawText(
        this.doc,
        page,
        SIDE + WIDTH - textWidth(this.doc, page, foot),
        PAGE.height - 31,
        foot,
      );
    }
  }
}

/** A key the PDF shows exactly as typed (no spaces it would merge, no letters it cannot draw). */
export function printsExactly(value: string): boolean {
  return pdfText(value) === value.normalize("NFC") && !/\s{2}/.test(value);
}

/** The restore guide as a PDF, in one language. */
export async function restoreGuidePdf(lang: GuideLang, details: GuideDetails): Promise<Buffer> {
  const doc = await createPdf({
    size: "A4",
    layout: "portrait",
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    bufferPages: true,
    info: {
      Title: pdfInfo(GUIDE_TITLE.en),
      Author: "Extas ERP",
      Subject: pdfInfo(GUIDE_TITLE[lang]),
      Creator: "Extas ERP",
      Producer: "Extas ERP",
    },
  });
  const done = collectPdf(doc);
  const writer = new GuideWriter(doc, lang, details);
  writer.cover();
  for (const part of GUIDE_PARTS) {
    writer.partHeader(writer.t(part.title), writer.t(part.intro));
    for (const step of part.steps) writer.step(step);
  }
  writer.numbered(
    NO_GITHUB_PART,
    noGithubCommandLines(details.commandLines),
    GUIDE_WORDS.noGithubCommand,
  );
  writer.numbered(DRILL_PART, drillCommandLines(details.commandLines), GUIDE_WORDS.drillCommand);
  writer.questions();
  writer.errors();
  writer.others();
  writer.frames();
  doc.end();
  return done;
}
