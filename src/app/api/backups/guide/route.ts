import { apiErrorResponse } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePlatformSuperAdmin } from "@/modules/auth/context";
import { downloadGuide } from "@/modules/backups/guide.service";
import { guideLangSchema } from "@/modules/backups/schemas";

export const dynamic = "force-dynamic";

/**
 * GET /api/backups/guide?lang=bn|en — the restore guide (PDF) with "Your
 * restore details" (the web address and the Google client, never the recovery
 * key), made now. For the platform owner only; every download is audited.
 */
export async function GET(request: Request) {
  try {
    const { user } = await requirePlatformSuperAdmin();
    const lang = guideLangSchema.parse(new URL(request.url).searchParams.get("lang") ?? "bn");
    const { data, fileName } = await downloadGuide(
      { userId: user.id },
      lang,
      await getRequestMeta(),
    );
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(data.length),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
