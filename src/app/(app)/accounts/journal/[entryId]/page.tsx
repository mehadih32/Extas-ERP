import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OffBadge } from "@/components/accounts/badges";
import { EntryActions } from "@/components/accounts/entry-actions";
import { accountsHref, columnAmount, SOURCE_LABELS } from "@/components/accounts/labels";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { Fact, Panel, RecordHeader } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { BackLink } from "@/components/settings/back-link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDay } from "@/lib/display";
import { getJournalEntryScreenAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Journal entry" };

const linkClass = "text-primary underline-offset-4 hover:underline";

/**
 * One journal entry (accounts.view, like GET /api/accounts/journal/:id): its
 * lines, the record that made it (linked when this person may open it), the
 * entry it reverses or that reversed it, and reversing a hand-written one.
 */
export default async function JournalEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ entryId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ entryId }, query] = await Promise.all([params, searchParams]);
  const result = await getJournalEntryScreenAction(entryId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <AccountsNoAccess />;
    return (
      <SectionError title="Journal entry" heading="The entry could not load" error={result.error} />
    );
  }
  const screen = result.data;
  const { entry: e, source } = screen;
  const currency = ctx.company.currency;
  const notice = query.created === "1" ? `${e.number} was posted.` : undefined;

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href="/accounts/journal">Journal</BackLink>
        <RecordHeader
          eyebrow={`${e.number} · ${formatDay(e.day)}`}
          title={e.description ?? SOURCE_LABELS[e.sourceType]}
          badges={
            <>
              {e.isReversed && <OffBadge>Reversed</OffBadge>}
              {e.reversalOf && <OffBadge>Reversal</OffBadge>}
              <span className="font-serif text-lg text-primary tabular-nums">
                {money(e.total, currency)}
              </span>
            </>
          }
        />
        <EntryActions key={e.id} screen={screen} notice={notice} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <Panel title="Lines" id="lines-heading" className="min-w-0">
          <ul className="mt-4 grid divide-y lg:hidden" aria-label="Lines">
            {e.lines.map((l) => (
              <li key={l.id} className="grid gap-1 py-3 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <Link
                    href={accountsHref.account(l.account.id)}
                    className={`min-w-0 text-sm font-medium ${linkClass}`}
                  >
                    {l.account.code} {l.account.name}
                  </Link>
                  <span className="text-sm whitespace-nowrap tabular-nums">
                    {/[1-9]/.test(l.debit) ? "Dr " : "Cr "}
                    {money(/[1-9]/.test(l.debit) ? l.debit : l.credit, currency)}
                  </span>
                </div>
                {(l.party || l.memo) && (
                  <p className="text-[0.8125rem] break-words text-muted-foreground">
                    {[l.party?.name, l.memo].filter(Boolean).join(" · ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-4 hidden lg:block">
            <Table aria-label="Lines">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Account</TableHead>
                  <TableHead>Buyer, supplier or note</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {e.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="py-3">
                      <Link href={accountsHref.account(l.account.id)} className={linkClass}>
                        {l.account.code} {l.account.name}
                      </Link>
                    </TableCell>
                    <TableCell className="py-3 whitespace-normal text-muted-foreground">
                      {[l.party?.name, l.memo].filter(Boolean).join(" · ")}
                    </TableCell>
                    <TableCell className="py-3 text-right tabular-nums">
                      {columnAmount(l.debit, currency)}
                    </TableCell>
                    <TableCell className="py-3 text-right tabular-nums">
                      {columnAmount(l.credit, currency)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 hover:bg-transparent">
                  <TableCell colSpan={2} className="font-medium">
                    Total
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {money(e.total, currency)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {money(e.total, currency)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </Panel>

        <Panel title="About this entry" id="about-heading" className="min-w-0 content-start">
          <dl className="mt-4 grid gap-4">
            <Fact label="Made by">{SOURCE_LABELS[e.sourceType]}</Fact>
            {source && (
              <Fact label="From">
                {source.href ? (
                  <Link href={source.href} className={linkClass}>
                    {source.title}
                  </Link>
                ) : (
                  source.title
                )}
              </Fact>
            )}
            {e.reversalOf && (
              <Fact label="Reverses">
                <Link href={accountsHref.entry(e.reversalOf.id)} className={linkClass}>
                  {e.reversalOf.number}
                </Link>
              </Fact>
            )}
            {e.reversedBy && (
              <Fact label="Reversed by">
                <Link href={accountsHref.entry(e.reversedBy.id)} className={linkClass}>
                  {e.reversedBy.number}
                </Link>
              </Fact>
            )}
            <Fact label="Posted by">{e.postedBy ?? "The system"}</Fact>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
