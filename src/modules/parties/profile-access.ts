import type { Prisma } from "@prisma/client";

import type { CompanyContext } from "@/modules/auth/context";
import { canSeeFinancials } from "@/modules/dashboard/access";
import { canSeeMaterialCosts } from "@/modules/materials/access";

/*
 * What a 360° profile shows beyond the profile itself (Buyers & suppliers,
 * parties.view), by the reader's permissions.
 *
 * A buyer's (Customer 360°):
 *   sales       sales figures and the order, quotation and payment history (sales.view)
 *   profit      gross profit and margins (dashboard.financials or accounts.view)
 *   production  production for the buyer (production.view)
 * A supplier's (Supplier 360°):
 *   money       what their bills, payments, orders and projects come to: the people
 *               who see raw material prices or production costs (materials/access.ts)
 *   production  the projects they work on and the goods their factory delivered
 *               (production.view)
 *   materials   raw material purchase orders and deliveries (materials.view)
 *
 * A printed profile keeps the flags of the person who made it
 * (options.shows), and opens only for people who may see all of it.
 */

export const PROFILE_SHOWS = ["sales", "profit", "production"] as const;
export const SUPPLIER_PROFILE_SHOWS = ["money", "production", "materials"] as const;

export type ProfileShow = (typeof PROFILE_SHOWS)[number];
export type ProfileShows = Record<ProfileShow, boolean>;
export type SupplierProfileShow = (typeof SUPPLIER_PROFILE_SHOWS)[number];
export type SupplierProfileShows = Record<SupplierProfileShow, boolean>;

/** The printed profiles, with the flags each keeps. */
export const PROFILE_FLAGS = {
  BUYER_360: PROFILE_SHOWS,
  SUPPLIER_360: SUPPLIER_PROFILE_SHOWS,
} as const;

export type ProfileType = keyof typeof PROFILE_FLAGS;

export const PROFILE_TYPES = Object.keys(PROFILE_FLAGS) as ProfileType[];

export const isProfileType = (type: string): type is ProfileType => type in PROFILE_FLAGS;

type Can = Pick<CompanyContext, "can">;

export function profileShows(ctx: Can): ProfileShows {
  return {
    sales: ctx.can("sales.view"),
    profit: canSeeFinancials(ctx),
    production: ctx.can("production.view"),
  };
}

export function supplierProfileShows(ctx: Can): SupplierProfileShows {
  return {
    money: canSeeMaterialCosts(ctx),
    production: ctx.can("production.view"),
    materials: ctx.can("materials.view"),
  };
}

function readerShows(ctx: Can, type: ProfileType): Record<string, boolean> {
  return type === "BUYER_360" ? profileShows(ctx) : supplierProfileShows(ctx);
}

/** The flags a printed profile was made with (a missing flag counts as shown, to be safe). */
function shownIn(type: ProfileType, options: Prisma.JsonValue | null): Record<string, boolean> {
  const shows =
    options && typeof options === "object" && !Array.isArray(options)
      ? (options as Record<string, unknown>).shows
      : undefined;
  const flags =
    shows && typeof shows === "object" && !Array.isArray(shows)
      ? (shows as Record<string, unknown>)
      : {};
  return Object.fromEntries(PROFILE_FLAGS[type].map((flag) => [flag, flags[flag] !== false]));
}

/** Whether this person may open a printed profile: they see everything it shows. */
export function mayOpenProfile(
  ctx: Can,
  type: ProfileType,
  options: Prisma.JsonValue | null,
): boolean {
  const reader = readerShows(ctx, type);
  const shown = shownIn(type, options);
  return PROFILE_FLAGS[type].every((flag) => !shown[flag] || reader[flag]);
}

/** The flags this person lacks: printed profiles that show any of them are hidden from them. */
export function hiddenProfileFlags(ctx: Can, type: ProfileType): string[] {
  const reader = readerShows(ctx, type);
  return PROFILE_FLAGS[type].filter((flag) => !reader[flag]);
}
