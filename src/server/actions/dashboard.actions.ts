"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireAnyPermission, requireCompany } from "@/modules/auth/context";
import { getActionZone } from "@/modules/dashboard/action-zone.service";
import { getMetricCards } from "@/modules/dashboard/cards.service";
import { getHomePulse, getHomeTopBar, setSalesTarget } from "@/modules/dashboard/home.service";
import { getDashboardInsights } from "@/modules/dashboard/insights.service";
import {
  getDashboardPreferences,
  updateDashboardPreferences,
} from "@/modules/dashboard/preferences.service";

/*
 * Master dashboard Server Actions. Each returns { ok: true, data } or { ok: false, error }.
 *   dashboard.financials / accounts.view   the owner's money cards
 *   dashboard.view / inventory.view        top sellers and stock alerts (money columns only
 *                                          for people who may see sales or the financials)
 * Hiding a card (the eye icon) is each person's own display choice.
 * The Home screen's top bar, The Pulse and the Action Zone are for everyone signed in to
 * the company; each part is only worked out for the people who may see it
 * (home.service.ts, action-zone.service.ts), and only company.settings sets the monthly
 * sales target.
 */

export const getMetricCardsAction = async () =>
  runAction(async () =>
    getMetricCards(await requireAnyPermission("dashboard.financials", "accounts.view")),
  );
export const getDashboardInsightsAction = async (query: unknown) =>
  runAction(async () =>
    getDashboardInsights(await requireAnyPermission("dashboard.view", "inventory.view"), query),
  );
export const getDashboardPreferencesAction = async () =>
  runAction(async () => getDashboardPreferences(await requireCompany()));
export const updateDashboardPreferencesAction = async (input: unknown) =>
  runAction(async () => updateDashboardPreferences(await requireCompany(), input));
export const getHomeTopBarAction = async () =>
  runAction(async () => getHomeTopBar(await requireCompany()));
export const getHomePulseAction = async (query: unknown) =>
  runAction(async () => getHomePulse(await requireCompany(), query));
export const getActionZoneAction = async (query: unknown) =>
  runAction(async () => getActionZone(await requireCompany(), query));
export const setSalesTargetAction = async (input: unknown) =>
  runAction(async () => {
    const result = await setSalesTarget(await requireCompany(), input, await getRequestMeta());
    revalidatePath("/");
    return result;
  });
