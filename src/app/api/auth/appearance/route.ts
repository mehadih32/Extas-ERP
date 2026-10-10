import { apiRoute, readJson } from "@/lib/api";
import { getAppearance, updateAppearance } from "@/modules/appearance/appearance.service";
import { requireSession } from "@/modules/auth/context";

export const dynamic = "force-dynamic";

/** GET /api/auth/appearance — this person's look: { interfaceStyle: "LEGACY" | "MODERN" }. */
export const GET = apiRoute(async () => getAppearance(await requireSession()));

/** PATCH /api/auth/appearance — { interfaceStyle } changes this person's look only. */
export const PATCH = apiRoute(async (request) =>
  updateAppearance(await requireSession(), await readJson(request)),
);
