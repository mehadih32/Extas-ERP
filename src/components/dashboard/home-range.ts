import { DEFAULT_HOME_RANGE, type HomeRange } from "@/modules/dashboard/schemas";

/*
 * The Home screen's period in the address bar: ?range=today, week or month
 * (this month when it is left out), so a shared link opens the same figures.
 */

export const HOME_RANGE_OPTIONS: ReadonlyArray<{ value: HomeRange; param: string; label: string }> =
  [
    { value: "TODAY", param: "today", label: "Today" },
    { value: "WEEK", param: "week", label: "This week" },
    { value: "MONTH", param: "month", label: "This month" },
  ];

type Params = Record<string, string | string[] | undefined>;

export function homeRangeFrom(params: Params): HomeRange {
  const raw = params.range;
  const param = typeof raw === "string" ? raw.toLowerCase() : undefined;
  return HOME_RANGE_OPTIONS.find((o) => o.param === param)?.value ?? DEFAULT_HOME_RANGE;
}

/** The address bar value for a period: nothing for the default one. */
export function homeRangeParam(range: HomeRange): string | null {
  if (range === DEFAULT_HOME_RANGE) return null;
  return HOME_RANGE_OPTIONS.find((o) => o.value === range)!.param;
}

/** "Today", "This week", "This month". */
export const homeRangeLabel = (range: HomeRange) =>
  HOME_RANGE_OPTIONS.find((o) => o.value === range)!.label;
