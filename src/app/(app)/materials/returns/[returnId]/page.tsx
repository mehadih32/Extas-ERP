import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { FlagBadge } from "@/components/materials/badges";
import { materialsHref, perUnit, quantity } from "@/components/materials/labels";
import { MaterialsNoAccess, PricesNoAccess } from "@/components/materials/no-access";
import { ReturnActions } from "@/components/materials/return-actions";
import { Fact, Panel, RecordHeader, Totals } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { BackLink } from "@/components/settings/back-link";
import { formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import { getReturnScreenAction } from "@/server/actions/materials.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Return to supplier" };

const linkClass = "text-primary underline-offset-4 hover:underline";

/**
 * One return to a supplier, a debit note (materials.view with the prices, like
 * GET /api/materials/supplier-returns/:id): what went back from which bill and
 * store, and voiding it as this person may.
 */
export default async function ReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ returnId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  if (!ctx.can("materials.view")) return <MaterialsNoAccess />;
  const [{ returnId }, query] = await Promise.all([params, searchParams]);
  const result = await getReturnScreenAction(returnId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <PricesNoAccess />;
    return <SectionError title="Return" heading="The return could not load" error={result.error} />;
  }
  const screen = result.data;
  const { ret: r, can } = screen;
  const currency = ctx.company.currency;
  const notice =
    query.created === "1"
      ? `${r.number} was saved. The goods left ${r.store} and ${r.supplier.name}'s account was credited.`
      : undefined;

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href={materialsHref.returns}>All returns</BackLink>
        <RecordHeader
          eyebrow={`Debit note ${r.number} · ${formatDay(r.day)}`}
          title={r.supplier.name}
          badges={
            <>
              {r.isVoid && <FlagBadge tone="closed">Void</FlagBadge>}
              <span className="text-sm text-muted-foreground">From {r.bill.number}</span>
            </>
          }
        />
        {r.isVoid && (
          <FormAlert tone="note">
            Voided{r.voidedOn ? ` on ${formatDay(r.voidedOn)}` : ""}
            {r.voidReason ? `: ${r.voidReason}` : "."}
          </FormAlert>
        )}
        <ReturnActions key={r.id} screen={screen} currency={currency} notice={notice} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel title="What went back" id="lines-heading">
            <ul className="mt-4 grid divide-y">
              {r.lines.map((l) => (
                <li
                  key={l.id}
                  className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <Link
                      href={materialsHref.material(l.material.id)}
                      className={`text-sm font-medium break-words ${linkClass}`}
                    >
                      {l.material.code} · {l.material.name}
                    </Link>
                    <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
                      {quantity(l.quantity, l.unit, currency)} at{" "}
                      {perUnit(l.unitPrice, l.unit, currency)}
                    </p>
                  </div>
                  <p
                    className={cn(
                      "text-sm whitespace-nowrap tabular-nums",
                      r.isVoid && "text-muted-foreground line-through",
                    )}
                  >
                    {money(l.amount, currency)}
                  </p>
                </li>
              ))}
            </ul>
            <Totals
              className="mt-4 border-t pt-4"
              currency={currency}
              lines={[
                {
                  label: r.isVoid ? "Was credited" : "Credited to the supplier",
                  amount: r.total,
                  strong: true,
                },
              ]}
            />
          </Panel>
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel
            title="Details"
            id="details-heading"
            action={
              can.openParty ? (
                <Link
                  href={materialsHref.supplier(r.supplier.id)}
                  className={`text-sm ${linkClass}`}
                >
                  Supplier account
                </Link>
              ) : undefined
            }
          >
            <dl className="mt-4 grid gap-4">
              <Fact label="Why">{r.reason}</Fact>
              <Fact label="From the bill">
                <Link href={materialsHref.purchase(r.bill.id)} className={linkClass}>
                  {r.bill.number}
                </Link>{" "}
                of {formatDay(r.bill.billOn)}
                {r.bill.supplierRef ? ` (their no. ${r.bill.supplierRef})` : ""}
              </Fact>
              <Fact label="Left from">{r.store}</Fact>
              {r.createdBy && <Fact label="Entered by">{r.createdBy}</Fact>}
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}
