import { defaultPath, isItemPath, type TemplateType } from "@/modules/templates/tags";

/*
 * Turns tag names into the text that replaces them, for one fill of a template:
 * the template's own mappings first ({Customer} -> buyer.name), then the
 * catalog's meaning of the name, else nothing (the tag prints empty).
 */

/** The data of one document, every value already formatted for print. */
export type TemplateData = {
  /** Document values by source path ("buyer.name" -> "Rahim Traders"). */
  values: Record<string, string>;
  /** The document's lines, each by source path ("item.quantity" -> "120"). */
  items: Array<Record<string, string>>;
};

export type TagMapping = { path: string | null; format: string | null };

/** "upper" and "lower" change the letter case; anything else prints the value as it is. */
export function applyFormat(value: string, format: string | null | undefined): string {
  if (format === "upper") return value.toUpperCase();
  if (format === "lower") return value.toLowerCase();
  return value;
}

export type Resolver = {
  /** Whether the tag belongs to the document's lines (repeats per line in a table row). */
  isItem(name: string): boolean;
  /** The tag's text: for a line when one is given; item tags elsewhere list every line. */
  value(name: string, item?: Record<string, string>): string;
};

export function makeResolver(
  mappings: ReadonlyMap<string, TagMapping>,
  type: TemplateType,
  data: TemplateData,
): Resolver {
  const mappingOf = (name: string): TagMapping =>
    mappings.get(name) ?? { path: defaultPath(name, type), format: null };
  return {
    isItem: (name) => isItemPath(mappingOf(name).path),
    value(name, item) {
      const { path, format } = mappingOf(name);
      if (!path) return "";
      if (!isItemPath(path)) return applyFormat(data.values[path] ?? "", format);
      if (item) return applyFormat(item[path] ?? "", format);
      return data.items.map((line) => applyFormat(line[path] ?? "", format)).join("\n");
    },
  };
}

/**
 * Splits a text into the parts inside the given rows and the parts between
 * them. `rows` are [start, end) ranges; ones inside another chosen row are
 * dropped so each part is filled exactly once.
 */
export function splitByRows(
  length: number,
  rows: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number; row: boolean }> {
  const sorted = [...rows].sort((a, b) => a.start - b.start || b.end - a.end);
  const outer: Array<{ start: number; end: number }> = [];
  for (const row of sorted) {
    const last = outer.at(-1);
    if (last && row.start < last.end) {
      // Nested (or overlapping): the innermost row repeats, so the outer one goes.
      if (row.end <= last.end) outer[outer.length - 1] = row;
      continue;
    }
    outer.push(row);
  }
  const parts: Array<{ start: number; end: number; row: boolean }> = [];
  let at = 0;
  for (const row of outer) {
    if (row.start > at) parts.push({ start: at, end: row.start, row: false });
    parts.push({ start: row.start, end: row.end, row: true });
    at = row.end;
  }
  if (at < length) parts.push({ start: at, end: length, row: false });
  return parts;
}

/**
 * The [start, end) ranges of every element opened by `open` and closed by
 * `close` (both global patterns), nested ones included.
 */
export function elementRanges(
  text: string,
  open: RegExp,
  close: RegExp,
): Array<{ start: number; end: number }> {
  const marks = [
    ...[...text.matchAll(open)].map((m) => ({ at: m.index!, end: m.index!, opens: true })),
    ...[...text.matchAll(close)].map((m) => ({
      at: m.index!,
      end: m.index! + m[0].length,
      opens: false,
    })),
  ].sort((a, b) => a.at - b.at);
  const stack: number[] = [];
  const ranges: Array<{ start: number; end: number }> = [];
  for (const mark of marks) {
    if (mark.opens) stack.push(mark.at);
    else {
      const start = stack.pop();
      if (start !== undefined) ranges.push({ start, end: mark.end });
    }
  }
  return ranges;
}

/** The innermost range holding a position, or null. */
export function innermost(
  ranges: Array<{ start: number; end: number }>,
  position: number,
): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null;
  for (const r of ranges) {
    if (r.start <= position && position < r.end && (!best || r.start >= best.start)) best = r;
  }
  return best;
}
