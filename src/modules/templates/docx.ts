import { strFromU8, strToU8, unzipSync, type Unzipped, zipSync } from "fflate";

import { elementRanges, innermost, type Resolver, splitByRows } from "@/modules/templates/resolve";
import { TAG_PATTERN, tagName } from "@/modules/templates/tags";

/*
 * Word templates (.docx). A .docx is a zip of XML parts; the text sits in <w:t>
 * elements inside runs, and Word often splits what was typed as one word over
 * several runs ("{Buyer" + "Name}" after a spell check or a format change). So
 * tags are found in the joined text of each paragraph and replaced across the
 * runs they span: the first run gets the value, the others lose the tag's
 * letters, and every run keeps its own formatting.
 *
 * A table row with item tags is repeated once per line of the document. Values
 * with line breaks get Word line breaks. The body, headers and footers are
 * filled; everything else in the file is kept byte for byte.
 */

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** A broken or unsuitable file; the message says what to do. */
export class TemplateFileError extends Error {}

const MAX_ENTRIES = 2_000;
const MAX_UNZIPPED_BYTES = 60 * 1024 * 1024;

/** The parts with text to fill: the body, headers, footers, footnotes and endnotes. */
const TEXT_PART = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

/** Whether the bytes are a zip archive (a .docx is one). */
export const isZip = (bytes: Buffer) =>
  bytes.length > 4 &&
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  bytes[2] === 0x03 &&
  bytes[3] === 0x04;

