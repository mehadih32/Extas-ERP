import type { Metadata } from "next";
import Link from "next/link";
import { cache, Fragment, Suspense } from "react";

import { PrivacyProvider } from "@/components/accounts/privacy";
import { ActionZone } from "@/components/dashboard/action-zone";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { ArrangeSections } from "@/components/dashboard/arrange-sections";
import { homeRangeFrom } from "@/components/dashboard/home-range";
import { HomeToolbar } from "@/components/dashboard/home-toolbar";
import { Insights, type InsightsColumns } from "@/components/dashboard/insights";
import { MetricCards } from "@/components/dashboard/metric-cards";
import { Pipeline } from "@/components/dashboard/pipeline";
import { Predictive } from "@/components/dashboard/predictive";
import { Pulse } from "@/components/dashboard/pulse";
import type { QuickActionKeys } from "@/components/dashboard/quick-actions";
import { SalesTargetBar } from "@/components/dashboard/sales-target";
import { SectionError } from "@/components/dashboard/section-error";
import {
  ActionZoneSkeleton,
  ActivityFeedSkeleton,
  InsightsSkeleton,
  MetricCardsSkeleton,
  PipelineSkeleton,
  PredictiveSkeleton,
  PulseSkeleton,
  SalesTargetSkeleton,
} from "@/components/dashboard/skeletons";
import { type TopSellersView, topSellersViewFrom } from "@/components/dashboard/top-sellers-view";
import { roleLabel } from "@/components/shell/labels";
import { PLANNER_KEYS } from "@/components/shell/nav-items";
import { localDay } from "@/lib/dates";
import { formatCount, formatLongDay } from "@/lib/display";
import type { CompanyContext } from "@/modules/auth/context";
import { actionZoneAccess, hasActionZone } from "@/modules/dashboard/action-zone.service";
import { canSeeFinancials, canSeeSalesAmounts, canSeeStock } from "@/modules/dashboard/access";
import { pulseAccess } from "@/modules/dashboard/home.service";
import { canSeePipeline } from "@/modules/dashboard/pipeline.service";
import { predictiveAccess } from "@/modules/dashboard/predictive.service";
import { HOME_SECTIONS, type HomeRange, type HomeSectionKey } from "@/modules/dashboard/schemas";
import {
  getActionZoneAction,
  getActivityFeedAction,
  getDashboardInsightsAction,
  getHomePulseAction,
  getHomeSectionOrderAction,
  getHomeTopBarAction,
  getMetricCardsAction,
  getPredictiveInsightsAction,
  getProductionPipelineAction,
} from "@/server/actions/dashboard.actions";
import { cn } from "@/lib/utils";
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

/** The top bar's figures, read once for the pending line and the target bar. */
const topBar = cache(() => getHomeTopBarAction());

/** "You have 3 pending tasks today", opening the Planner's agenda for those who have it. */
async function PendingLine({ ctx }: { ctx: CompanyContext }) {
  const result = await topBar();
  if (!result.ok) return null;
  const { total, overdue } = result.data.pending;
  const currency = ctx.company.currency;
  if (total === 0) {
    return <p className="mt-2 text-sm text-muted-foreground">Nothing is pending for today.</p>;
  }
  const tasks = `${formatCount(total, currency)} pending ${total === 1 ? "task" : "tasks"} today`;
  const planner = PLANNER_KEYS.some((key) => ctx.can(key));
  return (
    <p className="mt-2 text-sm text-foreground">
      You have{" "}
      {planner ? (
        <Link
          href="/planner"
          className="font-medium text-primary underline underline-offset-4 hover:no-underline"
        >
          {tasks}
        </Link>
      ) : (
        <span className="font-medium">{tasks}</span>
      )}
      {overdue > 0 ? (
        <>
          , <span className="text-destructive">{formatCount(overdue, currency)} overdue</span>.
        </>
      ) : (
        "."
      )}
    </p>
  );
}

