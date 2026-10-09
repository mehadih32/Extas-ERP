import { dayParam } from "@/components/parties/route";
import { PERIOD_PRESETS, type PeriodPreset } from "@/modules/accounts/periods";

/*
 * The reports' choices, kept in the address bar so a refresh or a shared link
 * shows the same report: "?period=LAST_MONTH", "?from=2026-07-01&to=2026-09-30",
 * "&months=1" for month by month, "?asOf=2026-09-30" for a balance at a day.
 * Anything malformed is ignored.
 */

type SearchParams = Record<string, string | string[] | undefined>;

export type PeriodView = {
  period?: PeriodPreset;
  from?: string;
  to?: string;
  byMonth: boolean;
};

export function periodViewFrom(params: SearchParams): PeriodView {
  const period = typeof params.period === "string" ? params.period : "";
  return {
    period: (PERIOD_PRESETS as readonly string[]).includes(period)
      ? (period as PeriodPreset)
      : undefined,
    from: dayParam(params.from),
    to: dayParam(params.to),
    byMonth: params.months === "1",
  };
}

/** The address for a period: dates win over a preset, as the reports read them. */
export function periodSearch(view: PeriodView): string {
  const params = new URLSearchParams();
  if (view.from || view.to) {
    if (view.from) params.set("from", view.from);
    if (view.to) params.set("to", view.to);
  } else if (view.period && view.period !== "THIS_MONTH") {
    params.set("period", view.period);
  }
  if (view.byMonth) params.set("months", "1");
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** What the profit and loss action is asked for. */
export function periodQuery(view: PeriodView) {
  return view.from || view.to
    ? { from: view.from, to: view.to, byMonth: view.byMonth }
    : { period: view.period, byMonth: view.byMonth };
}

export function asOfFrom(params: SearchParams): string | undefined {
  return dayParam(params.asOf);
}
