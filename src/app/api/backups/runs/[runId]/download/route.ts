import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { apiErrorResponse } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePlatformSuperAdmin } from "@/modules/auth/context";
import * as backups from "@/modules/backups/backup.service";
import { backupFileSchema } from "@/modules/backups/schemas";

type Params = { runId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/backups/runs/:runId/download?file=database|media|manifest — one backup
 * file, streamed to the PC (dumps can be large). Every download is audited.
 */
export async function GET(request: Request, context: { params: Promise<Params> }) {
  try {
    const { user } = await requirePlatformSuperAdmin();
    const { runId } = await context.params;
    const { file } = backupFileSchema.parse({
      file: new URL(request.url).searchParams.get("file") ?? "database",
    });
    const found = await backups.getBackupFile(
      { userId: user.id },
      runId,
      file,
      await getRequestMeta(),
    );
    const body = Readable.toWeb(createReadStream(found.path)) as ReadableStream<Uint8Array>;
    return new Response(body, {
      headers: {
        "Content-Type": found.mimeType,
        "Content-Length": String(found.size),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(found.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
