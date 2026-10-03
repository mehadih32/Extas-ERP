/** RFC 5987 encoding: encodeURIComponent leaves ' ( ) * as they are. */
export const encodeFileName = (name: string) =>
  encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** Types a browser can show without running anything in it: photos and PDFs. */
const INLINE_SAFE = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

/**
 * A stored file as a response: saved as a download (attachment) or shown in the
 * browser (inline). Never cached by shared caches, never type-sniffed. Anything
 * but a photo or a PDF (a Word or HTML template) is always a download, and
 * sandboxed, so it can never run as a page of the app.
 */
export function fileResponse(
  file: { fileName: string; mimeType: string; bytes: Buffer },
  disposition: "attachment" | "inline" = "attachment",
): Response {
  const safe = INLINE_SAFE.has(file.mimeType);
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.bytes.length),
      "Content-Disposition": `${safe ? disposition : "attachment"}; filename*=UTF-8''${encodeFileName(file.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      ...(safe ? {} : { "Content-Security-Policy": "sandbox" }),
    },
  });
}
