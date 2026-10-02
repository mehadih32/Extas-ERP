import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as materials from "@/modules/materials/material.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/materials/summary — stock value by kind, materials at or below their reorder level,
 * what each store holds and purchase orders running late.
 */
export const GET = apiRoute(async () =>
  materials.getMaterialsSummary(await requirePermission("materials.view")),
);
