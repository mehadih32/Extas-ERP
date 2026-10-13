import { z } from "zod";

import { apiRoute, readJson } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as cutting from "@/modules/production/cutting.service";

type Params = { projectId: string };

export const dynamic = "force-dynamic";

const bodySchema = z.object({ photoId: z.string().min(1) });

/**
 * POST /api/production/projects/:projectId/cutting/read — { photoId }: reads an uploaded
 * photo of the cutting sheet with AI into pieces by colour and size, to check and save.
 * Nothing is saved; 503 when AI reading is not set up (production.manage).
 */
export const POST = apiRoute<Params>(async (request, { projectId }) =>
  cutting.readCuttingPhoto(
    await requirePermission("production.manage"),
    projectId,
    bodySchema.parse(await readJson(request)).photoId,
  ),
);
