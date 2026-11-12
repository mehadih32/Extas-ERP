import { fileResponse } from "@/lib/download";
import { PDF_MIME } from "@/lib/pdf";
import { checkRateLimit } from "@/lib/rate-limit";
import { linkVisitor, openDocumentLink } from "@/modules/documents/send.service";

export const dynamic = "force-dynamic";

const notFound = () =>
  new Response("This link does not work: it may have expired or been stopped.", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });

/**
 * GET /api/public/documents/:token — the one PDF a WhatsApp link was made for, without
 * signing in. A wrong, stopped or expired token answers 404 and shows nothing else.
 */
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const ip = linkVisitor(request.headers) ?? "unknown";
  try {
    checkRateLimit(`doc-link:${ip}`, 60, 60_000);
  } catch {
    return new Response("Too many requests. Try again in a minute.", { status: 429 });
  }
  const file = await openDocumentLink(token).catch(() => null);
  if (!file) return notFound();
  const response = fileResponse({ ...file, mimeType: PDF_MIME }, "inline");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
