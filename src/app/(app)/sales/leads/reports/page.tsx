import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { EmptyState } from "@/components/products/bits";
import { SalesNoAccess } from "@/components/sales/no-access";
import { BackLink } from "@/components/settings/back-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { groupAmount } from "@/lib/display";
import { STAGE_LABELS } from "@/modules/leads/labels";
import { getLeadReportAction } from "@/server/actions/leads.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Lead reports" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/**
 * Lead reports: leads by source (each fair is a source), won and lost, the
 * value still open and the orders the leads that became buyers placed.
 */
export default async function LeadReportsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireCompanyPage();
  const params = await searchParams;
  const from = one(params.from);
  const to = one(params.to);
  const result = await getLeadReportAction({ from, to });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <SalesNoAccess />;
    return (
      <SectionError title="Lead reports" heading="The report could not load" error={result.error} />
    );
  }
  const r = result.data;
  const money = (v: string) => `${r.currency} ${groupAmount(v, r.currency)}`;

  return (
    <section aria-labelledby="lead-report-heading" className="grid gap-6">
      <BackLink href="/sales/leads">All leads</BackLink>
      <div>
        <h2 id="lead-report-heading" className="font-serif text-2xl text-primary">
          Lead reports
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Which sources and fairs bring buyers.
          {r.seesAll ? "" : " Only your own leads and those not given to anyone are counted."}
        </p>
      </div>

      <form method="get" className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="grid gap-2">
          <Label htmlFor="report-from">Added from</Label>
          <Input id="report-from" name="from" type="date" defaultValue={from ?? ""} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="report-to">Added to</Label>
          <Input id="report-to" name="to" type="date" defaultValue={to ?? ""} />
        </div>
        <Button type="submit">Show</Button>
      </form>

      {r.total.leads === 0 ? (
        <EmptyState title="No leads in this time">Pick other dates, or add leads first.</EmptyState>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {[
              ["Leads", String(r.total.leads)],
              ["Open", String(r.total.open)],
              ["Won", String(r.total.won)],
              ["Lost", String(r.total.lost)],
              ["Open value", money(r.total.pipeline)],
              ["Orders from them", money(r.total.orders)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border p-3">
                <dt className="text-[0.8125rem] text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-lg break-words tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[40rem] text-sm">
              <caption className="sr-only">Leads by source</caption>
              <thead className="bg-muted/50 text-left text-[0.8125rem] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 text-right font-medium">Leads</th>
                  <th className="px-3 py-2 text-right font-medium">Open</th>
                  <th className="px-3 py-2 text-right font-medium">Won</th>
                  <th className="px-3 py-2 text-right font-medium">Lost</th>
                  <th className="px-3 py-2 text-right font-medium">Became buyers</th>
                  <th className="px-3 py-2 text-right font-medium">Open value</th>
                  <th className="px-3 py-2 text-right font-medium">Orders from them</th>
                </tr>
              </thead>
              <tbody>
                {r.lines.map((l) => (
                  <tr key={l.source} className="border-t">
                    <td className="px-3 py-2 break-words">{l.source}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.leads}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.open}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.won}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.lost}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.buyers}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(l.pipeline)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(l.orders)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <section aria-labelledby="by-stage" className="rounded-md border p-4">
              <h3 id="by-stage" className="font-serif text-lg text-primary">
                By stage
              </h3>
              <ul className="mt-2 grid gap-1 text-sm">
                {r.stages.map((s) => (
                  <li key={s.stage} className="flex justify-between gap-3">
                    <span>{STAGE_LABELS[s.stage]}</span>
                    <span className="tabular-nums">{s.count}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="lost-why" className="rounded-md border p-4">
              <h3 id="lost-why" className="font-serif text-lg text-primary">
                Why leads were lost
              </h3>
              {r.lostReasons.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">None lost.</p>
              ) : (
                <ul className="mt-2 grid gap-1 text-sm">
                  {r.lostReasons.map((l) => (
                    <li key={l.reason} className="flex justify-between gap-3">
                      <span className="min-w-0 break-words">{l.reason}</span>
                      <span className="tabular-nums">{l.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}
