import { z } from "zod";

import { PERIOD_PRESETS } from "@/modules/accounts/periods";

const day = z.iso.date();

/** The owner's metric cards, in the blueprint's order, then the bad stock value. */
export const METRIC_CARDS = [
  "STOCK_VALUE",
  "FIXED_ASSETS",
  "LIABILITIES",
  "TODAY_SALES",
  "NET_PROFIT",
  "BAD_STOCK_VALUE",
] as const;

export type MetricCardKey = (typeof METRIC_CARDS)[number];

/** Slow-stock windows: stock held `slowDays` ago, and how long stock may last. */
export const stockWindowFields = {
  slowDays: z.coerce.number().int().min(14).max(365).default(90),
  coverDays: z.coerce.number().int().min(30).max(730).default(180),
};

export const insightsQuerySchema = z.object({
  /** Top sellers period: a preset (the last month by default) or chosen days. */
  period: z.enum(PERIOD_PRESETS).optional(),
  from: day.optional(),
  to: day.optional(),
  /** Rows per list. */
  limit: z.coerce.number().int().min(1).max(100).default(10),
  groupBy: z.enum(["SKU", "STYLE"]).default("SKU"),
  sortBy: z.enum(["QUANTITY", "REVENUE"]).default("QUANTITY"),
  ...stockWindowFields,
});

/** Hide or show the metric cards (the eye icon): one card, or the whole list. */
export const preferencesSchema = z.union([
  z.object({ metric: z.enum(METRIC_CARDS), hidden: z.boolean() }),
  z.object({ hiddenMetrics: z.array(z.enum(METRIC_CARDS)).max(METRIC_CARDS.length) }),
]);

/** The Home screen's period: today, this week (from Saturday) or this month. */
export const HOME_RANGES = ["TODAY", "WEEK", "MONTH"] as const;

export type HomeRange = (typeof HOME_RANGES)[number];

/** The period the Home screen opens with. */
export const DEFAULT_HOME_RANGE: HomeRange = "MONTH";

/**
 * The Home screen's sections, in the standard order. A few that sit together
 * move together: the sales target with The Pulse, the production pipeline with
 * the live activity beside it.
 */
export const HOME_SECTIONS = [
  "TARGET_PULSE",
  "ACTION_ZONE",
  "PREDICTIVE",
  "PIPELINE_ACTIVITY",
  "KEY_FIGURES",
  "INSIGHTS",
] as const;

export type HomeSectionKey = (typeof HOME_SECTIONS)[number];

/** A new order for the Home sections a person sees, each once. */
export const homeSectionOrderSchema = z.object({
  order: z
    .array(z.enum(HOME_SECTIONS))
    .min(1)
    .max(HOME_SECTIONS.length)
    .refine((keys) => new Set(keys).size === keys.length, {
      message: "Each section can only come once.",
    }),
});
