import { apiRoute, readJson } from "@/lib/api";
import { requireCompany } from "@/modules/auth/context";
import { getHomeSectionOrder, setHomeSectionOrder } from "@/modules/dashboard/preferences.service";

export const dynamic = "force-dynamic";

/** GET /api/dashboard/section-order — the order of this person's Home sections. */
export const GET = apiRoute(async () => getHomeSectionOrder(await requireCompany()));

/**
 * PUT /api/dashboard/section-order — { order: [...] }, the sections this person sees in
 * their new order; the others keep their places.
 */
export const PUT = apiRoute(async (request) =>
  setHomeSectionOrder(await requireCompany(), await readJson(request)),
);
