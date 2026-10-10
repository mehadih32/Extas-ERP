import type { Prisma } from "@prisma/client";

import type { CompanyContext } from "@/modules/auth/context";
import { canSeeFinancials } from "@/modules/dashboard/access";

/*
 * What a buyer's 360° profile shows beyond the profile itself (Buyers &
 * suppliers, parties.view), by the reader's permissions:
 *   sales       sales figures and the order, quotation and payment history (sales.view)
 *   profit      gross profit and margins (dashboard.financials or accounts.view)
 *   production  production for the buyer (production.view)
 * A printed profile keeps the flags of the person who made it
 * (options.shows), and opens only for people who may see all of it.
 */

export const PROFILE_SHOWS = ["sales", "profit", "production"] as const;

export type ProfileShow = (typeof PROFILE_SHOWS)[number];
export type ProfileShows = Record<ProfileShow, boolean>;

type Can = Pick<CompanyContext, "can">;

export function profileShows(ctx: Can): ProfileShows {
  return {
    sales: ctx.can("sales.view"),
    profit: canSeeFinancials(ctx),
    production: ctx.can("production.view"),
  };
}

/** The flags a printed profile was made with (a missing flag counts as shown, to be safe). */
function shownIn(options: Prisma.JsonValue | null): ProfileShows {
  const shows =
    options && typeof options === "object" && !Array.isArray(options)
      ? (options as Record<string, unknown>).shows
      : undefined;
  const flags =
    shows && typeof shows === "object" && !Array.isArray(shows)
      ? (shows as Record<string, unknown>)
      : {};
  return {
    sales: flags.sales !== false,
    profit: flags.profit !== false,
    production: flags.production !== false,
  };
}

/** Whether this person may open a printed profile: they see everything it shows. */
export function mayOpenProfile(ctx: Can, options: Prisma.JsonValue | null): boolean {
  const reader = profileShows(ctx);
  const shown = shownIn(options);
  return PROFILE_SHOWS.every((flag) => !shown[flag] || reader[flag]);
}

/** The flags this person lacks: printed profiles that show any of them are hidden from them. */
export function hiddenProfileFlags(ctx: Can): ProfileShow[] {
  const reader = profileShows(ctx);
  return PROFILE_SHOWS.filter((flag) => !reader[flag]);
}
