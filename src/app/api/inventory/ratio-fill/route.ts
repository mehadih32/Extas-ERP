import { apiRoute, readJson } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as matrix from "@/modules/inventory/matrix.service";

/** POST /api/inventory/ratio-fill — suggested quantities per color/size (nothing is saved). */
export const POST = apiRoute(async (request) =>
  matrix.ratioFill(await requirePermission("inventory.view"), await readJson(request)),
);
