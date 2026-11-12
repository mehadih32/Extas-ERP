import { SearchIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { EmptyState } from "@/components/products/bits";
import { money } from "@/components/sales/labels";
import { SalesNoAccess } from "@/components/sales/no-access";
import { WholesaleReturnForm } from "@/components/sales/wholesale-return-form";
import { BackLink } from "@/components/settings/back-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDay } from "@/lib/display";
import {
  findInvoicesForReturnAction,
  wholesaleReturnFormAction,
} from "@/server/actions/wholesale-returns.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Receive return" };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * "Receive return": the invoice first (search), then its lines: pieces, and
 * Refund or Exchange for each.
 */
export default async function ReceiveReturnPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requireCompanyPage();
  const params = await searchParams;
  const invoiceId = typeof params.invoice === "string" ? params.invoice.trim() : "";
  const currency = ctx.company.currency;

  if (!invoiceId) {
    const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
    const result = await findInvoicesForReturnAction(q);
    if (!result.ok) {
      if (result.error.code === "FORBIDDEN") return <SalesNoAccess />;
      return (
        <SectionError
          title="Receive return"
          heading="The invoices could not load"
          error={result.error}
        />
      );
    }
    return (
      <div className="grid gap-6">
        <BackLink href="/sales/wholesale-returns">All wholesale returns</BackLink>
        <div>
          <h2 className="font-serif text-2xl text-primary">Receive return</h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Goods come back on the invoice they were sold on. Choose the invoice.
          </p>
        </div>
        <form role="search" className="flex w-full gap-2 sm:max-w-md">
          <div className="relative min-w-0 flex-1">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              name="q"
              defaultValue={q}
              autoComplete="off"
              placeholder="Invoice or order number, or buyer"
              aria-label="Search invoices"
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        {result.data.length === 0 ? (
          <EmptyState title={q ? "No invoice matches" : "No invoice to return goods on"}>
            Only invoices of wholesale buyers with goods delivered are listed.
          </EmptyState>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label="Invoices">
            {result.data.map((inv) => (
              <li key={inv.id} className="min-w-0">
                <Link
                  href={`/sales/wholesale-returns/new?invoice=${encodeURIComponent(inv.id)}`}
                  className="block rounded-lg border bg-card p-4 transition-colors hover:border-primary/40"
                >
                  <p className="eyebrow min-w-0 break-words">
                    {inv.number} · {formatDay(inv.issuedOn)}
                  </p>
                  <p className="mt-2 font-serif text-lg leading-snug break-words text-primary">
                    {inv.buyer.name}
                  </p>
                  <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t pt-3 text-sm tabular-nums">
                    <span className="text-muted-foreground">Order {inv.order.number}</span>
                    <span className="font-medium">{money(inv.total, currency)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const result = await wholesaleReturnFormAction(invoiceId);
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <SalesNoAccess />;
    return (
      <SectionError
        title="Receive return"
        heading={
          result.error.code === "NOT_FOUND"
            ? "This invoice was not found"
            : "The form could not load"
        }
        error={result.error}
      />
    );
  }
  return <WholesaleReturnForm form={result.data} />;
}
