import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { EmptyState } from "@/components/products/bits";
import { STAGE_LABELS } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { ProjectCard } from "@/components/production/project-card";
import { visibleProductionTabs } from "@/components/production/tabs";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/display";
import { cn } from "@/lib/utils";
import { getOverviewScreenAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Production" };

function Stat({
  label,
  value,
  href,
  alert = false,
  currency,
}: {
  label: string;
  value: number;
  href?: string;
  alert?: boolean;
  currency: string;
}) {
  const body = (
    <>
      <dt className="eyebrow">{label}</dt>
      <dd
        className={cn(
          "mt-1 font-serif text-2xl leading-tight tabular-nums",
          alert && value > 0 ? "text-destructive" : "text-primary",
        )}
      >
        {formatCount(value, currency)}
      </dd>
    </>
  );
  const box = cn(
    "block min-w-0 rounded-lg border bg-card p-4",
    alert && value > 0 && "border-destructive/40",
  );
  return href ? (
    <div className="min-w-0">
      <Link
        href={href}
        className={cn(
          box,
          "transition-colors outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/25",
        )}
      >
        {body}
      </Link>
    </div>
  ) : (
    <div className={box}>{body}</div>
  );
}

/**
 * The Production Overview (production.view, like GET /api/production/overview):
 * every open project as a card, late ones first and in red, how many are at
 * each stage, and for Production Managers and Accounts the money in production.
 * People who only receive goods start on the Deliveries tab instead.
 */
export default async function ProductionOverviewPage() {
  const ctx = await requireCompanyPage();
  if (!ctx.can("production.view")) {
    const first = visibleProductionTabs(ctx.permissions)[0];
    if (first) redirect(first.href);
    return <ProductionNoAccess />;
  }
  const result = await getOverviewScreenAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <ProductionNoAccess />;
    return (
      <SectionError title="Production" heading="The overview could not load" error={result.error} />
    );
  }
  const { counts, byStage, totals, projects, canCreate } = result.data;
  const currency = ctx.company.currency;

  return (
    <div className="grid grid-cols-1 gap-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-serif text-2xl text-primary">Overview</h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Every project still in the works, late ones first. Open one to move its stage, add its
            costs or receive its goods.
          </p>
        </div>
        {canCreate && (
          <Button asChild className="w-full sm:w-auto">
            <Link href="/production/projects/new">
              <PlusIcon aria-hidden />
              New project
            </Link>
          </Button>
        )}
      </div>

      <section aria-label="Projects by status">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <Stat
            label="In production"
            value={counts.active}
            href="/production/projects?status=ACTIVE"
            currency={currency}
          />
          <Stat
            label="Late"
            value={counts.overdue}
            href="/production/projects?status=OVERDUE"
            alert
            currency={currency}
          />
          <Stat label="Due this week" value={counts.dueSoon} currency={currency} />
          <Stat
            label="Planned"
            value={counts.planned}
            href="/production/projects?status=PLANNED"
            currency={currency}
          />
          <Stat
            label="On hold"
            value={counts.onHold}
            href="/production/projects?status=ON_HOLD"
            currency={currency}
          />
          <Stat label="Done this month" value={counts.completedThisMonth} currency={currency} />
        </dl>
      </section>

      <section aria-labelledby="stages-heading" className="grid gap-3">
        <h3 id="stages-heading" className="font-serif text-xl text-primary">
          At each stage
        </h3>
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {byStage.map((s, index) => (
            <li key={s.stage} className="min-w-0">
              <Link
                href={`/production/projects?stage=${s.stage}`}
                className="flex h-full items-center justify-between gap-3 rounded-md border bg-card px-3 py-2.5 transition-colors outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/25"
              >
                <span className="min-w-0 text-sm">
                  <span className="text-muted-foreground tabular-nums">{index + 1}. </span>
                  {STAGE_LABELS[s.stage]}
                </span>
                <span className="font-serif text-lg text-primary tabular-nums">{s.count}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      {totals && (
        <section aria-labelledby="money-heading" className="grid gap-3">
          <h3 id="money-heading" className="font-serif text-xl text-primary">
            Money in open projects
          </h3>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              ["Spent so far", totals.totalCost],
              ["Moved into stock", totals.inStock],
              ["Still in production", totals.wip],
            ].map(([label, amount]) => (
              <div key={label} className="min-w-0 rounded-lg border bg-card p-4">
                <dt className="eyebrow">{label}</dt>
                <dd className="mt-1 font-serif text-xl leading-tight tabular-nums">
                  {money(amount!, currency)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section aria-labelledby="open-heading" className="grid gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h3 id="open-heading" className="font-serif text-xl text-primary">
            Open projects
          </h3>
          <Link
            href="/production/projects"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            All projects
          </Link>
        </div>
        {projects.length === 0 ? (
          <EmptyState
            title="Nothing in production"
            action={
              canCreate ? (
                <Button asChild>
                  <Link href="/production/projects/new">Start a project</Link>
                </Button>
              ) : undefined
            }
          >
            Projects show here from the day they are planned until they are completed. A proforma
            invoice starts one too once its advance is paid.
          </EmptyState>
        ) : (
          <ul
            className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
            aria-label="Open projects"
          >
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} currency={currency} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
