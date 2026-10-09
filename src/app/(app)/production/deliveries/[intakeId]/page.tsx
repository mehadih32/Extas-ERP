import { PaperclipIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { DeliveryBadge } from "@/components/production/badges";
import { IntakeActions } from "@/components/production/intake-actions";
import { IntakeLines } from "@/components/production/intake-lines";
import { COSTING_LABELS, pieces, productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { BackLink } from "@/components/settings/back-link";
import { Fact, Panel, RecordHeader, Totals } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { formatCount, formatDay } from "@/lib/display";
import { getIntakeScreenAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Factory delivery" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

const linkClass = "font-medium underline underline-offset-4";

/**
 * One factory delivery (production.view or production.stock_intake, like GET
 * /api/production/intakes/:id): the pieces received by colour, size and grade
 * and, for Production Managers and Accounts, the cost they carry into stock.
 * What may be done comes with the screen from the rules the actions use.
 */
export default async function DeliveryPage({
  params,
  searchParams,
}: {
  params: Promise<{ intakeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ intakeId }, query] = await Promise.all([params, searchParams]);
  const result = await getIntakeScreenAction(intakeId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <ProductionNoAccess />;
    return (
      <SectionError title="Delivery" heading="The delivery could not load" error={result.error} />
    );
  }
  const screen = result.data;
  const { intake: d, costs, notes } = screen;
  const currency = ctx.company.currency;
  const seeProjects = ctx.can("production.view");
  const notice =
    one(query.created) === "1"
      ? `${d.number} is saved as a draft. Check the pieces, then confirm it into stock.`
      : one(query.saved) === "1"
        ? "The changes were saved."
        : one(query.redrafted) === "1"
          ? `${d.number} is a copy of the undone delivery. Correct it, then confirm it into stock.`
          : undefined;
  const draft = d.status === "DRAFT" || d.status === "PARSED";

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href="/production/deliveries">All deliveries</BackLink>
        <RecordHeader
          eyebrow={`Delivery ${d.number} · ${formatDay(d.madeOn)}`}
          title={d.project ? `${d.project.code} · ${d.project.name}` : "No project"}
          badges={
            <>
              <DeliveryBadge status={d.status} />
              <span className="text-sm text-muted-foreground tabular-nums">
                {pieces(d.pieces.total, currency)}
              </span>
            </>
          }
        />
        {d.reversal && (
          <FormAlert tone="note">
            Undone on {formatDay(d.reversal.on)}
            {d.reversal.by ? ` by ${d.reversal.by}` : ""}: {d.reversal.reason}
            {d.corrections.length > 0 && (
              <>
                {" "}
                Corrected in{" "}
                {d.corrections.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && ", "}
                    <Link href={productionHref.delivery(c.id)} className={linkClass}>
                      {c.number}
                    </Link>
                  </span>
                ))}
                .
              </>
            )}
          </FormAlert>
        )}
        {d.correctionOf && (
          <FormAlert tone="note">
            This corrects{" "}
            <Link href={productionHref.delivery(d.correctionOf.id)} className={linkClass}>
              {d.correctionOf.number}
            </Link>
            , which was undone.
          </FormAlert>
        )}
        {notes.receive && <FormAlert tone="note">{notes.receive}</FormAlert>}
        {notes.undo && <FormAlert tone="note">{notes.undo}</FormAlert>}
        <IntakeActions key={d.id} screen={screen} currency={currency} notice={notice} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <IntakeLines groups={d.groups} currency={currency} />
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel title="Delivery" id="delivery-heading">
            <dl className="mt-4 grid gap-4">
              <div className="grid grid-cols-3 gap-3">
                <Fact label="A-grade">{formatCount(d.pieces.aGrade, currency)}</Fact>
                <Fact label="B-grade">{formatCount(d.pieces.bGrade, currency)}</Fact>
                <Fact label="In all">{formatCount(d.pieces.total, currency)}</Fact>
              </div>
              {d.project && (
                <Fact label="Project">
                  {seeProjects ? (
                    <Link
                      href={productionHref.project(d.project.id)}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {d.project.code} · {d.project.name}
                    </Link>
                  ) : (
                    `${d.project.code} · ${d.project.name}`
                  )}
                  <span className="mt-1 block text-[0.8125rem] text-muted-foreground tabular-nums">
                    {formatCount(d.project.received, currency)} of{" "}
                    {pieces(d.project.target, currency)} received so far
                  </span>
                </Fact>
              )}
              <Fact label="Warehouse">{d.warehouse ?? "The main warehouse"}</Fact>
              <div className="grid grid-cols-2 gap-3">
                <Fact label="Made">{formatDay(d.madeOn)}</Fact>
                <Fact label={draft ? "Status" : "In stock"}>
                  {d.confirmedOn ? formatDay(d.confirmedOn) : draft ? "Draft" : "Never"}
                </Fact>
              </div>
              <Fact label="Packing list">
                {d.sourceFile ? (
                  <a
                    href={productionHref.file(d.sourceFile.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex max-w-full items-center gap-1.5 text-primary underline-offset-4 hover:underline"
                  >
                    <PaperclipIcon className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{d.sourceFile.fileName}</span>
                  </a>
                ) : (
                  "None attached"
                )}
              </Fact>
            </dl>
          </Panel>
          {costs && (
            <Panel title="Cost" id="cost-heading">
              <dl className="mt-4 grid gap-4">
                <Fact label="Cost split">
                  {COSTING_LABELS[d.costAllocation]}
                  {d.costAllocation === "B_GRADE_RATIO" && d.bGradePercent !== null
                    ? `: a B-grade piece carries ${d.bGradePercent}%`
                    : ""}
                </Fact>
              </dl>
              {d.status === "CONFIRMED" && costs.totalCost && (
                <Totals
                  className="mt-4 border-t pt-4"
                  currency={currency}
                  lines={[
                    ...(costs.perPiece?.a
                      ? [{ label: "An A-grade piece", amount: costs.perPiece.a }]
                      : []),
                    ...(costs.perPiece?.b
                      ? [{ label: "A B-grade piece", amount: costs.perPiece.b }]
                      : []),
                    { label: "Into stock", amount: costs.totalCost, strong: true },
                  ]}
                />
              )}
              {costs.preview?.error === null && (
                <p className="mt-4 border-t pt-4 text-[0.8125rem] leading-relaxed text-muted-foreground">
                  Confirmed now, it would carry its share of the project&apos;s cost,{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {money(costs.preview.share.totalCost, currency)}
                  </span>
                  , or{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {money(costs.preview.final.totalCost, currency)}
                  </span>{" "}
                  as the factory&apos;s last delivery.
                </p>
              )}
              {costs.preview?.error && (
                <p className="mt-4 border-t pt-4 text-[0.8125rem] text-muted-foreground">
                  {costs.preview.error}
                </p>
              )}
            </Panel>
          )}
          {d.notes && (
            <Panel title="Notes" id="notes-heading">
              <p className="mt-4 text-sm leading-relaxed break-words whitespace-pre-line">
                {d.notes}
              </p>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
