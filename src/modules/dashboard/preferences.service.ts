import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import { METRIC_CARDS, type MetricCardKey, preferencesSchema } from "@/modules/dashboard/schemas";

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
