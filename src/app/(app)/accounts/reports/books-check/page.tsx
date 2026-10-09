import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import type { Metadata } from "next";

import { signedMoney } from "@/components/accounts/labels";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { Panel } from "@/components/sales/detail-bits";
import { BackLink } from "@/components/settings/back-link";
import { formatDay } from "@/lib/display";
import { getBooksCheckAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Books check" };

/**
 * Checks that the books hold together (accounts.view, like GET
 * /api/accounts/reports/books-check): the journal balances, and stock,
 * materials, assets, loans and payroll agree with their accounts. Each check
 * shows the books' figure beside the register's.
 */
export default async function BooksCheckPage() {
  const ctx = await requireCompanyPage();
  const result = await getBooksCheckAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AccountsNoAccess />;
    return (
      <SectionError title="Books check" heading="The check could not run" error={result.error} />
    );
  }
  const currency = ctx.company.currency;
  const r = result.data;
  // Amounts carry paisa; counts of entries or lines do not.
  const figure = (value: string) => (value.includes(".") ? signedMoney(value, currency) : value);
  const failing = r.checks.filter((c) => !c.ok).length;

  return (
    <section aria-labelledby="check-heading" className="grid gap-6">
      <BackLink href="/accounts/reports">Financial reports</BackLink>
      <div>
        <h2 id="check-heading" className="font-serif text-2xl text-primary">
          Books check
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">As of {formatDay(r.asOf)}</p>
      </div>
      <FormAlert tone={r.ok ? "success" : undefined}>
        {r.ok
          ? "Everything agrees: the journal balances and every register matches its account."
          : `${failing} ${failing === 1 ? "check does" : "checks do"} not agree. Your accountant can look at the figures below.`}
      </FormAlert>
      <Panel title="Checks" id="checks-heading">
        <ul className="mt-4 grid divide-y">
          {r.checks.map((c) => (
            <li key={c.key} className="grid gap-2 py-3 first:pt-0 last:pb-0">
              <p className="flex items-start gap-2 text-sm font-medium">
                {c.ok ? (
                  <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                ) : (
                  <CircleAlertIcon
                    className="mt-0.5 size-4 shrink-0 text-destructive"
                    aria-hidden
                  />
                )}
                <span className="min-w-0 break-words">
                  {c.label}
                  <span className="sr-only">{c.ok ? ": agrees" : ": does not agree"}</span>
                </span>
              </p>
              {!c.ok && (
                <dl className="ml-6 grid grid-cols-1 gap-x-6 gap-y-1 text-[0.8125rem] sm:grid-cols-3">
                  <div className="flex justify-between gap-3 sm:block">
                    <dt className="text-muted-foreground">In the books</dt>
                    <dd className="tabular-nums">{figure(c.books)}</dd>
                  </div>
                  <div className="flex justify-between gap-3 sm:block">
                    <dt className="text-muted-foreground">In the register</dt>
                    <dd className="tabular-nums">{figure(c.register)}</dd>
                  </div>
                  <div className="flex justify-between gap-3 sm:block">
                    <dt className="text-muted-foreground">Difference</dt>
                    <dd className="text-destructive tabular-nums">{figure(c.difference)}</dd>
                  </div>
                </dl>
              )}
              {c.note && (
                <p className="ml-6 text-[0.8125rem] break-words text-muted-foreground">{c.note}</p>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </section>
  );
}
