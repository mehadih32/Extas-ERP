import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import {
  HOME_SECTIONS,
  type HomeSectionKey,
  homeSectionOrderSchema,
  METRIC_CARDS,
  type MetricCardKey,
  preferencesSchema,
} from "@/modules/dashboard/schemas";

/*
 * The eye icon on the metric cards: each person chooses which figures stay
 * hidden (shown as dots) on their screen, e.g. while someone looks over their
 * shoulder. A display choice saved per person, not a permission.
 */

const known = new Set<string>(METRIC_CARDS);

/** Hidden cards in the blueprint's order (unknown keys from older versions are dropped). */
function ordered(keys: Iterable<string>): MetricCardKey[] {
  const set = new Set(keys);
  return METRIC_CARDS.filter((k) => set.has(k) && known.has(k));
}

export async function hiddenMetricsFor(userId: string): Promise<MetricCardKey[]> {
  const pref = await prisma.userPreference.findUnique({
    where: { userId },
    select: { hiddenMetrics: true },
  });
  return ordered(pref?.hiddenMetrics ?? []);
}

export async function getDashboardPreferences(ctx: CompanyContext) {
  return { hiddenMetrics: await hiddenMetricsFor(ctx.user.id) };
}

/** Hides or shows one card, or replaces the whole list of hidden cards. */
export async function updateDashboardPreferences(ctx: CompanyContext, raw: unknown) {
  const input = preferencesSchema.parse(raw);
  const userId = ctx.user.id;
  const hiddenMetrics = await prisma.$transaction(async (tx) => {
    // Lock the person's row so two tabs toggling different cards both stick.
    await tx.userPreference.upsert({ where: { userId }, create: { userId }, update: {} });
    const [row] = await tx.$queryRaw<Array<{ hiddenMetrics: string[] }>>`
      SELECT "hiddenMetrics" FROM "UserPreference" WHERE "userId" = ${userId} FOR UPDATE`;
    const current = new Set(row?.hiddenMetrics ?? []);
    let next: MetricCardKey[];
    if ("hiddenMetrics" in input) {
      next = ordered(input.hiddenMetrics);
    } else {
      if (input.hidden) current.add(input.metric);
      else current.delete(input.metric);
      next = ordered(current);
    }
    await tx.userPreference.update({ where: { userId }, data: { hiddenMetrics: next } });
    return next;
  });
  return { hiddenMetrics };
}

/*
 * The order of the Home screen's sections, also each person's own display
 * choice: kept in UserPreference.dashboardLayout as { sectionOrder: [...] }.
 */

const knownSections = new Set<string>(HOME_SECTIONS);

/**
 * Every section once: the saved ones in their order (unknown or repeated keys
 * dropped), then any not saved yet in the standard order.
 */
export function homeSectionOrder(saved: unknown): HomeSectionKey[] {
  const keys = Array.isArray(saved) ? saved : [];
  const order = [
    ...new Set(
      keys.filter((k): k is HomeSectionKey => typeof k === "string" && knownSections.has(k)),
    ),
  ];
  return [...order, ...HOME_SECTIONS.filter((k) => !order.includes(k))];
}

/** The saved layout as an object, whatever was stored before. */
function layoutOf(value: Prisma.JsonValue | null | undefined): Prisma.JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export async function homeSectionOrderFor(userId: string): Promise<HomeSectionKey[]> {
  const pref = await prisma.userPreference.findUnique({
    where: { userId },
    select: { dashboardLayout: true },
  });
  return homeSectionOrder(layoutOf(pref?.dashboardLayout).sectionOrder);
}

export async function getHomeSectionOrder(ctx: CompanyContext) {
  return { sectionOrder: await homeSectionOrderFor(ctx.user.id) };
}

/**
 * Saves a new order for the sections this person sees (`order`, each once).
 * The sections left out, the ones their role does not show, keep their places.
 */
export async function setHomeSectionOrder(ctx: CompanyContext, raw: unknown) {
  const { order } = homeSectionOrderSchema.parse(raw);
  const userId = ctx.user.id;
  const sectionOrder = await prisma.$transaction(async (tx) => {
    // Lock the person's row so a save from another tab is not lost. The row is made
    // when missing, quietly if another tab makes it at the same moment.
    await tx.userPreference.createMany({ data: [{ userId }], skipDuplicates: true });
    const [row] = await tx.$queryRaw<Array<{ dashboardLayout: Prisma.JsonValue }>>`
      SELECT "dashboardLayout" FROM "UserPreference" WHERE "userId" = ${userId} FOR UPDATE`;
    const layout = layoutOf(row?.dashboardLayout);
    // The given sections take the places the same sections had, in the new order.
    const moved = new Set<string>(order);
    const next = [...order];
    const merged = homeSectionOrder(layout.sectionOrder).map((key) =>
      moved.has(key) ? next.shift()! : key,
    );
    await tx.userPreference.update({
      where: { userId },
      data: { dashboardLayout: { ...layout, sectionOrder: merged } },
    });
    return merged;
  });
  return { sectionOrder };
}
