import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { ProjectMaterials } from "@/components/materials/project-materials";
import {
  DeliveryBadge,
  ProjectBadge,
  StageBadge,
  TimelineBadge,
} from "@/components/production/badges";
import { CostEntries, CostSummary, GradeCosts } from "@/components/production/cost-sheet";
import { pieces, productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { ProjectActions } from "@/components/production/project-actions";
import { ProjectSuppliers } from "@/components/production/project-suppliers";
import { forWhom, PiecesBar, TimelineBar } from "@/components/production/project-card";
import { StageLog, StageTrack } from "@/components/production/stage-track";
import { BackLink } from "@/components/settings/back-link";
import { Fact, Panel, RecordHeader } from "@/components/sales/detail-bits";
import { money, salesHref } from "@/components/sales/labels";
import { formatCount, formatDay } from "@/lib/display";
import type { ProjectScreen } from "@/modules/production/screens.service";
import { getProjectMaterialsPanelAction } from "@/server/actions/materials.actions";
import { getProjectScreenAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Production project" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

const linkClass = "text-primary underline-offset-4 hover:underline";

function Deliveries({ screen, currency }: { screen: ProjectScreen; currency: string }) {
  const { project: p } = screen;
  return (
    <Panel title="Factory deliveries" id="deliveries-heading">
      {p.deliveries.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Nothing received yet. Each delivery from the factory is counted into stock here, A- and
          B-grade apart.
        </p>
      ) : (
        <ul className="mt-4 grid divide-y">
          {p.deliveries.map((d) => (
            <li
              key={d.id}
              className="flex min-w-0 items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <Link href={productionHref.delivery(d.id)} className={`font-medium ${linkClass}`}>
                    {d.number}
                  </Link>
                  <DeliveryBadge status={d.status} />
                </p>
                <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">
                  {d.confirmedOn
                    ? `In stock ${formatDay(d.confirmedOn)}`
                    : `Made ${formatDay(d.madeOn)}`}
                  {d.bGradePieces > 0 && ` · ${formatCount(d.bGradePieces, currency)} B-grade`}
                </p>
              </div>
              <div className="text-right text-sm whitespace-nowrap tabular-nums">
                <p>{pieces(d.pieces, currency)}</p>
                {d.totalCost && d.status === "CONFIRMED" && (
                  <p className="text-[0.8125rem] text-muted-foreground">
                    {money(d.totalCost, currency)}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * One production project (production.view, like GET /api/production/projects/:id):
 * its time and pieces, how far it got through cutting, sewing and the other
 * stages, its factory deliveries, the raw materials the store handed it and,
 * for Production Managers and Accounts, its costs with what an A- and a B-grade
 * piece cost. What may be done comes with
 * the screen from the rules the production actions use (screen.can).
 */
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const [result, materials] = await Promise.all([
    getProjectScreenAction(projectId),
    getProjectMaterialsPanelAction(projectId),
  ]);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <ProductionNoAccess />;
    return (
      <SectionError title="Project" heading="The project could not load" error={result.error} />
    );
  }
  const screen = result.data;
  const { project: p, costs, can, notes } = screen;
  const currency = ctx.company.currency;
  const notice =
    one(query.created) === "1"
      ? `${p.code} was created${p.status === "PLANNED" ? "; start it when the factory begins" : ""}.`
      : one(query.saved) === "1"
        ? "The changes were saved."
        : undefined;

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href="/production/projects">All projects</BackLink>
        <RecordHeader
          eyebrow={`${p.code} · ${forWhom(p)}`}
          title={p.name}
          badges={
            <>
              <ProjectBadge status={p.status} />
              <StageBadge stage={p.stage} />
              <TimelineBadge timeline={p.timeline} />
            </>
          }
        />
        {p.status === "ON_HOLD" && (
          <FormAlert tone="note">
            It is on hold. Its days still count towards the target day.
          </FormAlert>
        )}
        {notes.complete && <FormAlert tone="note">{notes.complete}</FormAlert>}
        <ProjectActions key={p.id} screen={screen} currency={currency} notice={notice} />
        <div className="grid gap-5 rounded-lg border bg-card p-5 sm:p-6 md:grid-cols-2 md:gap-8">
          <TimelineBar
            timeline={p.timeline}
            status={p.status}
            targetOn={p.targetOn}
            completedOn={p.completedOn}
          />
          <PiecesBar quantities={p.quantities} currency={currency} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel title="Stages" id="stages-heading">
            <StageTrack steps={p.steps} status={p.status} />
            <h4 className="eyebrow mt-8">Stage log</h4>
            <StageLog log={p.log} />
          </Panel>
          <Deliveries screen={screen} currency={currency} />
          {materials.ok && (
            <ProjectMaterials
              panel={materials.data}
              currency={currency}
              canOpenNotes={ctx.can("materials.view")}
            />
          )}
          {costs && <CostEntries costs={costs} currency={currency} />}
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          {costs && (
            <>
              <GradeCosts costs={costs} targetQuantity={p.quantities.target} currency={currency} />
              <CostSummary costs={costs} currency={currency} />
            </>
          )}
          {screen.suppliers && (
            <ProjectSuppliers
              rows={screen.suppliers}
              completed={p.status === "COMPLETED"}
              currency={currency}
              canOpenParty={can.openParty}
            />
          )}
          <Panel title="Details" id="details-heading">
            <dl className="mt-4 grid gap-4">
              <Fact label="Made for">
                {p.buyer ? (
                  can.openParty ? (
                    <Link href={productionHref.buyer(p.buyer.id)} className={linkClass}>
                      {p.buyer.name}
                    </Link>
                  ) : (
                    p.buyer.name
                  )
                ) : (
                  "In-House, for our own stock"
                )}
              </Fact>
              <Fact label="Factory">
                {p.factory && can.openParty ? (
                  <Link href={productionHref.supplier(p.factory.id)} className={linkClass}>
                    {p.factory.name}
                  </Link>
                ) : (
                  (p.factoryLabel ?? "Not given")
                )}
              </Fact>
              {p.style && (
                <Fact label="Style">
                  {ctx.can("inventory.view") ? (
                    <Link
                      href={`/products/${encodeURIComponent(p.style.id)}`}
                      className={linkClass}
                    >
                      {p.style.code} · {p.style.name}
                    </Link>
                  ) : (
                    `${p.style.code} · ${p.style.name}`
                  )}
                </Fact>
              )}
              {p.category && <Fact label="Category">{p.category.name}</Fact>}
              {p.proforma && (
                <Fact label="Started from">
                  {ctx.can("sales.view") ? (
                    <Link href={salesHref.proforma(p.proforma.id)} className={linkClass}>
                      Proforma {p.proforma.number}
                    </Link>
                  ) : (
                    `Proforma ${p.proforma.number}`
                  )}
                </Fact>
              )}
              <div className="grid grid-cols-2 gap-4">
                <Fact label="Started">{formatDay(p.startOn)}</Fact>
                <Fact label="Target day">{formatDay(p.targetOn)}</Fact>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Fact label="To make">{pieces(p.quantities.target, currency)}</Fact>
                <Fact label="Still to come">{pieces(p.quantities.remaining, currency)}</Fact>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Fact label="A-grade in stock">{pieces(p.quantities.producedA, currency)}</Fact>
                <Fact label="B-grade in stock">{pieces(p.quantities.producedB, currency)}</Fact>
              </div>
            </dl>
          </Panel>
          {p.notes && (
            <Panel title="Notes" id="notes-heading">
              <p className="mt-4 text-sm leading-relaxed break-words whitespace-pre-line">
                {p.notes}
              </p>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
