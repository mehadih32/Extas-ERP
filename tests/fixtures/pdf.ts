import { inflateSync } from "node:zlib";

/*
 * Reads back the text of PDFs made by pdfkit: each drawn line is one TJ operator
 * with hex strings, in the page content streams (compressed or not).
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

function streams(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const parts: string[] = [];
  const marker = /(?<!end)stream\r?\n/g;
  for (let m = marker.exec(raw); m; m = marker.exec(raw)) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    const data = pdf.subarray(start, end);
    try {
      parts.push(inflateSync(data).toString("latin1"));
    } catch {
      parts.push(data.toString("latin1")); // not compressed
    }
    marker.lastIndex = end + "endstream".length;
  }
  return parts.join("\n");
}

/** Every line of text in the PDF, in drawing order. */
export function pdfLines(pdf: Buffer): string[] {
  return [...streams(pdf).matchAll(/\[([^\]]*)\]\s*TJ/g)].map((m) =>
    [...m[1]!.matchAll(/<([0-9a-f]*)>/gi)]
      .map((h) =>
        [...Buffer.from(h[1]!, "hex")].map((b) => WIN_ANSI[b] ?? String.fromCharCode(b)).join(""),
      )
      .join(""),
  );
}

export const pageCount = (pdf: Buffer) =>
  pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length ?? 0;
