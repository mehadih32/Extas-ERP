"use server";

import { runAction } from "@/lib/result";
import { requireAnyPermission, requireCompany } from "@/modules/auth/context";
import { getMetricCards } from "@/modules/dashboard/cards.service";
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
