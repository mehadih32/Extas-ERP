import { inflateSync } from "node:zlib";

/*
 * Reads back the text of PDFs made by pdfkit. Every drawn piece of text is one
 * BT … ET block in a page's content stream. Built-in fonts (Helvetica, Times)
 * write WinAnsi bytes; the embedded Bengali font writes glyph ids, decoded with
 * its ToUnicode map. A line with Bengali in it is wrapped in a marked-content
 * span whose ActualText holds the line as typed.
 */

/** The Windows-1252 characters pdfkit writes for typographic punctuation. */
const WIN_ANSI: Record<number, string> = {
  0x85: "…",
  0x91: "‘",
  0x92: "’",
  0x93: "“",
  0x94: "”",
  0x95: "•",
  0x96: "–",
  0x97: "—",
};

type PdfObject = { dict: string; data: Buffer | null };

function readObjects(pdf: Buffer): Map<number, PdfObject> {
  const raw = pdf.toString("latin1");
  const objects = new Map<number, PdfObject>();
  const header = /(\d+) 0 obj\s*/g;
  for (let m = header.exec(raw); m; m = header.exec(raw)) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endobj", start);
    const body = raw.slice(start, end);
    const streamAt = body.search(/(?<!end)stream\r?\n/);
    if (streamAt < 0) {
      objects.set(Number(m[1]), { dict: body, data: null });
    } else {
      const dict = body.slice(0, streamAt);
      const offset = start + streamAt + /stream\r?\n/.exec(body.slice(streamAt))![0].length;
      const length = Number(/\/Length (\d+)/.exec(dict)?.[1] ?? 0);
      let data = pdf.subarray(offset, offset + length);
      if (/\/FlateDecode/.test(dict)) data = inflateSync(data);
      objects.set(Number(m[1]), { dict, data });
    }
    header.lastIndex = end;
  }
  return objects;
}

function utf16be(bytes: number[]): string {
  let out = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    out += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
  }
  return out;
}

const hexBytes = (hex: string) => [...Buffer.from(hex.replace(/\s+/g, ""), "hex")];

/** Code (glyph id) to text, from a ToUnicode CMap as pdfkit writes it (bfrange arrays). */
function readCmap(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const m of cmap.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*\[([^\]]*)\]/gi)) {
    let code = parseInt(m[1]!, 16);
    for (const entry of m[3]!.matchAll(/<([^>]*)>/g)) map.set(code++, utf16be(hexBytes(entry[1]!)));
  }
  return map;
}

type FontInfo = { name: string; cmap: Map<number, string> | null };

function readFonts(objects: Map<number, PdfObject>): Map<string, FontInfo> {
  const byObject = new Map<number, FontInfo>();
  for (const [num, obj] of objects) {
    if (!/\/Type \/Font\b/.test(obj.dict)) continue;
    const name = /\/BaseFont \/(\S+)/.exec(obj.dict)?.[1] ?? "";
    const toUnicode = /\/ToUnicode (\d+) 0 R/.exec(obj.dict)?.[1];
    const stream = toUnicode ? objects.get(Number(toUnicode))?.data : null;
    byObject.set(num, { name, cmap: stream ? readCmap(stream.toString("latin1")) : null });
  }
  // pdfkit names its fonts F1, F2… once per document, so one map serves every page.
  const byResource = new Map<string, FontInfo>();
  for (const obj of objects.values()) {
    for (const m of obj.dict.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
      const font = byObject.get(Number(m[2]));
      if (font) byResource.set(m[1]!, font);
    }
  }
  return byResource;
}

/** Page content streams, in page order. */
function pageContents(objects: Map<number, PdfObject>): string[] {
  const pages = [...objects.entries()]
    .filter(([, o]) => /\/Type \/Pages\b/.test(o.dict))
    .flatMap(([, o]) => [...(/\/Kids \[([^\]]*)\]/.exec(o.dict)?.[1] ?? "").matchAll(/(\d+) 0 R/g)])
    .map((m) => objects.get(Number(m[1])));
  return pages.flatMap((page) => {
    const ref = page && /\/Contents (\d+) 0 R/.exec(page.dict)?.[1];
    const data = ref ? objects.get(Number(ref))?.data : null;
    return data ? [data.toString("latin1")] : [];
  });
}

type Token =
  | { kind: "op"; value: string }
  | { kind: "name"; value: string }
  | { kind: "number"; value: number }
  | { kind: "string"; bytes: number[]; hex: string | null }
  | { kind: "array"; items: Token[] }
  | { kind: "dict"; entries: Map<string, Token> };

const ESCAPES: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };

