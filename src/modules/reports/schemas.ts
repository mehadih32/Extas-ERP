import { ReportFormat } from "@prisma/client";
import { z } from "zod";

import { queryBoolean } from "@/lib/query-params";
import { PERIOD_PRESETS } from "@/modules/accounts/periods";
import { stockWindowFields } from "@/modules/dashboard/schemas";
import { REPORT_METRICS } from "@/modules/reports/catalog";

const day = z.iso.date();

/** A list or a comma-separated string ("SALES,TOP_SELLERS"); kept in catalogue order. */
const metrics = z.preprocess(
  (v) =>
    typeof v === "string"
      ? v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : v,
  z
    .array(z.enum(REPORT_METRICS))
    .min(1, "Pick at least one metric.")
    .transform((keys) => REPORT_METRICS.filter((k) => keys.includes(k))),
);

/** What a report covers. Without metrics it has every metric the person may see. */
export const reportQuerySchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  /** A preset (this month by default), or chosen days with from / to. */
  period: z.enum(PERIOD_PRESETS).optional(),
  from: day.optional(),
  to: day.optional(),
  metrics: metrics.optional(),
  /** Rows in the top sellers tables. */
  topLimit: z.coerce.number().int().min(5).max(100).default(20),
  /** Rows in each stock alert table. */
  alertLimit: z.coerce.number().int().min(5).max(200).default(50),
  ...stockWindowFields,
});

export const generateReportSchema = reportQuerySchema.extend({
  format: z.enum(ReportFormat),
});

export const listExportsSchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(20),
  /** Id of the last report on the previous page. */
  cursor: z.string().min(1).optional(),
  /** Only the reports I made. */
  mine: queryBoolean.optional(),
});
