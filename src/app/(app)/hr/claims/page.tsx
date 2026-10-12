import type { Metadata } from "next";
import Link from "next/link";

import { accountsHref } from "@/components/accounts/labels";
import { Stat } from "@/components/accounts/stat";
import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { FlagBadge } from "@/components/hr/badges";
import { ApproveAllClaims, ClaimDecisions, PayBackClaims } from "@/components/hr/claim-actions";
import {
  CLAIM_FLAG_LABELS,
  CLAIM_KIND_LABELS,
  claimCheckSummary,
  claimFlagNotes,
  claimTitle,
} from "@/components/hr/claim-labels";
import { hrHref, shiftMonth } from "@/components/hr/labels";
import { MonthNav } from "@/components/hr/month-days";
import { HrNoAccess } from "@/components/hr/no-access";
import { EmptyState } from "@/components/products/bits";
import { productionHref } from "@/components/production/labels";
import { money } from "@/components/sales/labels";
import { formatDay, formatMonth } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { ClaimsLedger } from "@/modules/hr/claims.service";
import { distanceText } from "@/modules/hr/geo";
import { getClaimsLedgerAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Claims" };

const linkClass = "text-primary underline-offset-4 hover:underline";
const smallText = "text-[0.8125rem] text-muted-foreground";
const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

type Row = ClaimsLedger["rows"][number];

const STATUSES = [
  [undefined, "All"],
  ["PENDING", "Waiting"],
  ["APPROVED", "Approved"],
  ["REJECTED", "Rejected"],
  ["WITHDRAWN", "Withdrawn"],
] as const;

const KINDS = [
  [undefined, "Both kinds"],
  ["CONVEYANCE", "Conveyance"],
  ["LOCAL_MATERIAL", "Local material"],
] as const;

/** "Waiting", "Approved", "Paid back", "Rejected". */
function StatusBadge({ row }: { row: Row }) {
  if (row.status === "APPROVED") {
    if (row.expense?.voided) return <FlagBadge tone="closed">Expense voided</FlagBadge>;
    if (row.paid) return <FlagBadge tone="done">Paid back</FlagBadge>;
    return <FlagBadge tone="open">Approved, owed</FlagBadge>;
  }
  if (row.status === "REJECTED") return <FlagBadge tone="closed">Rejected</FlagBadge>;
  if (row.status === "WITHDRAWN") return <FlagBadge tone="plain">Withdrawn</FlagBadge>;
  return <FlagBadge tone="warn">Waiting</FlagBadge>;
}

/** What Google Maps said about the route, when it was asked. */
function roadText(row: Row) {
  if (row.kind !== "CONVEYANCE") return null;
  if (row.road.waiting) return "Asking Google Maps for the road distance…";
  if (row.road.metres !== null) return `${distanceText(row.road.metres)} by road (Google Maps)`;
  if (row.road.checked) return "Google Maps could not find this route.";
  return null;
}

/**
 * Staff claims (HR and Accounts): trip fares (conveyance) and local material
 * bought for a production project out of the employee's own pocket. Each
 * claim is checked against the person's attendance and GPS trail for the day,
 * the usual fare per km (Google Maps' road distance when connected) and what
 * the same route usually costs; anything odd is flagged. Accounts approves a
 * claim (it goes in the books, under the project's costs for local material,
 * and is owed to the employee), changes it with a reason, or rejects it, and
 * pays back what is owed. HR sees the claims and their checks.
 */
export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const query = await searchParams;
  const month = one(query.month);
  const status = one(query.status);
  const kind = one(query.kind);
  const claim = one(query.claim);
  const result = await getClaimsLedgerAction({
    month: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : undefined,
    status:
      status && ["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"].includes(status)
        ? status
        : undefined,
    kind: kind && ["CONVEYANCE", "LOCAL_MATERIAL"].includes(kind) ? kind : undefined,
    claim: claim && /^[a-z0-9]{10,40}$/i.test(claim) ? claim : undefined,
  });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <HrNoAccess />;
    return <SectionError title="Claims" heading="Claims could not load" error={result.error} />;
  }
  const l = result.data;
  const currency = ctx.company.currency;
  const previous = shiftMonth(l.month, -1);
  const next = l.month < l.thisMonth ? shiftMonth(l.month, 1) : null;
  const t = l.totals;
  const filter = { status: l.status ?? undefined, kind: l.kind ?? undefined };
  const seeExpenses = ctx.can("expenses.manage") || ctx.can("accounts.view");
  const seeJournal = ctx.can("accounts.view");
  const seeProjects = ctx.can("production.view");

  return (
    <section aria-labelledby="claims-heading" className="grid gap-6">
      <div>
        <h2 id="claims-heading" className="font-serif text-2xl text-primary">
          Claims
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Fares and local material staff paid for themselves, sent from My HR. Each trip is checked
          against the person&apos;s attendance and GPS trail for the day, and against a usual fare
          of {money(l.rules.ratePerKm, currency)} a km and what the same route usually costs.
          Approved claims go in the books and are owed to the employee until Accounts pays them
          back.
        </p>
      </div>

      {!l.access.decide && (
        <FormAlert tone="note">
          You can see the claims and their checks. Accounts approves them and pays them back.
        </FormAlert>
      )}
      {!l.rules.gpsAttendance && (
        <FormAlert tone="note">
          GPS attendance is off, so trips are not checked against a GPS trail.{" "}
          <Link href={hrHref.settings()} className="font-medium underline underline-offset-4">
            Holidays &amp; rules
          </Link>
        </FormAlert>
      )}

      <MonthNav
        label={l.label}
        previous={{ href: hrHref.claims(previous, filter), label: formatMonth(previous) }}
        next={next ? { href: hrHref.claims(next, filter), label: formatMonth(next) } : null}
      />

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Waiting"
          value={String(t.waiting.count)}
          hint={t.waiting.count > 0 ? money(t.waiting.amount, currency) : "Nothing to decide"}
        />
        <Stat
          label="Need a look"
          value={String(t.needsLook)}
          hint="Flagged by the checks"
          alert={t.needsLook > 0}
        />
        <Stat
          label="Approved"
          value={money(t.approved.amount, currency)}
          hint={`${t.approved.count} ${t.approved.count === 1 ? "claim" : "claims"}`}
        />
        <Stat
          label="Paid back"
          value={money(t.paid.amount, currency)}
          hint={`${t.paid.count} ${t.paid.count === 1 ? "claim" : "claims"}`}
        />
      </dl>

      {l.owed.length > 0 && (
        <section aria-labelledby="claims-owed" className="grid gap-3 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="claims-owed" className="font-medium">
              Owed to staff
            </h3>
            <span className="text-sm tabular-nums">
              {money(l.owedTotal, currency)} <span className={smallText}>in all, any month</span>
            </span>
          </div>
          <ul className="grid divide-y" aria-label="Owed to staff">
            {l.owed.map((o) => (
              <li
                key={o.employee.id}
                className="flex flex-col gap-2 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="min-w-0 text-sm">
                  <span className="font-medium">{o.employee.name}</span>{" "}
                  <span className={smallText}>
                    {o.employee.code} · {o.count} {o.count === 1 ? "claim" : "claims"}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-sm whitespace-nowrap tabular-nums">
                    {money(o.amount, currency)}
                  </span>
                  {o.can.pay ? (
                    <PayBackClaims
                      employee={o.employee}
                      count={o.count}
                      amount={o.amount}
                      accounts={l.moneyAccounts}
                      currency={currency}
                      today={l.today}
                    />
                  ) : (
                    l.access.pay && (
                      <span className={smallText}>Someone else pays your own claims back</span>
                    )
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <nav aria-label="Show" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {STATUSES.map(([value, label]) =>
              (l.status ?? undefined) === value ? (
                <span key={label} aria-current="page" className="font-medium">
                  {label}
                </span>
              ) : (
                <Link
                  key={label}
                  href={hrHref.claims(l.month, { status: value, kind: filter.kind })}
                  className={linkClass}
                >
                  {label}
                </Link>
              ),
            )}
          </nav>
          <nav aria-label="Kind" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {KINDS.map(([value, label]) =>
              (l.kind ?? undefined) === value ? (
                <span key={label} aria-current="page" className="font-medium">
                  {label}
                </span>
              ) : (
                <Link
                  key={label}
                  href={hrHref.claims(l.month, { status: filter.status, kind: value })}
                  className={linkClass}
                >
                  {label}
                </Link>
              ),
            )}
          </nav>
        </div>
        {l.access.decide && (
          <ApproveAllClaims
            month={l.month}
            label={l.label}
            count={t.readyToApprove}
            needsLook={t.needsLook}
          />
        )}
      </div>

      {l.rows.length === 0 ? (
        <EmptyState title={l.status || l.kind ? "Nothing here" : "No claims"}>
          {l.status || l.kind
            ? "No claims like this in the month."
            : `Nobody sent a claim for ${l.label}. Staff send claims from My HR.`}
        </EmptyState>
      ) : (
        <ul className="grid gap-3" aria-label="Claims">
          {l.rows.map((r) => {
            const notes = claimFlagNotes(r, currency);
            const summary = claimCheckSummary(r.check, currency);
            const road = roadText(r);
            const changed =
              r.approvedAmount !== null && r.approvedAmount !== r.amount ? r.approvedAmount : null;
            return (
              <li
                key={r.id}
                id={`claim-${r.id}`}
                className={cn(
                  "grid scroll-mt-24 gap-3 rounded-lg border bg-card p-4",
                  r.status === "PENDING" && r.flags.length > 0 && "border-destructive/40",
                  claim === r.id && "ring-2 ring-primary/40",
                )}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <Link
                      href={hrHref.employeeMonth(r.employee.id, l.month)}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {r.employee.name}
                    </Link>
                    <span className={`${smallText} ml-2`}>{r.employee.code}</span>
                    <p className={`mt-0.5 ${smallText}`}>
                      {r.number} · {CLAIM_KIND_LABELS[r.kind]} · {r.weekday}, {formatDay(r.date)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge row={r} />
                    {r.flags.map((f) => (
                      <FlagBadge key={f} tone="warn">
                        {CLAIM_FLAG_LABELS[f]}
                      </FlagBadge>
                    ))}
                  </div>
                </div>

                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                  <div className="min-w-0">
                    <dt className={smallText}>{r.kind === "CONVEYANCE" ? "Trip" : "Bought"}</dt>
                    <dd className="break-words">
                      {claimTitle(r)}
                      {r.kind === "LOCAL_MATERIAL" && r.shop && (
                        <span className={`block ${smallText}`}>From {r.shop}</span>
                      )}
                      {r.routeLink && (
                        <a
                          href={r.routeLink}
                          target="_blank"
                          rel="noreferrer"
                          className={`block ${smallText} ${linkClass}`}
                        >
                          See the route on Google Maps
                        </a>
                      )}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className={smallText}>{r.kind === "CONVEYANCE" ? "What for" : "For"}</dt>
                    <dd className="break-words">
                      {r.kind === "CONVEYANCE" ? (
                        (r.purpose ?? "–")
                      ) : r.project ? (
                        seeProjects ? (
                          <Link href={productionHref.project(r.project.id)} className={linkClass}>
                            {r.project.code} {r.project.name}
                          </Link>
                        ) : (
                          `${r.project.code} ${r.project.name}`
                        )
                      ) : (
                        "–"
                      )}
                      {r.kind === "LOCAL_MATERIAL" && r.purpose && (
                        <span className={`block ${smallText}`}>{r.purpose}</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className={smallText}>Amount</dt>
                    <dd className="tabular-nums">
                      {changed ? (
                        <>
                          {money(changed, currency)}{" "}
                          <span className={`${smallText} line-through`}>
                            {money(r.amount, currency)}
                          </span>
                        </>
                      ) : (
                        money(r.amount, currency)
                      )}
                      {r.receipt ? (
                        <a
                          href={hrHref.file(r.receipt.id)}
                          className={`block ${smallText} ${linkClass}`}
                        >
                          Receipt: {r.receipt.fileName}
                        </a>
                      ) : (
                        <span className={`block ${smallText}`}>No receipt</span>
                      )}
                    </dd>
                  </div>
                </dl>

                {notes.length > 0 && (
                  <ul className="grid gap-1 text-sm" aria-label="What the checks found">
                    {notes.map((note) => (
                      <li key={note} className="text-destructive">
                        {note}
                      </li>
                    ))}
                  </ul>
                )}
                {(summary || road) && (
                  <p className={smallText}>{[summary, road].filter(Boolean).join(" · ")}</p>
                )}

                {r.status !== "PENDING" && r.status !== "WITHDRAWN" && (
                  <p className={smallText}>
                    {r.status === "APPROVED" ? "Approved" : "Rejected"}
                    {r.decidedBy ? ` by ${r.decidedBy}` : ""}
                    {r.decidedAt ? ` on ${formatDay(r.decidedAt)}` : ""}
                    {r.reason ? `: ${r.reason}` : ""}
                  </p>
                )}
                {r.status === "WITHDRAWN" && (
                  <p className={smallText}>Withdrawn by {r.employee.name}.</p>
                )}
                {r.expense && (
                  <p className={smallText}>
                    In the books as{" "}
                    {r.kind === "CONVEYANCE" && seeExpenses ? (
                      <Link href={accountsHref.expense(r.expense.id)} className={linkClass}>
                        {r.expense.number}
                      </Link>
                    ) : r.kind === "LOCAL_MATERIAL" && r.project && seeProjects ? (
                      // Production costs open on their project.
                      <Link href={productionHref.project(r.project.id)} className={linkClass}>
                        {r.expense.number}
                      </Link>
                    ) : (
                      r.expense.number
                    )}
                    {r.costHead ? `, under ${r.costHead.name}` : ""}
                    {r.expense.voided ? ". Accounts voided it, so nothing is owed." : "."}
                  </p>
                )}
                {r.salary && !r.paid && (
                  <p className={smallText}>Paid back with the {r.salary.label} salary.</p>
                )}
                {r.paid && (
                  <p className={smallText}>
                    Paid back on {formatDay(r.paid.on)}
                    {r.salary ? ` with the ${r.salary.label} salary` : ""}
                    {r.paid.by ? ` by ${r.paid.by}` : ""}
                    {r.paid.entry && (
                      <>
                        {" ("}
                        {seeJournal ? (
                          <Link href={accountsHref.entry(r.paid.entry.id)} className={linkClass}>
                            {r.paid.entry.number}
                          </Link>
                        ) : (
                          r.paid.entry.number
                        )}
                        {")"}
                      </>
                    )}
                    .
                  </p>
                )}
                {r.own && r.status === "PENDING" && l.access.decide ? (
                  <p className={smallText}>Someone else in Accounts decides your own claim.</p>
                ) : (
                  r.can.decide && (
                    <ClaimDecisions
                      row={r}
                      costHeads={l.costHeads}
                      defaultHead={l.defaultHead}
                      currency={currency}
                    />
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