async function SalesTargetSection() {
  const result = await topBar();
  if (!result.ok) return <SectionError title="Monthly sales target" error={result.error} />;
  const target = result.data.salesTarget;
  if (!target) return null;
  return <SalesTargetBar data={target} currency={result.data.currency} />;
}

async function PulseSection({ range }: { range: HomeRange }) {
  const result = await getHomePulseAction({ range });
  if (!result.ok) return <SectionError title="The Pulse" error={result.error} />;
  return <Pulse data={result.data} />;
}

async function ActionZoneSection({ range }: { range: HomeRange }) {
  const result = await getActionZoneAction({ range });
  if (!result.ok) return <SectionError title="Action Zone" error={result.error} />;
  return <ActionZone data={result.data} />;
}

async function PredictiveSection({ range }: { range: HomeRange }) {
  const result = await getPredictiveInsightsAction({ range });
  if (!result.ok) return <SectionError title="Predictive insights" error={result.error} />;
  return <Predictive data={result.data} />;
}

async function PipelineSection({ currency }: { currency: string }) {
  const result = await getProductionPipelineAction();
  if (!result.ok) return <SectionError title="Production pipeline" error={result.error} />;
  return <Pipeline data={result.data} currency={currency} />;
}

async function ActivitySection() {
  const result = await getActivityFeedAction({});
  if (!result.ok) return <SectionError title="Live activity" error={result.error} />;
  return <ActivityFeed initial={result.data} />;
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
 * The master dashboard (blueprint section 1), the "Pro Smart" Home screen: the
 * greeting with today's pending tasks, a bar pinned to the top (the period, the
 * eye that shows or hides every amount, and the (+) quick actions), the monthly
 * sales target, The Pulse, the Action Zone (overdue invoices, low stock, pending
 * approvals), the predictive insights (stock runway, top buyer), the production
 * pipeline beside the live activity feed, then the key figures and the
 * Insights. What each person sees follows the dashboard API's own permission
 * checks: the money
 * cards for dashboard.financials or accounts.view, the Insights for
 * dashboard.view or inventory.view, with sales values and costs only for those
 * who may see them. Every amount shows *** until the eye shows it. Each person
 * can put the sections in their own order ("Arrange sections" by the date).
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const params = await searchParams;
  const financials = canSeeFinancials(ctx);
  const stock = canSeeStock(ctx);
  const salesAmounts = canSeeSalesAmounts(ctx);
  const pulse = pulseAccess(ctx);
  const hasPulse = pulse.sales || pulse.deliveries || pulse.production;
  const zone = actionZoneAccess(ctx);
  const hasZone = hasActionZone(zone);
  const predictive = predictiveAccess(ctx);
  const hasPredictive = predictive.runway || predictive.topBuyer;
  const pipeline = canSeePipeline(ctx);
  const noFigures = !financials && !stock && !hasPulse && !hasZone && !hasPredictive && !pipeline;
  const view = topSellersViewFrom(params, { canSortBySales: salesAmounts });
  const range = homeRangeFrom(params);
  const actions: QuickActionKeys = {
    newOrder: ctx.can("sales.order.create"),
    // Money is recorded by Accounts and the owner only.
    receivePayment: ctx.can("accounts.receipts.record"),
    quotation: ctx.can("sales.quotation.manage"),
    expense: ctx.can("expenses.create"),
    letterhead: ctx.can("documents.letterhead"),
  };
  const now = new Date();
  const firstName = ctx.user.name.trim().split(/\s+/)[0] || ctx.user.name;
  const role = roleLabel(ctx.role, ctx.user.isSuperAdmin);
  // The person's own order of the sections; the standard one if it cannot be read.
  const saved = await getHomeSectionOrderAction();
  const order = saved.ok ? saved.data.sectionOrder : HOME_SECTIONS;

  // Each section with what it holds, or null when this person does not see it.
  const sections: Record<HomeSectionKey, { name: string; node: React.ReactNode } | null> = {
    TARGET_PULSE:
      salesAmounts || hasPulse
        ? {
            name:
              salesAmounts && hasPulse
                ? "Monthly sales target and The Pulse"
                : salesAmounts
                  ? "Monthly sales target"
                  : "The Pulse",
            node: (
              <div className="grid grid-cols-1 gap-8">
                {salesAmounts && (
                  <Suspense fallback={<SalesTargetSkeleton />}>
                    <SalesTargetSection />
                  </Suspense>
                )}
                {hasPulse && (
                  <Suspense fallback={<PulseSkeleton />}>
                    <PulseSection range={range} />
                  </Suspense>
                )}
              </div>
            ),
          }
        : null,
    ACTION_ZONE: hasZone
      ? {
          name: "Action Zone",
          node: (
            <Suspense fallback={<ActionZoneSkeleton />}>
              <ActionZoneSection range={range} />
            </Suspense>
          ),
        }
      : null,
    PREDICTIVE: hasPredictive
      ? {
          name: "Predictive insights",
          node: (
            <Suspense fallback={<PredictiveSkeleton />}>
              <PredictiveSection range={range} />
            </Suspense>
          ),
        }
      : null,
    PIPELINE_ACTIVITY: {
      name: pipeline ? "Production pipeline and Live activity" : "Live activity",
      node: (
        // The pipeline, with the live feed on its right (under it on phones).
        <div
          className={cn(
            "grid grid-cols-1 items-start gap-12 md:gap-16 lg:gap-8",
            pipeline &&
              "lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]",
          )}
        >
          {pipeline && (
            <Suspense fallback={<PipelineSkeleton />}>
              <PipelineSection currency={ctx.company.currency} />
            </Suspense>
          )}
          <Suspense fallback={<ActivityFeedSkeleton />}>
            <ActivitySection />
          </Suspense>
        </div>
      ),
    },
    KEY_FIGURES: financials
      ? {
          name: "Key figures",
          node: (
            <Suspense fallback={<MetricCardsSkeleton />}>
              <KeyFigures />
            </Suspense>
          ),
        }
      : null,
    INSIGHTS: stock
      ? {
          name: "Insights",
          node: (
            <Suspense fallback={<InsightsSkeleton />}>
              <InsightsSection view={view} columns={{ salesAmounts, financials }} />
            </Suspense>
          ),
        }
      : null,
  };
  const shown = order.flatMap((key) => {
    const section = sections[key];
    return section ? [{ key, ...section }] : [];
  });

  return (
    <PrivacyProvider>
      <div className="flex flex-col">
        <header>
          <div className="flex items-center justify-between gap-3">
            <p className="eyebrow">{formatLongDay(localDay(now, ctx.company.timezone))}</p>
            {shown.length > 1 && (
              <ArrangeSections
                sections={shown.map(({ key, name }) => ({ key, name }))}
                className="-my-2"
              />
            )}
          </div>
          <h1 className="mt-3 font-serif text-[2rem] leading-tight text-primary sm:text-[2.5rem]">
            {greetingAt(now, ctx.company.timezone)}, {firstName}
          </h1>
          <Suspense fallback={<p className="mt-2 h-5" aria-hidden />}>
            <PendingLine ctx={ctx} />
          </Suspense>
          <p className="mt-1 text-sm text-muted-foreground">
            {ctx.company.name} · {role}
          </p>
        </header>

        <HomeToolbar
          className="mt-6"
          range={range}
          actions={actions}
          showRange={hasPulse || zone.returns || zone.discounts || predictive.topBuyer}
          showEye={salesAmounts || financials}
        />

        <div className="mt-8 grid grid-cols-1 gap-12 md:mt-10 md:gap-16">
          {noFigures && (
            <section className="rounded-lg border bg-card px-6 py-12 text-center sm:px-10">
              <p className="font-serif text-2xl text-primary">No figures to show here yet</p>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                Your role ({role}) does not include the dashboard&apos;s figures. Your administrator
                can give you access to them. What you do in the app shows under Live activity.
              </p>
            </section>
          )}

          {shown.map(({ key, node }) => (
            <Fragment key={key}>{node}</Fragment>
          ))}
        </div>
      </div>
    </PrivacyProvider>
  );
}
