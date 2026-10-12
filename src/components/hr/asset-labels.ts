import type { AssetKind, AssetReturn } from "@prisma/client";

/*
 * Words for company items in staff hands (laptops, phones, SIMs, ID cards...),
 * shared by HR's items page, the employee page, My details and the clearance
 * certificate.
 */

export const ASSET_KIND_WORDS: Record<AssetKind, string> = {
  LAPTOP: "Laptop or computer",
  PHONE: "Phone",
  SIM: "SIM card",
  ID_CARD: "ID card",
  KEY: "Keys",
  UNIFORM: "Uniform",
  TOOL: "Tools or equipment",
  VEHICLE: "Vehicle",
  OTHER: "Other",
};

export const ASSET_KINDS = Object.keys(ASSET_KIND_WORDS) as AssetKind[];

/** How an item came back. */
export const ASSET_RETURN_WORDS: Record<AssetReturn, string> = {
  GOOD: "Returned",
  DAMAGED: "Returned damaged",
  LOST: "Lost",
};

export const ASSET_RETURNS = Object.keys(ASSET_RETURN_WORDS) as AssetReturn[];
