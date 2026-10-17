// The Full check's look at the text of the PDFs the ERP makes (v6.4): a figure is
// never cut short with "…", and a PDF of more than one page has its page number on
// every page ("Page 2 of 5", "PAGE 2 OF 7", "Page 2 / 5"). Only PDFs the ERP made
// (Producer "Extas ERP") are read: a file someone uploaded is theirs, not the ERP's.
//
// It reads PDFs as the ERP's PDF writer (pdfkit) writes them, with nothing to
// install: every piece of text is a BT … ET block in a page's content stream; the
// built-in fonts (Helvetica, Times) write WinAnsi bytes, the embedded Bengali font
// writes glyph ids (read with its ToUnicode map), and a line with Bengali in it
// carries the line as typed in an ActualText span. tests/fixtures/pdf.ts reads them
// the same way for the unit tests. Tested in tests/unit/pdf-check.test.ts.

import { inflateSync } from "node:zlib";

/** The Windows-1252 characters pdfkit writes for typographic punctuation. */
const WIN_ANSI = {
  0x85: "…",
  0x91: "‘",
  0x92: "’",
  0x93: "“",
  0x94: "”",
  0x95: "•",
  0x96: "–",
  0x97: "—",
};

function readObjects(pdf) {
  const raw = pdf.toString("latin1");
  const objects = new Map();
  const header = /(\d+) 0 obj\s*/g;
  for (let m = header.exec(raw); m; m = header.exec(raw)) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endobj", start);
    if (end < 0) break;
    const body = raw.slice(start, end);
    const streamAt = body.search(/(?<!end)stream\r?\n/);
    if (streamAt < 0) {
      objects.set(Number(m[1]), { dict: body, data: null });
    } else {
      const dict = body.slice(0, streamAt);
      const offset = start + streamAt + /stream\r?\n/.exec(body.slice(streamAt))[0].length;
      const length = Number(/\/Length (\d+)/.exec(dict)?.[1] ?? 0);
      let data = pdf.subarray(offset, offset + length);
      if (/\/FlateDecode/.test(dict)) {
        try {
          data = inflateSync(data);
        } catch {
          data = Buffer.alloc(0);
        }
      }
      objects.set(Number(m[1]), { dict, data });
    }
    header.lastIndex = end;
  }
  return objects;
}

const utf16be = (bytes) => {
  let out = "";
  for (let i = 0; i + 1 < bytes.length; i += 2)
    out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  return out;
};

const hexBytes = (hex) => [...Buffer.from(hex.replace(/\s+/g, ""), "hex")];

/** Code (glyph id) to text, from a ToUnicode CMap as pdfkit writes it (bfrange arrays). */
function readCmap(cmap) {
  const map = new Map();
  for (const m of cmap.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*\[([^\]]*)\]/gi)) {
    let code = parseInt(m[1], 16);
    for (const entry of m[3].matchAll(/<([^>]*)>/g)) map.set(code++, utf16be(hexBytes(entry[1])));
  }
  return map;
}

function readFonts(objects) {
  const byObject = new Map();
  for (const [num, obj] of objects) {
    if (!/\/Type \/Font\b/.test(obj.dict)) continue;
    const toUnicode = /\/ToUnicode (\d+) 0 R/.exec(obj.dict)?.[1];
    const stream = toUnicode ? objects.get(Number(toUnicode))?.data : null;
    byObject.set(num, { cmap: stream ? readCmap(stream.toString("latin1")) : null });
  }
  const byResource = new Map();
  for (const obj of objects.values()) {
    for (const m of obj.dict.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
      const font = byObject.get(Number(m[2]));
      if (font) byResource.set(m[1], font);
    }
  }
  return byResource;
}

/** Page content streams, in page order. */
function pageContents(objects) {
  const pages = [...objects.values()]
    .filter((o) => /\/Type \/Pages\b/.test(o.dict))
    .flatMap((o) => [...(/\/Kids \[([^\]]*)\]/.exec(o.dict)?.[1] ?? "").matchAll(/(\d+) 0 R/g)])
    .map((m) => objects.get(Number(m[1])))
    .filter((page) => page && /\/Type \/Page\b/.test(page.dict));
  return pages.map((page) => {
    const refs = /\/Contents\s*(\[[^\]]*\]|\d+ 0 R)/.exec(page.dict)?.[1] ?? "";
    return [...refs.matchAll(/(\d+) 0 R/g)]
      .map((m) => objects.get(Number(m[1]))?.data?.toString("latin1") ?? "")
      .join("\n");
  });
}

const ESCAPES = { n: 10, r: 13, t: 9, b: 8, f: 12 };

