/*
 * Colour helpers shared by the PDF writer (lib/pdf.ts) and the pictures of
 * documents drawn in the browser (lib/document-image.ts). No Node imports.
 */

/** A "#RRGGBB" colour, or the fallback when it is anything else. */
export function safeHex(color: string | null | undefined, fallback: string): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

/** The colour mixed with white: amount 0 = the colour, 1 = white. */
export function tint(color: string, amount: number): string {
  const n = parseInt(color.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const [r, g, b] = [mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)];
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
