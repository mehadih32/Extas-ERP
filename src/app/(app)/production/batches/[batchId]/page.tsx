import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { EmptyState } from "@/components/products/bits";
import { ActionLogLink } from "@/components/production/action-log";
import { TimelineBadge } from "@/components/production/badges";
import { BatchActions } from "@/components/production/batch-actions";
import { BatchBookingsPanel } from "@/components/production/batch-bookings";
import { BatchBadge, batchStatus, stylesText } from "@/components/production/batch-card";
import { BatchMoneyPanel } from "@/components/production/batch-money";
import { BatchContractsPanel } from "@/components/production/contracts";
import { BatchGuardLine, GUARD_TONES, GUARD_WORDS } from "@/components/production/cost-guard";
import { BatchFaultsPanel } from "@/components/production/faults";
import { BatchMaterialsPanel } from "@/components/production/material-needs";
import {
  BATCH_KIND_HINTS,
  BATCH_KIND_LABELS,
  pieces,
  productionHref,
} from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { PiecesBar, ProjectCard, TimelineBar } from "@/components/production/project-card";
import { FormAlert } from "@/components/forms/field";
import { BackLink } from "@/components/settings/back-link";
import { Fact, Panel, RecordHeader } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { localDay } from "@/lib/dates";
import { formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import {
  getBatchContractsAction,
  getBatchDateWarningsAction,
  getBatchMaterialsAction,
  getBatchMoneyAction,
  getBatchScreenAction,
  listFaultsAction,
} from "@/server/actions/production.actions";
import { getBatchBookingsAction } from "@/server/actions/booking.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Master batch" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

const linkClass = "text-primary underline-offset-4 hover:underline";

/**
 * One master batch (production.view, like GET /api/production/batches/:id): what
 * its styles add up to (days, pieces and, for Production Managers and Accounts,
 * the cost so far and the batch's cost guard) and a card per style with its own
 * stage, days, pieces and cost guard. A Production Manager adds styles here.
 * Its fabric bookings are listed with "Book fabric" and "Attach a booking".
 */
export default async function BatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ batchId }, query] = await Promise.all([params, searchParams]);
  const [result, materials, contracts, faults, dates, batchMoney, bookings] = await Promise.all([
    getBatchScreenAction(batchId),
    getBatchMaterialsAction(batchId),
    // Production Managers and Accounts only; nobody else gets the panel.
    getBatchContractsAction(batchId),
    listFaultsAction({ batchId, take: 5 }),
    getBatchDateWarningsAction(batchId),
    // Production Managers and Accounts only, like the contracts.
    getBatchMoneyAction(batchId),
    getBatchBookingsAction(batchId),
  ]);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <ProductionNoAccess />;
    return <SectionError title="Batch" heading="The batch could not load" error={result.error} />;
  }
  const screen = result.data;
  const { batch: b, styles, can } = screen;
  const currency = ctx.company.currency;
  const notice =
    one(query.created) === "1"
      ? `${b.code} was created. Add its first style.`
      : one(query.saved) === "1"
        ? "The changes were saved."
        : one(query.ordered)
          ? `Purchase orders made: ${one(query.ordered)}. Print each one for its supplier from its page.`
          : one(query.received)
            ? `${one(query.received)} was received into the store.`
            : one(query.issued)
              ? `Issued to the styles: ${one(query.issued)}. Each style is charged only for what it took.`
              : undefined;
  const guard = b.costs?.guard ?? null;
  const styleGuards = styles.filter((s) => s.costGuard && s.costGuard.level !== "OK");

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href="/production/batches">All batches</BackLink>
        <RecordHeader
          eyebrow={`${b.code} · ${BATCH_KIND_LABELS[b.kind]}`}
          title={b.name}
          badges={
            <>
              <BatchBadge state={b.state} />
              {b.timeline && b.state !== "DONE" && <TimelineBadge timeline={b.timeline} />}
            </>
          }
        />
        <BatchActions screen={screen} notice={notice} />
        {one(query.received) && one(query.faults) && (
          <FormAlert>
            {one(query.faults) === "1" ? "1 line came" : `${one(query.faults)} lines came`} short
            against the challan beyond the allowance. It is in the{" "}
            <Link
              href={productionHref.faults({ batchId: b.id, status: "OPEN" })}
              className="underline underline-offset-4"
            >
              fault log
            </Link>{" "}
            to deduct, and the Production Managers were alerted.
          </FormAlert>
        )}
        {dates.ok && dates.data.length > 0 && (
          <FormAlert tone={dates.data.some((w) => w.level === "LATE") ? "error" : "note"}>
            <span className="font-medium">Cutting and sewing dates to watch</span>
            <ul className="mt-1 grid gap-0.5" aria-label="Dates to watch">
              {dates.data.map((w) => (
                <li key={`${w.project.id}${w.text}`}>
                  <Link
                    href={productionHref.cutting(w.project.id)}
                    className="font-medium underline underline-offset-4"
                  >
                    {w.project.code}
                  </Link>{" "}
                  {w.text}
                </li>
              ))}
            </ul>
          </FormAlert>
        )}
        {b.styleCount > 0 && (
          <div className="grid gap-5 rounded-lg border bg-card p-5 sm:p-6 md:grid-cols-2 md:gap-8">
            {b.timeline && (
              <TimelineBar
                timeline={b.timeline}
                status={batchStatus(b.state)}
                targetOn={b.timeline.dueOn}
                completedOn={null}
              />
            )}
            <PiecesBar quantities={b.quantities} currency={currency} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <section aria-labelledby="styles-heading" className="grid min-w-0 content-start gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 id="styles-heading" className="font-serif text-xl text-primary">
                Styles
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {b.styleCount === 0
                  ? "Each style is a project of its own: its colours and sizes, target price, costs and deliveries."
                  : `${stylesText(b)}, ${pieces(b.quantities.target, currency)} to make.`}
              </p>
            </div>
          </div>
          {styleGuards.length > 0 && (
            <ul className="grid gap-2" aria-label="Cost guard warnings">
              {styleGuards.map((s) => (
                <li
                  key={s.id}
                  className={cn(
                    "rounded-md border px-3 py-2.5 text-sm",
                    GUARD_TONES[s.costGuard!.level].panel,
                  )}
                >
                  <Link
                    href={productionHref.project(s.id)}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {s.code} · {s.name}
                  </Link>
                  <span className={cn("ml-1", GUARD_TONES[s.costGuard!.level].text)}>
                    {GUARD_WORDS[s.costGuard!.level].toLowerCase()}:{" "}
                    {money(s.costGuard!.perPiece, currency)} of{" "}
                    {money(s.costGuard!.target, currency)} a piece ({s.costGuard!.percent}%)
                  </span>
                </li>
              ))}
            </ul>
          )}
          {styles.length === 0 ? (
            <EmptyState
              title="No styles yet"
              action={
                can.addStyle ? (
                  <Button asChild>
                    <Link href={productionHref.addStyle(b.id)}>
                      <PlusIcon aria-hidden />
                      Add the first style
                    </Link>
                  </Button>
                ) : undefined
              }
            >
              Add each style made in this batch, like a navy polo in five colours, with its pieces
              per colour and size.
            </EmptyState>
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label="Styles">
              {styles.map((style) => (
                <ProjectCard key={style.id} project={style} currency={currency} />
              ))}
            </ul>
          )}
          {materials.ok && styles.length > 0 && (
            <BatchMaterialsPanel data={materials.data} currency={currency} />
          )}
        </section>

        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          {bookings.ok && <BatchBookingsPanel data={bookings.data} currency={currency} />}
          {b.costs && (
            <Panel
              title="Batch cost"
              id="batch-cost-heading"
              action={
                b.styleCount > 0 ? (
                  <Link
                    href={productionHref.batchSummary(b.id)}
                    className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Batch summary
                  </Link>
                ) : undefined
              }
            >
              <dl className="mt-4 grid grid-cols-2 gap-4 tabular-nums">
                <Fact label="Cost so far">{money(b.costs.totalCost, currency)}</Fact>
                <Fact label="Cost a piece">
                  {b.costs.perPiece ? money(b.costs.perPiece, currency) : "—"}
                </Fact>
              </dl>
              {guard ? (
                <div className="mt-5 grid gap-2">
                  <p className={cn("text-sm font-medium", GUARD_TONES[guard.level].text)}>
                    {GUARD_WORDS[guard.level]}
                  </p>
                  <BatchGuardLine guard={guard} currency={currency} />
                  <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                    {guard.level === "OVER"
                      ? `The ${guard.styles === 1 ? "style" : "styles"} with a target price already cost more than their pieces may.`
                      : `${money(guard.left, currency)} is left before the ${guard.styles === 1 ? "style" : "styles"} with a target price reach it.`}
                  </p>
                </div>
              ) : (
                b.styleCount > 0 && (
                  <p className="mt-4 text-[0.8125rem] text-muted-foreground">
                    Give each style a target price per piece to see the batch&apos;s cost guard.
                  </p>
                )
              )}
            </Panel>
          )}
          {batchMoney.ok && (
            <BatchMoneyPanel
              data={batchMoney.data}
              styles={styles
                .filter((s) => s.status !== "COMPLETED" && s.status !== "CANCELLED")
                .map((s) => ({ id: s.id, code: s.code, name: s.name }))}
              canAddCost={ctx.can("production.manage") || ctx.can("accounts.payments.record")}
              canPayNow={ctx.can("accounts.payments.record")}
              currency={currency}
            />
          )}
          {contracts.ok && <BatchContractsPanel data={contracts.data} />}
          {faults.ok && (faults.data.items.length > 0 || faults.data.can.log) && (
            <BatchFaultsPanel
              data={faults.data}
              batch={{ id: b.id, code: b.code }}
              today={localDay(new Date(), ctx.company.timezone)}
              currency={currency}
            />
          )}
          {(ctx.can("production.manage") || ctx.can("accounts.view")) && (
            <ActionLogLink href={productionHref.batchLog(b.id)} of="batch" />
          )}
          <Panel title="Details" id="details-heading">
            <dl className="mt-4 grid gap-4">
              <Fact label="How the goods are made">
                {BATCH_KIND_LABELS[b.kind]}
                <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground">
                  {BATCH_KIND_HINTS[b.kind]}
                </span>
              </Fact>
              <Fact label="Factory">
                {b.factory ? (
                  ctx.can("parties.view") ? (
                    <Link href={productionHref.supplier(b.factory.id)} className={linkClass}>
                      {b.factory.name}
                    </Link>
                  ) : (
                    b.factory.name
                  )
                ) : (
                  "Not given"
                )}
              </Fact>
              <div className="grid grid-cols-2 gap-4">
                <Fact label="All done by">{b.targetOn ? formatDay(b.targetOn) : "Not given"}</Fact>
                <Fact label="Started">{formatDay(b.createdOn)}</Fact>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Fact label="To make">{pieces(b.quantities.target, currency)}</Fact>
                <Fact label="In stock">{pieces(b.quantities.produced, currency)}</Fact>
              </div>
              {b.kind === "CM" && (
                <Fact label="Reject allowance">
                  {b.rejectAllowance}% of the pieces cut
                  <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground">
                    Rejects over it are taken off the factory&apos;s CM at the style&apos;s target
                    price. Missing pieces always are.
                  </span>
                </Fact>
              )}
              {b.createdBy && <Fact label="Opened by">{b.createdBy}</Fact>}
            </dl>
          </Panel>
          {b.notes && (
            <Panel title="Notes" id="notes-heading">
              <p className="mt-4 text-sm leading-relaxed break-words whitespace-pre-line">
                {b.notes}
              </p>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
