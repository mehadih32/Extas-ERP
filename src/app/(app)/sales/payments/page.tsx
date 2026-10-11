import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { EmptyState } from "@/components/products/bits";
import { ChequeList } from "@/components/sales/cheque-list";
import {
  isSalesFiltered,
  paymentListQuery,
  paymentViewFrom,
  salesListSearch,
} from "@/components/sales/list-view";
import { SalesNoAccess } from "@/components/sales/no-access";
import { PaymentFigures } from "@/components/sales/overview-figures";
import { PaymentList, RefundList } from "@/components/sales/payment-list";
import { ReceiveOnAccount } from "@/components/sales/receive-on-account";
import { SalesFilters } from "@/components/sales/sales-filters";
import { localDay } from "@/lib/dates";
import {
  getPaymentDashboardAction,
  getPaymentListAction,
  listChequeRowsAction,
  listRefundRowsAction,
} from "@/server/actions/sales.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Payments" };

/**
 * The payments dashboard (today's collection, dues, cheques pending and
 * bounced) over money received from buyers, cheques received and money
 * refunded to them, newest first, for sales.view like GET /api/sales/payments,
 * /api/sales/cheques and /api/sales/refunds. Recording a payment and clearing
 * or bouncing a cheque are offered only to Accounts (accounts.receipts.record),
 * the permission the actions check.
 */
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const params = await searchParams;
  const view = paymentViewFrom(params);
  const currency = ctx.company.currency;
  const query = paymentListQuery(view);
  const today = localDay(new Date(), ctx.company.timezone);
  const [dashboard, received, refunds, cheques] = await Promise.all([
    getPaymentDashboardAction(),
    view.show === "received" ? getPaymentListAction(query) : null,
    view.show === "refunds" ? listRefundRowsAction(query) : null,
    view.show === "cheques" ? listChequeRowsAction(query) : null,
  ]);
  const result = received ?? refunds ?? cheques!;
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <SalesNoAccess />;
    return (
      <SectionError title="Payments" heading="The payments could not load" error={result.error} />
    );
  }
  const canReceive = received?.ok
    ? received.data.canReceive
    : cheques?.ok
      ? cheques.data.canManage
      : false;

  return (
    <section aria-labelledby="payments-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="payments-heading" className="font-serif text-2xl text-primary">
            Payments
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Money received from buyers, each with its money receipt, cheques waiting to clear, and
            money refunded to them.
          </p>
        </div>
        {canReceive && (
          <ReceiveOnAccount currency={currency} today={today} startOpen={params.receive === "1"} />
        )}
      </div>

      {dashboard.ok && <PaymentFigures dashboard={dashboard.data} currency={currency} />}

      <SalesFilters view={view}>
        {received?.ok ? (
          received.data.items.length === 0 ? (
            <EmptyState
              title={isSalesFiltered(view) ? "Nothing received in these days" : "No payments yet"}
            >
              {isSalesFiltered(view)
                ? "Try other days, or clear the dates."
                : "Payments show here once Accounts records them against an order, a proforma or a buyer's account."}
            </EmptyState>
          ) : (
            <PaymentList
              key={salesListSearch(view)}
              initial={{ items: received.data.items, nextCursor: received.data.nextCursor }}
              view={view}
              currency={currency}
            />
          )
        ) : refunds?.ok ? (
          refunds.data.items.length === 0 ? (
            <EmptyState
              title={isSalesFiltered(view) ? "No refunds in these days" : "No refunds yet"}
            >
              {isSalesFiltered(view)
                ? "Try other days, or clear the dates."
                : "Money paid back, kept as credit or kept as a cancellation charge shows here."}
            </EmptyState>
          ) : (
            <RefundList
              key={salesListSearch(view)}
              initial={refunds.data}
              view={view}
              currency={currency}
            />
          )
        ) : cheques?.ok ? (
          <ChequeList
            key={salesListSearch(view)}
            initial={cheques.data}
            view={view}
            currency={currency}
            today={today}
            empty={
              <EmptyState
                title={view.chequeStatus ? "No cheques with this status" : "No cheques yet"}
              >
                {view.chequeStatus
                  ? "Try another status, or show every cheque."
                  : "Cheques show here once Accounts records one. A cheque is put in the books only when it clears."}
              </EmptyState>
            }
          />
        ) : null}
      </SalesFilters>
    </section>
  );
}