/** A small reader for the content-stream syntax pdfkit writes. */
function tokenize(src) {
  let i = 0;
  const skip = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const read = () => {
    skip();
    if (i >= src.length) return null;
    const ch = src[i];
    if (ch === "[") {
      i++;
      const items = [];
      for (skip(); i < src.length && src[i] !== "]"; skip()) {
        const t = read();
        if (!t) break;
        items.push(t);
      }
      i++;
      return { kind: "array", items };
    }
    if (ch === "<" && src[i + 1] === "<") {
      i += 2;
      const entries = new Map();
      for (skip(); i < src.length && !(src[i] === ">" && src[i + 1] === ">"); skip()) {
        const key = read();
        const value = read();
        if (!key || !value) break;
        entries.set(key.value, value);
      }
      i += 2;
      return { kind: "dict", entries };
    }
    if (ch === "<") {
      const end = src.indexOf(">", i);
      const hex = src.slice(i + 1, end < 0 ? src.length : end).replace(/\s+/g, "");
      i = end < 0 ? src.length : end + 1;
      return { kind: "string", bytes: hexBytes(hex), hex };
    }
    if (ch === "(") {
      i++;
      const bytes = [];
      let depth = 0;
      while (i < src.length) {
        const c = src[i++];
        if (c === "\\") {
          const e = src[i++];
          if (/[0-7]/.test(e)) {
            let oct = e;
            while (oct.length < 3 && /[0-7]/.test(src[i])) oct += src[i++];
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
      const m = /^\/[^\s/<>[\]()]*/.exec(src.slice(i, i + 200));
      i += m[0].length;
      return { kind: "name", value: m[0].slice(1) };
    }
    const m = /^[^\s/<>[\]()]+/.exec(src.slice(i, i + 200));
    if (!m) {
      i++;
      return { kind: "op", value: ch };
    }
    i += m[0].length;
    return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(m[0])
      ? { kind: "number", value: Number(m[0]) }
      : { kind: "op", value: m[0] };
  };
  const tokens = [];
  for (let t = read(); t; t = read()) tokens.push(t);
  return tokens;
}

const textOfString = (bytes) =>
  bytes[0] === 0xfe && bytes[1] === 0xff
    ? utf16be(bytes.slice(2))
    : bytes.map((b) => WIN_ANSI[b] ?? String.fromCharCode(b)).join("");

/** The lines of text on each page: one per text block, or per ActualText span (Bengali). */
export function pdfPages(pdf) {
  const objects = readObjects(pdf);
  const fonts = readFonts(objects);
  return pageContents(objects).map((content) => {
    const tokens = tokenize(content);
    const lines = [];
    const spans = [];
    let lastSpan = null;
    let font = null;
    let block = null;
    const show = (s) => {
      if (!block || s?.kind !== "string") return;
      block.text +=
        font?.cmap && s.hex !== null
          ? (s.hex.match(/.{4}/g) ?? []).map((c) => font.cmap.get(parseInt(c, 16)) ?? "").join("")
          : textOfString(s.bytes);
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
      else if (t.value === "BT") {
        block = { text: "", actualText: [...spans].reverse().find((s) => s !== null) ?? null };
      } else if (t.value === "ET" && block) {
        if (block.actualText === null) {
          lastSpan = null;
          lines.push(block.text);
        } else if (block.actualText !== lastSpan) {
          lastSpan = block.actualText;
          lines.push(block.actualText);
        }
        block = null;
      } else if (t.value === "TJ" && prev?.kind === "array") prev.items.forEach(show);
      else if (t.value === "Tj" && prev) show(prev);
    });
    return lines;
  });
}

/** Whether the ERP made this PDF: its Producer (written in place, or as an object of its own) is "Extas ERP". */
export function madeByErp(pdf) {
  const raw = pdf.toString("latin1");
  const producer = /\/Producer\s*(?:\(([^)]*)\)|<([0-9a-fA-F\s]*)>|(\d+) 0 R)/.exec(raw);
  if (!producer) return false;
  let literal = producer[1] ?? null;
  let hex = producer[2] ?? null;
  if (producer[3]) {
    const body = new RegExp(
      `(?:^|\\s)${producer[3]} 0 obj\\s*(?:\\(([^)]*)\\)|<([0-9a-fA-F\\s]*)>)`,
    ).exec(raw);
    literal = body?.[1] ?? null;
    hex = body?.[2] ?? null;
  }
  const text = literal ?? (hex === null ? "" : textOfString(hexBytes(hex)));
  return text === "Extas ERP";
}

/** A figure cut short: a digit and then "…" (or "..."). */
const CUT_FIGURE = /\d(?:…|\.\.\.)/;

/** "Page 2 of 5", "PAGE 2 OF 7", "Page 2 / 5" (the restore guide), in English or Bengali. */
const PAGE_NUMBER = /(?:page|পৃষ্ঠা)\s*(\d+)\s*(?:of|\/)\s*(\d+)/giu;

/**
 * What is wrong with the text of a PDF the ERP made: [{ what, page, detail }], none for
 * a PDF someone else made.
 *   CUT_FIGURE      a figure cut short with "…" on that page
 *   NO_PAGE_NUMBER  a page of a PDF of more than one page without its page number
 */
export function pdfProblems(pdf) {
  if (!madeByErp(pdf)) return [];
  const pages = pdfPages(pdf);
  const problems = [];
  pages.forEach((lines, i) => {
    const page = i + 1;
    const cut = lines.find((line) => CUT_FIGURE.test(line));
    if (cut) {
      problems.push({
        what: "CUT_FIGURE",
        page,
        detail: `has a figure cut short with "…" on page ${page}`,
        text: cut.slice(0, 120),
      });
    }
    if (pages.length < 2) return;
    const numbered = [...lines.join("\n").matchAll(PAGE_NUMBER)].some(
      (m) => Number(m[1]) === page && Number(m[2]) === pages.length,
    );
    if (!numbered) {
      problems.push({
        what: "NO_PAGE_NUMBER",
        page,
        detail: `has no page number on page ${page}`,
      });
    }
  });
  return problems;
}
