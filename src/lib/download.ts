/** RFC 5987 encoding: encodeURIComponent leaves ' ( ) * as they are. */
export const encodeFileName = (name: string) =>
  encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/**
 * A stored file as a response: saved as a download (attachment) or shown in the
 * browser (inline). Never cached by shared caches, never type-sniffed.
 */
export function fileResponse(
  file: { fileName: string; mimeType: string; bytes: Buffer },
  disposition: "attachment" | "inline" = "attachment",
): Response {
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.bytes.length),
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeFileName(file.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
