import { elementRanges, innermost, type Resolver, splitByRows } from "@/modules/templates/resolve";
import { TAG_PATTERN, tagName } from "@/modules/templates/tags";
import { TemplateFileError } from "@/modules/templates/docx";

/*
 * HTML templates: a page designed in any editor, with tags in its text (or in
 * attribute values). Values are escaped, so data can never add markup, and line
 * breaks become <br>. A table row (<tr>) with item tags repeats once per line.
 * The filled page is a download the user opens and prints from the browser; it
 * is never shown inside the app.
 *
 * Templates must be plain documents: scripts, frames, forms, event handlers and
 * javascript: links are refused at upload.
 */

export const HTML_MIME = "text/html; charset=utf-8";
export const MAX_HTML_CHARS = 1_000_000;

const FORBIDDEN: Array<[RegExp, string]> = [
  [/<\s*script\b/i, "scripts"],
  [/<\s*(iframe|frame|frameset|object|embed|applet|portal)\b/i, "embedded frames or objects"],
  [/<\s*(form|input|button|textarea|select)\b/i, "form fields"],
  [/<\s*base\b/i, "a <base> tag"],
  [/<\s*meta\b[^>]*http-equiv/i, "<meta http-equiv>"],
  [/<\s*link\b[^>]*\brel\s*=\s*["']?\s*import/i, "HTML imports"],
  [/<[a-z][^>]*[\s"'/]on[a-z]+\s*=/i, "event handlers (onclick, onload...)"],
  [/(=|url\()\s*["']?\s*(javascript|vbscript)\s*:/i, "javascript: links"],
  [/(=|url\()\s*["']?\s*data\s*:\s*text\/html/i, "embedded HTML pages"],
];

/** Character references decoded (&#106; -> j, &colon; -> :) so they cannot hide a forbidden word. */
const decodeReferences = (html: string) =>
  html
    .replace(/&#x([0-9a-f]{1,6});?/gi, (_, hex: string) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d{1,7});?/g, (_, dec: string) => safeChar(parseInt(dec, 10)))
    .replace(/&colon;/gi, ":")
    .replace(/&(tab|newline);/gi, "");

const safeChar = (code: number) => (code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "");

/** Reads an uploaded HTML file: UTF-8 text that looks like a web page, or null. */
export function decodeHtml(bytes: Buffer): string | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  text = text.replace(/^\uFEFF/, "");
  return /<\s*(!doctype\s+html|html|head|body|table|div|p|h[1-6])\b/i.test(text) ? text : null;
}

/** Refuses HTML that could run anything; returns the HTML when it is a plain document. */
export function checkHtml(html: string): string {
  if (html.length > MAX_HTML_CHARS) {
    throw new TemplateFileError("HTML templates can be up to 1 MB.");
  }
  if (!/<\s*[a-z!]/i.test(html)) {
    throw new TemplateFileError("This does not look like an HTML page.");
  }
  // Browsers ignore tabs and line breaks inside "java\tscript:", so the check does too.
  const decoded = decodeReferences(html).replace(/[\t\r\n]/g, "");
  for (const [pattern, what] of FORBIDDEN) {
    if (pattern.test(html) || pattern.test(decoded)) {
      throw new TemplateFileError(
        `HTML templates cannot contain ${what}. Remove them and try again.`,
      );
    }
  }
  return html;
}

/** The tag names used in an HTML template, in order. */
export function htmlTags(html: string): string[] {
  const names = new Set<string>();
  for (const match of html.matchAll(TAG_PATTERN)) names.add(tagName(match));
  return [...names];
}

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const asHtml = (value: string) => escapeHtml(value).replace(/\r\n|\r|\n/g, "<br>");

function fillText(html: string, valueOf: (name: string) => string): string {
  return html.replace(new RegExp(TAG_PATTERN.source, "g"), (...args: string[]) =>
    asHtml(valueOf((args[1] ?? args[2])!)),
  );
}

const ROW_OPEN = /<tr[\s>]/gi;
const ROW_CLOSE = /<\/tr\s*>/gi;

/** The HTML template with every tag filled in; item rows repeat once per line. */
export function fillHtml(
  html: string,
  resolver: Resolver,
  items: Array<Record<string, string>>,
): string {
  const itemHits = [...html.matchAll(TAG_PATTERN)].filter((m) => resolver.isItem(tagName(m)));
  const ranges = itemHits.length > 0 ? elementRanges(html, ROW_OPEN, ROW_CLOSE) : [];
  const rows = itemHits
    .map((m) => innermost(ranges, m.index!))
    .filter((r): r is { start: number; end: number } => r !== null);
  const unique = [...new Map(rows.map((r) => [`${r.start}:${r.end}`, r])).values()];
  return splitByRows(html.length, unique)
    .map((part) => {
      const piece = html.slice(part.start, part.end);
      if (!part.row) return fillText(piece, (name) => resolver.value(name));
      return items.map((item) => fillText(piece, (name) => resolver.value(name, item))).join("");
    })
    .join("");
}