/** A small reader for the content-stream syntax pdfkit writes. */
function tokenize(src: string): Token[] {
  let i = 0;
  const skip = () => {
    while (i < src.length && /\s/.test(src[i]!)) i++;
  };
  const read = (): Token | null => {
    skip();
    if (i >= src.length) return null;
    const ch = src[i]!;
    if (ch === "[") {
      i++;
      const items: Token[] = [];
      for (skip(); src[i] !== "]"; skip()) items.push(read()!);
      i++;
      return { kind: "array", items };
    }
    if (ch === "<" && src[i + 1] === "<") {
      i += 2;
      const entries = new Map<string, Token>();
      for (skip(); !(src[i] === ">" && src[i + 1] === ">"); skip()) {
        const key = read() as { kind: "name"; value: string };
        entries.set(key.value, read()!);
      }
      i += 2;
      return { kind: "dict", entries };
    }
    if (ch === "<") {
      const end = src.indexOf(">", i);
      const hex = src.slice(i + 1, end).replace(/\s+/g, "");
      i = end + 1;
      return { kind: "string", bytes: hexBytes(hex), hex };
    }
    if (ch === "(") {
      i++;
      const bytes: number[] = [];
      let depth = 0;
      while (i < src.length) {
        const c = src[i++]!;
        if (c === "\\") {
          const e = src[i++]!;
          if (/[0-7]/.test(e)) {
            let oct = e;
            while (oct.length < 3 && /[0-7]/.test(src[i]!)) oct += src[i++];
            bytes.push(parseInt(oct, 8));
          } else bytes.push(ESCAPES[e] ?? e.charCodeAt(0));
        } else if (c === "(") {
          depth++;
          bytes.push(40);
        } else if (c === ")") {
          if (depth === 0) break;
          depth--;
          bytes.push(41);
        } else bytes.push(c.charCodeAt(0));
      }
      return { kind: "string", bytes, hex: null };
    }
    if (ch === "/") {
      const m = /^\/[^\s/<>[\]()]*/.exec(src.slice(i))!;
      i += m[0].length;
      return { kind: "name", value: m[0].slice(1) };
    }
    const m = /^[^\s/<>[\]()]+/.exec(src.slice(i))!;
    i += m[0].length;
    return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(m[0])
      ? { kind: "number", value: Number(m[0]) }
      : { kind: "op", value: m[0] };
  };
  const tokens: Token[] = [];
  for (let t = read(); t; t = read()) tokens.push(t);
  return tokens;
}

function textOfString(bytes: number[]): string {
  return bytes[0] === 0xfe && bytes[1] === 0xff
    ? utf16be(bytes.slice(2))
    : bytes.map((b) => WIN_ANSI[b] ?? String.fromCharCode(b)).join("");
}

export type PdfTextBlock = {
  /** The font's PDF name: "Helvetica", or "ABCDEF+NotoSansBengali-Bold" for the embedded one. */
  font: string;
  /** The text the glyphs stand for (for the embedded font: glyph order, via ToUnicode). */
  text: string;
  /** How many glyphs were drawn. */
  glyphs: number;
  /** The ActualText of the span around the block, if any. */
  actualText: string | null;
  /** Where the block starts: its text matrix, in PDF units from the bottom left of the page. */
  x: number;
  y: number;
};

/** Every BT … ET block in drawing order, decoded. */
export function pdfTextBlocks(pdf: Buffer): PdfTextBlock[] {
  const objects = readObjects(pdf);
  const fonts = readFonts(objects);
  const blocks: PdfTextBlock[] = [];
  for (const content of pageContents(objects)) {
    const tokens = tokenize(content);
    const spans: Array<string | null> = [];
    let font: FontInfo | null = null;
    let block: PdfTextBlock | null = null;
    const show = (s: Token) => {
      if (!block || s.kind !== "string") return;
      if (font?.cmap && s.hex !== null) {
        const codes = s.hex.match(/.{4}/g) ?? [];
        block.glyphs += codes.length;
        block.text += codes.map((c) => font!.cmap!.get(parseInt(c, 16)) ?? "").join("");
      } else {
        block.glyphs += s.bytes.length;
        block.text += textOfString(s.bytes);
      }
    };
    tokens.forEach((t, k) => {
      if (t.kind !== "op") return;
      const prev = tokens[k - 1];
      const before = tokens[k - 2];
      if (t.value === "BDC") {
        const actual = prev?.kind === "dict" ? prev.entries.get("ActualText") : undefined;
        spans.push(actual?.kind === "string" ? textOfString(actual.bytes) : null);
      } else if (t.value === "BMC") spans.push(null);
      else if (t.value === "EMC") spans.pop();
      else if (t.value === "Tf" && before?.kind === "name") font = fonts.get(before.value) ?? null;
      else if (t.value === "Tm" && block && Number.isNaN(block.x)) {
        const [e, f] = tokens.slice(k - 2, k);
        if (e?.kind === "number" && f?.kind === "number") [block.x, block.y] = [e.value, f.value];
      } else if (t.value === "BT") {
        const actualText = [...spans].reverse().find((s) => s !== null) ?? null;
        block = { font: font?.name ?? "", text: "", glyphs: 0, actualText, x: NaN, y: NaN };
      } else if (t.value === "ET" && block) {
        block.font = font?.name ?? block.font;
        blocks.push(block);
        block = null;
      } else if (t.value === "TJ" && prev?.kind === "array") prev.items.forEach(show);
      else if (t.value === "Tj" && prev) show(prev);
    });
  }
  return blocks;
}

/**
 * Every line of text in the PDF, in drawing order: one entry per text block,
 * and one per ActualText span (a line with Bengali in it, as typed).
 */
export function pdfLines(pdf: Buffer): string[] {
  const lines: string[] = [];
  let lastSpan: string | null = null;
  for (const block of pdfTextBlocks(pdf)) {
    if (block.actualText === null) {
      lastSpan = null;
      lines.push(block.text);
    } else if (block.actualText !== lastSpan) {
      lastSpan = block.actualText;
      lines.push(block.actualText);
    }
  }
  return lines;
}

export const pageCount = (pdf: Buffer) =>
  pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length ?? 0;