/** Opens a .docx, refusing anything that is not a plain Word document. */
export function openDocx(bytes: Buffer): Unzipped {
  let entries = 0;
  let total = 0;
  let files: Unzipped;
  try {
    files = unzipSync(new Uint8Array(bytes), {
      filter(file) {
        entries += 1;
        total += file.originalSize;
        if (entries > MAX_ENTRIES || total > MAX_UNZIPPED_BYTES) {
          throw new TemplateFileError("This Word file is too large to use as a template.");
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof TemplateFileError) throw error;
    throw new TemplateFileError("This Word file is damaged. Open it in Word and save it again.");
  }
  if (!files["word/document.xml"]) {
    throw new TemplateFileError(
      "This is not a Word document. Save it as .docx and upload it again.",
    );
  }
  const types = files["[Content_Types].xml"];
  if (files["word/vbaProject.bin"] || (types && /macroEnabled/i.test(strFromU8(types)))) {
    throw new TemplateFileError(
      "Word files with macros (.docm) cannot be templates. Save it as a plain .docx.",
    );
  }
  return files;
}

const xmlDecode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code: string) => {
    const lower = code.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    const point = lower.startsWith("#x")
      ? parseInt(lower.slice(2), 16)
      : parseInt(lower.slice(1), 10);
    return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });

const xmlEncode = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Characters XML 1.0 cannot hold (control characters other than tab and line breaks). */
const XML_INVALID = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g;

/** A <w:t> element: its place in the part, its text and the paragraph it is in. */
type TextNode = { start: number; end: number; text: string; paragraph: number };

const TEXT_NODE = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:t(?:\s[^>]*)?\/>/g;
/** A paragraph starting or ending (<w:p>, <w:p ...>, </w:p>, <w:p/>; not <w:pPr>). */
const PARAGRAPH_MARK = /<\/?w:p[\s>/]/g;

function textNodes(xml: string): TextNode[] {
  const marks = [...xml.matchAll(PARAGRAPH_MARK)].map((m) => m.index!);
  const nodes: TextNode[] = [];
  let paragraph = 0;
  for (const m of xml.matchAll(TEXT_NODE)) {
    while (paragraph < marks.length && marks[paragraph]! < m.index!) paragraph += 1;
    nodes.push({
      start: m.index!,
      end: m.index! + m[0].length,
      text: xmlDecode(m[1] ?? ""),
      paragraph,
    });
  }
  return nodes;
}

/** Runs of text nodes in the same paragraph (a tag never spans two paragraphs). */
function paragraphGroups(nodes: TextNode[]): TextNode[][] {
  const groups: TextNode[][] = [];
  for (const node of nodes) {
    const last = groups.at(-1);
    if (last && last[0]!.paragraph === node.paragraph) last.push(node);
    else groups.push([node]);
  }
  return groups;
}

type TagHit = { name: string; position: number };

/** Every tag in a part, with the position of the text node it starts in. */
function tagHits(xml: string): TagHit[] {
  const hits: TagHit[] = [];
  for (const group of paragraphGroups(textNodes(xml))) {
    const joined = group.map((n) => n.text).join("");
    if (!joined.includes("{")) continue;
    for (const match of joined.matchAll(TAG_PATTERN)) {
      let offset = match.index!;
      const node = group.find((n) => {
        if (offset < n.text.length) return true;
        offset -= n.text.length;
        return false;
      });
      hits.push({ name: tagName(match), position: node?.start ?? group[0]!.start });
    }
  }
  return hits;
}

/** A <w:t> element holding the text; line breaks and tabs become Word's own. */
function textElement(text: string): string {
  const safe = xmlEncode(text.replace(XML_INVALID, ""));
  const body = safe
    .split(/\r\n|\r|\n/)
    .map((line) => line.split("\t").join('</w:t><w:tab/><w:t xml:space="preserve">'))
    .join('</w:t><w:br/><w:t xml:space="preserve">');
  return `<w:t xml:space="preserve">${body}</w:t>`;
}

/** Replaces every tag in an XML fragment, keeping each run's formatting. */
function fillXml(xml: string, valueOf: (name: string) => string): string {
  const edits: Array<{ node: TextNode; text: string }> = [];
  for (const group of paragraphGroups(textNodes(xml))) {
    const joined = group.map((n) => n.text).join("");
    if (!joined.includes("{")) continue;
    const matches = [...joined.matchAll(TAG_PATTERN)];
    if (matches.length === 0) continue;
    const texts = group.map((n) => n.text);
    const starts: number[] = [];
    group.reduce((at, n) => (starts.push(at), at + n.text.length), 0);
    /** The node holding a position of the joined text, and the offset inside it. */
    const locate = (at: number, isEnd: boolean) => {
      for (let i = group.length - 1; i >= 0; i--) {
        const s = starts[i]!;
        if (isEnd ? at > s : at >= s) return { i, offset: at - s };
      }
      return { i: 0, offset: 0 };
    };
    // Right to left, so the offsets of earlier tags stay valid.
    for (const match of matches.reverse()) {
      const value = valueOf(tagName(match));
      const from = locate(match.index!, false);
      const to = locate(match.index! + match[0].length, true);
      if (from.i === to.i) {
        const t = texts[from.i]!;
        texts[from.i] = t.slice(0, from.offset) + value + t.slice(to.offset);
      } else {
        texts[from.i] = texts[from.i]!.slice(0, from.offset) + value;
        for (let k = from.i + 1; k < to.i; k++) texts[k] = "";
        texts[to.i] = texts[to.i]!.slice(to.offset);
      }
    }
    group.forEach((node, i) => {
      if (texts[i] !== node.text) edits.push({ node, text: texts[i]! });
    });
  }
  if (edits.length === 0) return xml;
  let out = "";
  let at = 0;
  for (const { node, text } of edits.sort((a, b) => a.node.start - b.node.start)) {
    out += xml.slice(at, node.start) + textElement(text);
    at = node.end;
  }
  return out + xml.slice(at);
}

const ROW_OPEN = /<w:tr[\s>]/g;
const ROW_CLOSE = /<\/w:tr>/g;

/** Fills one XML part: item rows once per line, everything else once. */
function fillPart(xml: string, resolver: Resolver, items: Array<Record<string, string>>): string {
  const itemHits = tagHits(xml).filter((hit) => resolver.isItem(hit.name));
  const ranges = itemHits.length > 0 ? elementRanges(xml, ROW_OPEN, ROW_CLOSE) : [];
  const rows = itemHits
    .map((hit) => innermost(ranges, hit.position))
    .filter((r): r is { start: number; end: number } => r !== null);
  const unique = [...new Map(rows.map((r) => [`${r.start}:${r.end}`, r])).values()];
  return splitByRows(xml.length, unique)
    .map((part) => {
      const piece = xml.slice(part.start, part.end);
      if (!part.row) return fillXml(piece, (name) => resolver.value(name));
      return items.map((item) => fillXml(piece, (name) => resolver.value(name, item))).join("");
    })
    .join("");
}

/** The tag names used in a Word template (body, headers, footers), in order. */
export function docxTags(bytes: Buffer): string[] {
  const files = openDocx(bytes);
  const names = new Set<string>();
  for (const [path, data] of Object.entries(files)) {
    if (!TEXT_PART.test(path)) continue;
    for (const hit of tagHits(strFromU8(data))) names.add(hit.name);
  }
  return [...names];
}

/** The Word template with every tag filled in. */
export function fillDocx(
  bytes: Buffer,
  resolver: Resolver,
  items: Array<Record<string, string>>,
): Buffer {
  const files = openDocx(bytes);
  const out: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(files)) {
    out[path] = TEXT_PART.test(path) ? strToU8(fillPart(strFromU8(data), resolver, items)) : data;
  }
  return Buffer.from(zipSync(out, { level: 6 }));
}
