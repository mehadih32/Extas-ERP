import { FileDownIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { FaultRows, LogFaultButton, ReportCardPicker } from "@/components/production/faults";
import { FAULT_STATUS_LABELS, productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { Panel } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { localDay } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { listFaultsAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Fault log" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" && value ? value : undefined;
const STATUSES = ["OPEN", "DEDUCTED", "WAIVED"] as const;

/**
 * The supplier fault log (production.view, materials.view or accounts.view, as
 * listFaultsAction): shorts at receive, fabric faults and missing pieces, what is still to
 * deduct per supplier with its report card, and, for Production Managers and Accounts,
 * marking each one deducted or waived.
 */
export default async function FaultLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const query = await searchParams;
  const status = STATUSES.find((s) => s === one(query.status));
  const filter = {
    status,
    batchId: one(query.batchId),
    supplierId: one(query.supplierId),
  };
  const result = await listFaultsAction({ ...filter, cursor: one(query.cursor) });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <ProductionNoAccess title="The fault log is not part of your role">
          Production, the store and Accounts see the supplier fault log.
        </ProductionNoAccess>
      );
    }
    return (
      <SectionError title="Fault log" heading="The fault log could not load" error={result.error} />
    );
  }
  const data = result.data;
  const currency = ctx.company.currency;
  const today = localDay(new Date(), ctx.company.timezone);
  const narrowed = filter.batchId || filter.supplierId;
  const tabs = [
    { label: "All", href: productionHref.faults({ ...filter, status: undefined }), on: !status },
    ...STATUSES.map((s) => ({
      label: FAULT_STATUS_LABELS[s],
      href: productionHref.faults({ ...filter, status: s }),
      on: status === s,
    })),
  ];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
      <section aria-labelledby="faults-heading" className="grid min-w-0 content-start gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="faults-heading" className="font-serif text-2xl text-primary">
              Supplier fault log
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              What each supplier or factory owes for: shorts against the challan, faulty fabric,
              quality faults and missing pieces. Open ones are taken off their next payment.
            </p>
          </div>
          {data.can.log && <LogFaultButton today={today} currency={currency} />}
        </div>
        <nav aria-label="Fault status" className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <Link
              key={t.label}
              href={t.href}
              aria-current={t.on ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                t.on
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-card hover:border-primary/40",
              )}
            >
              {t.label}
            </Link>
          ))}
          {narrowed && (
            <Link
              href={productionHref.faults({ status })}
              className="px-2 py-1 text-sm text-primary underline-offset-4 hover:underline"
            >
              Every batch and supplier
            </Link>
          )}
        </nav>
        <div className="rounded-lg border bg-card p-5 sm:p-6">
          <FaultRows
            items={data.items}
            can={data.can}
            currency={currency}
            empty={
              status === "OPEN"
                ? "Nothing is open: every fault is settled."
                : "Nothing in the fault log yet."
            }
          />
          {data.nextCursor && (
            <p className="mt-4 text-sm">
              <Link
                href={`${productionHref.faults({ ...filter, status })}${narrowed || status ? "&" : "?"}cursor=${encodeURIComponent(data.nextCursor)}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                Older faults
              </Link>
            </p>
          )}
        </div>
      </section>

      <div className="grid min-w-0 grid-cols-1 content-start gap-6">
        <Panel title="Still to deduct" id="open-heading">
          {data.openBySupplier.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No supplier has an open fault.</p>
          ) : (
            <ul className="mt-4 grid divide-y" aria-label="Open faults by supplier">
              {data.openBySupplier.map((s) => (
                <li key={s.supplier.id} className="grid gap-1.5 py-3 first:pt-0 last:pb-0">
                  <Link
                    href={productionHref.faults({ supplierId: s.supplier.id, status: "OPEN" })}
                    className="text-sm font-medium break-words text-primary underline-offset-4 hover:underline"
                  >
                    {s.supplier.name}
                  </Link>
                  <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
                    {s.count} open
                    {s.amount !== null ? ` · ${money(s.amount, currency)} to deduct` : ""}
                  </p>
                  {data.can.seeAmounts && (
                    <Button asChild size="sm" variant="outline" className="justify-self-start">
                      <a
                        href={productionHref.reportCard(s.supplier.id)}
                        target="_blank"
                        rel="noopener"
                      >
                        <FileDownIcon aria-hidden />
                        Report card (PDF)
                      </a>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {data.can.seeAmounts && (
          <Panel title="Supplier report card" id="card-heading">
            <p className="mt-1 mb-4 text-sm leading-relaxed text-muted-foreground">
              Any supplier&apos;s last 12 months on one page: deliveries on time, Challan vs Actual,
              the fault log, contracts, a grade and a summary.
            </p>
            <ReportCardPicker />
          </Panel>
        )}
      </div>
    </div>
  );
}
