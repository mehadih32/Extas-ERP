import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { formatDay, groupAmount } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { LeadRow } from "@/modules/leads/lead.service";
import { NEXT_KIND_LABELS, STAGE_LABELS, STAGE_ORDER } from "@/modules/leads/labels";

/*
 * The leads as a list (a table on a laptop, cards on a phone) or as a board
 * with a column for each stage. Server-drawn: the filters and the view are in
 * the address.
 */

const href = (id: string) => `/sales/leads/${encodeURIComponent(id)}`;

/** The next step, red when late, with its day. */
function NextStep({ lead }: { lead: LeadRow }) {
  if (!lead.nextActionOn) return <span className="text-muted-foreground">No next step</span>;
  return (
    <span className={cn(lead.late ? "text-destructive" : "text-foreground")}>
      {lead.nextActionKind ? NEXT_KIND_LABELS[lead.nextActionKind] : "Follow up"}{" "}
      {lead.dueToday ? "today" : formatDay(lead.nextActionOn)}
      {lead.late ? " (late)" : ""}
    </span>
  );
}

function StageBadge({ stage }: { stage: LeadRow["stage"] }) {
  return (
    <Badge
      variant={stage === "WON" ? "default" : stage === "LOST" ? "alert" : "secondary"}
      className="normal-case"
    >
      {STAGE_LABELS[stage]}
    </Badge>
  );
}

function LeadCard({ lead, currency }: { lead: LeadRow; currency: string }) {
  return (
    <li className="rounded-md border bg-card p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={href(lead.id)}
            className="font-medium break-words text-primary hover:underline"
          >
            {lead.name}
          </Link>
          <p className="text-[0.8125rem] text-muted-foreground">
            {lead.number}
            {lead.country ? ` · ${lead.country}` : ""}
            {lead.source ? ` · ${lead.source}` : ""}
          </p>
        </div>
        <StageBadge stage={lead.stage} />
      </div>
      <dl className="mt-3 grid gap-1 text-sm">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted-foreground">Next step:</dt>
          <dd>
            <NextStep lead={lead} />
          </dd>
        </div>
        {lead.contact && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">Contact:</dt>
            <dd className="break-words">{lead.contact}</dd>
          </div>
        )}
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted-foreground">Followed by:</dt>
          <dd>{lead.owner?.name ?? "Nobody yet"}</dd>
        </div>
        {lead.expectedValue && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">Expected value:</dt>
            <dd className="tabular-nums">
              {currency} {groupAmount(lead.expectedValue, currency)}
            </dd>
          </div>
        )}
      </dl>
    </li>
  );
}

/** A table on a laptop; the same leads as cards on a phone. */
export function LeadList({ rows, currency }: { rows: LeadRow[]; currency: string }) {
  return (
    <>
      <ul className="grid grid-cols-1 gap-3 md:hidden">
        {rows.map((lead) => (
          <LeadCard key={lead.id} lead={lead} currency={currency} />
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-md border md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-[0.8125rem] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Lead</th>
              <th className="px-3 py-2 font-medium">Stage</th>
              <th className="px-3 py-2 font-medium">Next step</th>
              <th className="px-3 py-2 font-medium">Followed by</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 text-right font-medium">Expected value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((lead) => (
              <tr key={lead.id} className="border-t align-top">
                <td className="px-3 py-2">
                  <Link href={href(lead.id)} className="font-medium text-primary hover:underline">
                    {lead.name}
                  </Link>
                  <span className="block text-[0.8125rem] text-muted-foreground">
                    {lead.number}
                    {lead.country ? ` · ${lead.country}` : ""}
                    {lead.contact ? ` · ${lead.contact}` : ""}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <StageBadge stage={lead.stage} />
                </td>
                <td className="px-3 py-2">
                  <NextStep lead={lead} />
                </td>
                <td className="px-3 py-2">{lead.owner?.name ?? "Nobody yet"}</td>
                <td className="px-3 py-2">{lead.source ?? ""}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {lead.expectedValue
                    ? `${currency} ${groupAmount(lead.expectedValue, currency)}`
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** One column for each stage, its leads as cards; on a phone the columns sit one under another. */
export function LeadBoard({ rows, currency }: { rows: LeadRow[]; currency: string }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {STAGE_ORDER.map((stage) => {
        const inStage = rows.filter((r) => r.stage === stage);
        return (
          <section key={stage} aria-label={STAGE_LABELS[stage]} className="min-w-0">
            <h3 className="flex items-baseline justify-between gap-2 border-b pb-1 text-sm font-medium">
              <span>{STAGE_LABELS[stage]}</span>
              <span className="text-muted-foreground tabular-nums">{inStage.length}</span>
            </h3>
            {inStage.length === 0 ? (
              <p className="mt-2 text-[0.8125rem] text-muted-foreground">None</p>
            ) : (
              <ul className="mt-2 grid grid-cols-1 gap-2">
                {inStage.map((lead) => (
                  <LeadCard key={lead.id} lead={lead} currency={currency} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
