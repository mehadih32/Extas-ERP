import { SearchIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { EmptyState } from "@/components/products/bits";
import { money, salesHref } from "@/components/sales/labels";
import { SalesNoAccess } from "@/components/sales/no-access";
import { SalesReturnForm } from "@/components/sales/sales-return-form";
import { BackLink } from "@/components/settings/back-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDay } from "@/lib/display";
import {
  findReturnableInvoicesAction,
  getSalesReturnFormAction,
} from "@/server/actions/sales.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "New sales return" };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (params: SearchParams, key: string) =>
  typeof params[key] === "string" ? params[key].trim() : "";

const noAccess = (
  <SalesNoAccess title="Recording sales returns is not part of your role">
    A return puts its value on the buyer&apos;s account, so Accounts records it. Your administrator
    can give your role the permission to record money received.
  </SalesNoAccess>
);

/**
 * A new sales return (accounts.receipts.record, the permission
 * createSalesReturnAction checks). It is always made from one invoice:
 * "?invoice=" opens the form for it; without it, the invoice is chosen first.
 */
export default async function NewSalesReturnPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requireCompanyPage();
  const params = await searchParams;
  const invoiceId = one(params, "invoice");
  const currency = ctx.company.currency;

  if (!invoiceId) {
    const q = one(params, "q").slice(0, 100);
    const result = await findReturnableInvoicesAction(q);
    if (!result.ok) {
      if (result.error.code === "FORBIDDEN") return noAccess;
      return (
        <SectionError
          title="New sales return"
          heading="The invoices could not load"
          error={result.error}
        />
      );
    }
    return (
      <div className="grid gap-6">
        <BackLink href="/sales/returns">All sales returns</BackLink>
        <div>
          <h2 className="font-serif text-2xl text-primary">New sales return</h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            A return is made from the invoice the goods were billed on, so each piece is credited at
            the price billed. Choose the invoice.
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
              enterKeyHint="search"
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
            {q
              ? "Try another number or buyer. Only invoices of named buyers with goods delivered are listed."
              : "Goods can come back on an invoice of a named buyer once some of it was delivered."}
          </EmptyState>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label="Invoices">
            {result.data.map((inv) => (
              <li key={inv.id} className="min-w-0">
                <Link
                  href={`/sales/returns/new?invoice=${encodeURIComponent(inv.id)}`}
                  className="group block rounded-lg border bg-card p-4 transition-colors outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/25"
                >
                  <p className="eyebrow truncate">
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

  const result = await getSalesReturnFormAction(invoiceId);
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return noAccess;
    return (
      <SectionError
        title="New sales return"
        heading={
          result.error.code === "NOT_FOUND"
            ? "This invoice was not found"
            : "The form could not load"
        }
        error={result.error}
      />
    );
  }
  const form = result.data;
  const buyer = form.buyer?.name ?? form.customerName ?? "Walk-in customer";

  return (
    <div className="grid gap-6">
      <BackLink href={salesHref.invoice(form.invoice.id)}>Invoice {form.invoice.number}</BackLink>
      <div>
        <p className="eyebrow">
          Invoice {form.invoice.number} · {formatDay(form.invoice.issuedOn)} · order{" "}
          {form.order.number}
        </p>
        <h2 className="mt-2 font-serif text-2xl break-words text-primary">
          Sales return from {buyer}
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Record the pieces the buyer sent back. They are credited at the prices billed on this
          invoice and go to Damage &amp; QC Rejects; a credit note (CN) is made to print or send.
        </p>
      </div>
      {form.blocked ? (
        <div className="grid gap-4">
          <FormAlert tone="note">{form.blocked}</FormAlert>
          <Button asChild variant="outline" className="w-full justify-self-start sm:w-auto">
            <Link href={salesHref.invoice(form.invoice.id)}>Back to the invoice</Link>
          </Button>
        </div>
      ) : (
        <SalesReturnForm form={form} currency={currency} />
      )}
    </div>
  );
}
