import { SendIcon, Undo2Icon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { IssueKindBadge } from "@/components/materials/badges";
import { materialsHref, perUnit, quantity } from "@/components/materials/labels";
import { MaterialsNoAccess } from "@/components/materials/no-access";
import { PROJECT_STATUS_LABELS } from "@/components/production/labels";
import { Fact, Panel, RecordHeader, Totals } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { BackLink } from "@/components/settings/back-link";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/display";
import { getIssueScreenAction } from "@/server/actions/materials.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Issue note" };

const linkClass = "text-primary underline-offset-4 hover:underline";

/**
 * One issue note or return note (materials.view, like GET
 * /api/materials/issues/:id): the project, the store, and each material with
 * its cost for people who see material prices. Notes are not voided: a
 * mistake is put right with a note the other way, offered to the store team
 * while the project is open.
 */
export default async function IssuePage({
  params,
  searchParams,
}: {
  params: Promise<{ issueId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ issueId }, query] = await Promise.all([params, searchParams]);
  const result = await getIssueScreenAction(issueId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <MaterialsNoAccess />;
    return (
      <SectionError title="Issue note" heading="The note could not load" error={result.error} />
    );
  }
  const { note: n, seeCosts, can } = result.data;
  const currency = ctx.company.currency;
  const issued = n.kind === "ISSUE";
  const created = query.created === "1";

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href={materialsHref.issues}>All issue notes</BackLink>
        <RecordHeader
          eyebrow={`${issued ? "Issue note" : "Return note"} ${n.number} · ${formatDay(n.day)}`}
          title={`${n.project.code} · ${n.project.name}`}
          badges={
            <>
              <IssueKindBadge kind={n.kind} />
              <span className="text-sm text-muted-foreground">
                {issued ? `From ${n.store}` : `Into ${n.store}`}
              </span>
            </>
          }
        />
        {created && (
          <FormAlert tone="success">
            {issued
              ? `${n.number} was saved. The materials left ${n.store} for ${n.project.code}.`
              : `${n.number} was saved. The materials are back in ${n.store}.`}
          </FormAlert>
        )}
        {can.correct && (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href={materialsHref.newIssue(issued ? "return" : "issue", n.project.id)}>
                {issued ? <Undo2Icon aria-hidden /> : <SendIcon aria-hidden />}
                {issued ? "Take some back" : "Issue more"}
              </Link>
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <Panel title={issued ? "Handed over" : "Came back"} id="lines-heading">
          <ul className="mt-4 grid divide-y">
            {n.lines.map((l) => (
              <li
                key={l.material.id}
                className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <Link
                    href={materialsHref.material(l.material.id)}
                    className={`text-sm font-medium break-words ${linkClass}`}
                  >
                    {l.material.code} · {l.material.name}
                  </Link>
                  {seeCosts && l.unitCost && (
                    <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
                      at {perUnit(l.unitCost, l.unit, currency)}
                    </p>
                  )}
                </div>
                <div className="text-right text-sm whitespace-nowrap tabular-nums">
                  <p className="font-medium">{quantity(l.quantity, l.unit, currency)}</p>
                  {seeCosts && l.value && (
                    <p className="text-[0.8125rem] text-muted-foreground">
                      {money(l.value, currency)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {seeCosts && n.total && (
            <Totals
              className="mt-4 border-t pt-4"
              currency={currency}
              lines={[
                {
                  label: issued ? "Cost to the project" : "Off the project's cost",
                  amount: n.total,
                  strong: true,
                },
              ]}
            />
          )}
        </Panel>
        <Panel title="Details" id="details-heading">
          <dl className="mt-4 grid gap-4">
            <Fact label="Project">
              {n.project.href ? (
                <Link href={n.project.href} className={linkClass}>
                  {n.project.code} · {n.project.name}
                </Link>
              ) : (
                `${n.project.code} · ${n.project.name}`
              )}
              <span className="block text-[0.8125rem] text-muted-foreground">
                {PROJECT_STATUS_LABELS[n.project.status]}
              </span>
            </Fact>
            <Fact label={issued ? "From the store" : "Into the store"}>{n.store}</Fact>
            {n.receivedBy && (
              <Fact label={issued ? "Taken by" : "Brought back by"}>{n.receivedBy}</Fact>
            )}
            {n.createdBy && <Fact label="Entered by">{n.createdBy}</Fact>}
            {n.note && <Fact label="Note">{n.note}</Fact>}
          </dl>
        </Panel>
      </div>
    </div>
  );
}
