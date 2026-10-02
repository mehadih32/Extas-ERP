import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as materials from "@/modules/materials/material.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/materials/movements?materialId=&warehouseId=&projectId=&type=&from=&to=&cursor=&take=
 * — every stock change, newest first.
 */
export const GET = apiRoute(async (request) =>
  materials.listMovements(
    await requirePermission("materials.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
