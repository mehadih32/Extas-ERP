import { z } from "zod";

import { PERIOD_PRESETS } from "@/modules/accounts/periods";

const day = z.iso.date();

/** The owner's metric cards, in the blueprint's order. */
export const METRIC_CARDS = [
  "STOCK_VALUE",
  "FIXED_ASSETS",
  "LIABILITIES",
  "TODAY_SALES",
  "NET_PROFIT",
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
