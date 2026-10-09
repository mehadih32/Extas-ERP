import { PaperclipIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { FlagBadge } from "@/components/materials/badges";
import { materialsHref, perUnit, quantity } from "@/components/materials/labels";
import { MaterialsNoAccess, PricesNoAccess } from "@/components/materials/no-access";
import { PurchaseActions } from "@/components/materials/purchase-actions";
import { BillBadge } from "@/components/production/badges";
import { PAYMENT_TYPE_LABELS } from "@/components/production/labels";
import { Fact, Panel, RecordHeader, Totals } from "@/components/sales/detail-bits";
import { METHOD_LABELS, money } from "@/components/sales/labels";
import { BackLink } from "@/components/settings/back-link";
import { formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import { getPurchaseScreenAction } from "@/server/actions/materials.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Purchase" };

const linkClass = "text-primary underline-offset-4 hover:underline";
const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * One raw material purchase (materials.view with the prices, like GET
 * /api/materials/purchases/:id): the materials that came in and how much of
 * each went back, what was paid, the returns made from it, and paying,
 * sending goods back or voiding it as this person may.
 */
export default async function PurchasePage({
  params,
  searchParams,
}: {
  params: Promise<{ billId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  if (!ctx.can("materials.view")) return <MaterialsNoAccess />;
  const [{ billId }, query] = await Promise.all([params, searchParams]);
  const result = await getPurchaseScreenAction(billId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <PricesNoAccess />;
    return (
      <SectionError title="Purchase" heading="The purchase could not load" error={result.error} />
    );
  }
  const screen = result.data;
  const { bill: b, can, notes } = screen;
  const currency = ctx.company.currency;
  const notice =
    one(query.created) === "1"
      ? `${b.number} was saved and the goods are in ${b.store ?? "the store"}.`
      : undefined;
  const isVoid = b.status === "VOID";

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href={materialsHref.purchases}>All purchases</BackLink>
        <RecordHeader
          eyebrow={`Purchase ${b.number} · ${formatDay(b.billOn)}`}
          title={b.supplier.name}
          badges={
            <>
              <BillBadge status={b.status} />
              <span className="text-sm text-muted-foreground">
                {PAYMENT_TYPE_LABELS[b.paymentType]}
                {b.supplierRef ? ` · their no. ${b.supplierRef}` : ""}
              </span>
            </>
          }
        />
        {notes.void && <FormAlert tone="note">{notes.void}</FormAlert>}
        <PurchaseActions key={b.id} screen={screen} currency={currency} notice={notice} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel title="What came in" id="items-heading">
            <ul className="mt-4 grid divide-y">
              {b.items.map((item) => {
                const q = (text: string) => quantity(text, item.unit, currency);
                return (
                  <li
                    key={item.id}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <Link
                        href={materialsHref.material(item.material.id)}
                        className={`text-sm font-medium break-words ${linkClass}`}
                      >
                        {item.material.code} · {item.material.name}
                      </Link>
                      <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
                        {q(item.quantity)} at {perUnit(item.unitPrice, item.unit, currency)}
                      </p>
                      {/[1-9]/.test(item.returned) && (
                        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8125rem]">
                          <FlagBadge tone="plain">{q(item.returned)} sent back</FlagBadge>
                        </p>
                      )}
                      {item.description && (
                        <p className="text-[0.8125rem] break-words text-muted-foreground">
                          {item.description}
                        </p>
                      )}
                    </div>
                    <p
                      className={cn(
                        "text-sm whitespace-nowrap tabular-nums",
                        isVoid && "text-muted-foreground line-through",
                      )}
                    >
                      {money(item.amount, currency)}
                    </p>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title="Payments" id="payments-heading">
            {b.payments.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                {b.paymentType === "DUE" ? "Nothing paid on it yet." : "No payments recorded."}
              </p>
            ) : (
              <ul className="mt-4 grid divide-y">
                {b.payments.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{p.number}</p>
                      <p className="text-[0.8125rem] break-words text-muted-foreground">
                        {formatDay(p.paidOn)} · {METHOD_LABELS[p.method]}
                        {p.account ? ` from ${p.account}` : ""}
                        {p.reference ? ` · ${p.reference}` : ""}
                      </p>
                    </div>
                    <p className="text-sm whitespace-nowrap tabular-nums">
                      {money(p.amount, currency)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {b.returns.length > 0 && (
            <Panel title="Sent back" id="returns-heading">
              <ul className="mt-4 grid divide-y">
                {b.returns.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <Link
                        href={materialsHref.supplierReturn(r.id)}
                        className={`text-sm font-medium ${linkClass}`}
                      >
                        {r.number}
                      </Link>
                      <p className="text-[0.8125rem] break-words text-muted-foreground">
                        {formatDay(r.day)} · {r.reason}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {r.isVoid && <FlagBadge tone="closed">Void</FlagBadge>}
                      <span
                        className={cn(
                          "text-sm whitespace-nowrap tabular-nums",
                          r.isVoid && "text-muted-foreground line-through",
                        )}
                      >
                        {money(r.total, currency)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel title="Amount" id="amount-heading">
            <Totals
              className="mt-4"
              currency={currency}
              lines={[
                { label: "Bill total", amount: b.total, strong: true },
                { label: "Paid", amount: b.paid },
                ...(isVoid
                  ? []
                  : [{ label: "Still owed", amount: b.due, strong: true, tone: "due" as const }]),
              ]}
            />
          </Panel>
          <Panel
            title="Supplier"
            id="supplier-heading"
            action={
              can.openParty ? (
                <Link
                  href={materialsHref.supplier(b.supplier.id)}
                  className={`text-sm ${linkClass}`}
                >
                  Account
                </Link>
              ) : undefined
            }
          >
            <dl className="mt-4 grid gap-4">
              <Fact label="Supplier">{`${b.supplier.name} (${b.supplier.code})`}</Fact>
              {b.supplier.phone && <Fact label="Phone">{b.supplier.phone}</Fact>}
              {b.store && <Fact label="Into the store">{b.store}</Fact>}
              {b.order && (
                <Fact label="Purchase order">
                  <Link href={b.order.href} className={linkClass}>
                    {b.order.number}
                  </Link>
                </Fact>
              )}
              <Fact label="Bill photo">
                {b.attachment ? (
                  <a
                    href={materialsHref.file(b.attachment.id)}
                    target="_blank"
                    rel="noreferrer"
                    className={`inline-flex max-w-full items-center gap-1.5 ${linkClass}`}
                  >
                    <PaperclipIcon className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{b.attachment.fileName}</span>
                  </a>
                ) : (
                  "None attached"
                )}
              </Fact>
            </dl>
          </Panel>
          {b.notes && (
            <Panel title="Notes" id="notes-heading">
              <p className="mt-4 text-sm leading-relaxed break-words whitespace-pre-line">
                {b.notes}
              </p>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
