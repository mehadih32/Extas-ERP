import { NextResponse } from "next/server";

import { AppError } from "@/lib/errors";
import { getRequestMeta } from "@/lib/request-meta";
import { signInPath } from "@/lib/routes";
import { requirePermission } from "@/modules/auth/context";
import { MAX_UPLOAD_BYTES, storeUpload } from "@/modules/files/file.service";

export const dynamic = "force-dynamic";

const SAVE_PAGE = "/production/save";

/** Text the phone shares: kept short, as the page's starting values. */
const shared = (form: FormData, key: string, max: number) => {
  const value = form.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
};

/**
 * POST /api/production/share — the phone's Share button (Save to Tech Pack,
 * the app's share target): keeps the shared photo for the person who shared
 * it and opens the Save to Tech Pack page with the link and text, to pick the
 * style and add a note. Nothing is saved to a style here. Only a share from
 * the phone itself or from this site is taken, never a form on another site.
 */
export async function POST(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") {
    return new NextResponse("Share to Extas ERP from your phone's Share button.", { status: 403 });
  }
  const form = await request.formData().catch(() => new FormData());
  const params = new URLSearchParams();
  const title = shared(form, "title", 200);
  const text = shared(form, "text", 1000);
  const url = shared(form, "url", 1000);
  if (title) params.set("title", title);
  if (text) params.set("text", text);
  if (url) params.set("url", url);
  const page = (extra?: Record<string, string>) => {
    const all = new URLSearchParams(params);
    for (const [k, v] of Object.entries(extra ?? {})) all.set(k, v);
    const query = all.toString();
    return query ? `${SAVE_PAGE}?${query}` : SAVE_PAGE;
  };
  const go = (path: string) => NextResponse.redirect(new URL(path, request.url), 303);

  try {
    const ctx = await requirePermission("production.manage");
    const photo = form.get("photo");
    if (!(photo instanceof File) || photo.size === 0) return go(page());
    if (photo.size > MAX_UPLOAD_BYTES) return go(page({ problem: "size" }));
    const stored = await storeUpload(
      ctx,
      { fileName: photo.name || "shared-photo", bytes: Buffer.from(await photo.arrayBuffer()) },
      await getRequestMeta(),
    );
    if (!stored.mimeType.startsWith("image/")) return go(page({ problem: "type" }));
    return go(page({ file: stored.id }));
  } catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED")
      return go(signInPath(page()));
    if (error instanceof AppError && error.code === "VALIDATION")
      return go(page({ problem: "type" }));
    // No permission, or anything else: the page itself says what is wrong.
    return go(page());
  }
}
