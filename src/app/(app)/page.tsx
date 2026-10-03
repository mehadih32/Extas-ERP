import type { Metadata } from "next";
import { Suspense } from "react";

import { Insights, type InsightsColumns } from "@/components/dashboard/insights";
import { MetricCards } from "@/components/dashboard/metric-cards";
import { SectionError } from "@/components/dashboard/section-error";
import { InsightsSkeleton, MetricCardsSkeleton } from "@/components/dashboard/skeletons";
import { type TopSellersView, topSellersViewFrom } from "@/components/dashboard/top-sellers-view";
import { roleLabel } from "@/components/shell/labels";
import { localDay } from "@/lib/dates";
import { formatLongDay } from "@/lib/display";
import { canSeeFinancials, canSeeSalesAmounts, canSeeStock } from "@/modules/dashboard/access";
import {
  getDashboardInsightsAction,
  getMetricCardsAction,
} from "@/server/actions/dashboard.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Dashboard" };

/** "Good morning" before noon, "Good afternoon" until five, then "Good evening", in company time. */
function greetingAt(now: Date, timeZone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now),
  );
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

async function KeyFigures() {
  const result = await getMetricCardsAction();
  if (!result.ok) return <SectionError title="Key figures" error={result.error} />;
  return <MetricCards data={result.data} />;
}

async function InsightsSection({
  view,
  columns,
}: {
  view: TopSellersView;
  columns: InsightsColumns;
}) {
  const result = await getDashboardInsightsAction(view);
  if (!result.ok) return <SectionError title="Insights" error={result.error} />;
  return <Insights data={result.data} view={view} columns={columns} />;
}

/**
 * The master dashboard (blueprint section 1). What each person sees follows the
 * dashboard API's own permission checks: the money cards for dashboard.financials
 * or accounts.view, the Insights for dashboard.view or inventory.view, with sales
 * values and costs only for those who may see them.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const financials = canSeeFinancials(ctx);
  const stock = canSeeStock(ctx);
  const salesAmounts = canSeeSalesAmounts(ctx);
  const view = topSellersViewFrom(await searchParams, { canSortBySales: salesAmounts });
  const now = new Date();
  const firstName = ctx.user.name.trim().split(/\s+/)[0] || ctx.user.name;
  const role = roleLabel(ctx.role, ctx.user.isSuperAdmin);

  return (
    <div className="grid grid-cols-1 gap-12 md:gap-16">
      <header>
        <p className="eyebrow">{formatLongDay(localDay(now, ctx.company.timezone))}</p>
        <h1 className="mt-3 font-serif text-[2rem] leading-tight text-primary sm:text-[2.5rem]">
          {greetingAt(now, ctx.company.timezone)}, {firstName}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {ctx.company.name} · {role}
        </p>
      </header>

      {financials && (
        <Suspense fallback={<MetricCardsSkeleton />}>
          <KeyFigures />
        </Suspense>
      )}

      {stock && (
        <Suspense fallback={<InsightsSkeleton />}>
          <InsightsSection view={view} columns={{ salesAmounts, financials }} />
        </Suspense>
      )}

      {!financials && !stock && (
        <section className="rounded-lg border bg-card px-6 py-12 text-center sm:px-10">
          <p className="font-serif text-2xl text-primary">Nothing to show here yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            Your role ({role}) does not include the dashboard&apos;s figures. Your administrator can
            give you access to them.
          </p>
        </section>
      )}
    </div>
  );
}
