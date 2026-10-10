import { productionHref, STAGE_LABELS } from "@/components/production/labels";
import { ProjectBadge } from "@/components/production/badges";
import {
  InvoiceBadge,
  OrderBadge,
  QuotationBadge,
  RefundBadge,
  StatusBadge,
} from "@/components/sales/badges";
import { CHANNEL_LABELS, METHOD_LABELS, salesHref } from "@/components/sales/labels";
import { formatCount, formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { Buyer360, BuyerHistory } from "@/modules/parties/buyer-360.service";

import {
  amount,
  DocumentsPanel,
  Empty,
  Figure,
  isZero,
  List,
  Panel,
  plural,
  Row,
  ShowAll,
} from "./profile-bits";

/*
 * The Customer 360° parts of a buyer's profile: the figures at a glance, the
 * styles they buy most, and their order, quotation, payment, production and
 * document history. Everything comes from getBuyer360, which leaves out
 * (null) what the person may not see, so a missing part is simply not drawn.
 */

// =============================================================================
// At a glance
// =============================================================================

/** Total sales, the average order, what they owe, what is overdue, and gross profit. */
export function BuyerFigures({ data, currency }: { data: Buyer360; currency: string }) {
  const { figures } = data;
  const sales = figures.sales;
  if (!sales) return null;
  const overdue = figures.overdue;
  const profit = figures.profit;
  return (
    <section aria-labelledby="glance-heading" className="grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="glance-heading" className="font-serif text-xl text-primary">
          At a glance
        </h3>
        <p className="text-[0.8125rem] text-muted-foreground">
          {sales.firstOn
            ? `Invoiced sales from ${formatDay(sales.firstOn)} to ${formatDay(sales.lastOn ?? sales.firstOn)}`
            : "No invoiced sales yet"}
        </p>
      </div>
      <div
        className={cn(
          "grid grid-cols-1 gap-4 sm:grid-cols-2",
          profit ? "lg:grid-cols-3 2xl:grid-cols-5" : "xl:grid-cols-4",
        )}
      >
        <Figure
          label="Total sales"
          value={amount(sales.total, currency)}
          note={`${plural(sales.orders, "invoiced order", currency)} · ${formatCount(sales.pieces, currency)} pcs`}
        />
        <Figure
          label="Average order"
          value={sales.averageOrder ? amount(sales.averageOrder, currency) : "None yet"}
          note="Sales per invoiced order"
        />
        <Figure
          label="Outstanding"
          value={amount(figures.outstanding, currency)}
          note={
            isZero(figures.heldForThem)
              ? "What they owe today"
              : `${amount(figures.heldForThem, currency)} of theirs held as advance or credit`
          }
        />
        {overdue && (
          <Figure
            label="Overdue"
            value={amount(overdue.amount, currency)}
            tone={isZero(overdue.amount) ? "plain" : "warn"}
            note={
              overdue.invoices > 0
                ? `${plural(overdue.invoices, "invoice", currency)}, oldest ${plural(overdue.oldestDays ?? 0, "day", currency)} late`
                : "Nothing past its due date"
            }
          />
        )}
        {profit && (
          <Figure
            label="Gross profit"
            value={amount(profit.gross, currency)}
            tone={profit.gross.startsWith("-") && !isZero(profit.gross) ? "warn" : "plain"}
            note={`${profit.marginPct ? `${profit.marginPct}% margin · ` : ""}goods cost ${amount(profit.cost, currency)}`}
          />
        )}
      </div>
      <p className="text-[0.8125rem] text-muted-foreground">
        Sales are goods invoiced after discounts, without delivery charges or VAT.
        {profit &&
          " Gross profit is sales less what those goods cost (their landed cost); office overheads are not included."}
      </p>
    </section>
  );
}

// =============================================================================
// Styles bought most
// =============================================================================

export function BuyerTopStyles({ data, currency }: { data: Buyer360; currency: string }) {
  const styles = data.topStyles;
  if (!styles) return null;
  return (
    <Panel title="Styles bought most" id="styles-heading">
      {styles.length === 0 ? (
        <Empty>Nothing invoiced yet.</Empty>
      ) : (
        <ol aria-label="Styles bought most" className="mt-4 grid grid-cols-1 gap-4">
          {styles.map((s, i) => (
            <li key={s.id} className="grid gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 text-sm">
                  <span className="mr-2 text-muted-foreground tabular-nums">{i + 1}.</span>
                  <span className="font-medium">{s.code}</span>
                  <span className="text-muted-foreground"> · {s.name}</span>
                </p>
                <p className="shrink-0 text-sm font-medium tabular-nums">
                  {amount(s.value, currency)}
                </p>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="presentation">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.min(100, Number(s.sharePct ?? 0))}%` }}
                />
              </div>
              <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
                {formatCount(s.pieces, currency)} pcs · {plural(s.orders, "order", currency)}
                {s.sharePct && ` · ${s.sharePct}% of their buying`}
                {s.profit && ` · gross profit ${amount(s.profit, currency)}`}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

// =============================================================================
// History
// =============================================================================

export function BuyerHistoryPanels({
  data,
  currency,
  open,
  basePath,
}: {
  data: Buyer360;
  currency: string;
  /** The history listed in full (?show=). */
  open?: BuyerHistory;
  /** The profile's address, for "Show all". */
  basePath: string;
}) {
  const { orders, quotations, payments, refunds, production, documents } = data;
  const n = (value: number) => formatCount(value, currency);
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {orders && (
        <Panel
          title="Orders"
          id="orders-heading"
          count={orders.total}
          footer={
            <ShowAll
              history="orders"
              shown={orders.items.length}
              total={orders.total}
              open={open}
              basePath={basePath}
              heading="orders-heading"
            />
          }
        >
          {orders.items.length === 0 ? (
            <Empty>No orders yet.</Empty>
          ) : (
            <List label="Orders">
              {orders.items.map((o) => (
                <Row
                  key={o.id}
                  href={salesHref.order(o.id)}
                  title={o.number}
                  meta={`${formatDay(o.orderedOn)} · ${CHANNEL_LABELS[o.channel]}${o.invoice ? ` · ${o.invoice.number}` : ""}`}
                  badges={
                    <>
                      <OrderBadge status={o.status} />
                      {o.invoice && (
                        <InvoiceBadge status={o.invoice.status} isOverdue={o.invoice.isOverdue} />
                      )}
                    </>
                  }
                  value={amount(o.total, currency)}
                  sub={isZero(o.due) ? "Paid" : `Due ${amount(o.due, currency)}`}
                />
              ))}
            </List>
          )}
        </Panel>
      )}

      {quotations && (
        <Panel
          title="Quotations"
          id="quotations-heading"
          count={quotations.total}
          footer={
            <ShowAll
              history="quotations"
              shown={quotations.items.length}
              total={quotations.total}
              open={open}
              basePath={basePath}
              heading="quotations-heading"
            />
          }
        >
          {quotations.items.length === 0 ? (
            <Empty>No quotations yet.</Empty>
          ) : (
            <List label="Quotations">
              {quotations.items.map((q) => (
                <Row
                  key={q.id}
                  href={salesHref.quotation(q.id)}
                  title={q.number}
                  meta={`${formatDay(q.issuedOn)} · ${plural(q.itemCount, "item", currency)}${q.validUntil ? ` · valid until ${formatDay(q.validUntil)}` : ""}`}
                  badges={<QuotationBadge status={q.status} />}
                  value={amount(q.total, q.currency)}
                />
              ))}
            </List>
          )}
        </Panel>
      )}

      {payments && (
        <Panel
          title="Payments received"
          id="payments-heading"
          count={payments.total}
          footer={
            <ShowAll
              history="payments"
              shown={Math.max(payments.items.length, refunds?.items.length ?? 0)}
              total={Math.max(payments.total, refunds?.total ?? 0)}
              open={open}
              basePath={basePath}
              heading="payments-heading"
            />
          }
        >
          {payments.items.length === 0 ? (
            <Empty>No payments yet.</Empty>
          ) : (
            <>
              <p className="mt-1 text-[0.8125rem] text-muted-foreground">
                {amount(payments.totalReceived, currency)} received in all
              </p>
              <List label="Payments received">
                {payments.items.map((p) => (
                  <Row
                    key={p.id}
                    href={salesHref.payment(p.id)}
                    title={p.number}
                    meta={`${formatDay(p.paidOn)} · ${METHOD_LABELS[p.method]} · ${
                      p.order
                        ? `order ${p.order.number}`
                        : p.proforma
                          ? `advance on ${p.proforma.number}`
                          : "on account"
                    }`}
                    badges={p.voided ? <StatusBadge tone="closed">Void</StatusBadge> : undefined}
                    value={amount(p.amount, currency)}
                  />
                ))}
              </List>
            </>
          )}
          {refunds && refunds.items.length > 0 && (
            <>
              <h4 className="mt-5 border-t pt-4 text-sm font-medium">
                Refunds{" "}
                <span className="font-normal text-muted-foreground">{n(refunds.total)}</span>
              </h4>
              <List label="Refunds">
                {refunds.items.map((r) => (
                  <Row
                    key={r.id}
                    href={
                      r.order
                        ? salesHref.order(r.order.id)
                        : r.proforma
                          ? salesHref.proforma(r.proforma.id)
                          : undefined
                    }
                    title={r.number}
                    meta={`${formatDay(r.refundedOn)}${r.order ? ` · order ${r.order.number}` : r.proforma ? ` · ${r.proforma.number}` : ""}`}
                    badges={<RefundBadge kind={r.kind} voided={r.voided} />}
                    value={amount(r.amount, currency)}
                  />
                ))}
              </List>
            </>
          )}
        </Panel>
      )}

      {production && (
        <Panel
          title="Production"
          id="production-heading"
          count={production.total}
          footer={
            <ShowAll
              history="production"
              shown={production.items.length}
              total={production.total}
              open={open}
              basePath={basePath}
              heading="production-heading"
            />
          }
        >
          {production.items.length === 0 ? (
            <Empty>No production for them yet.</Empty>
          ) : (
            <List label="Production">
              {production.items.map((p) => (
                <Row
                  key={p.id}
                  href={productionHref.project(p.id)}
                  title={`${p.code} · ${p.name}`}
                  meta={`${
                    p.completedOn
                      ? `Done ${formatDay(p.completedOn)}`
                      : `Started ${formatDay(p.startedOn)} · target ${formatDay(p.targetOn)}`
                  }${p.factory ? ` · ${p.factory}` : ""}`}
                  badges={
                    <>
                      <ProjectBadge status={p.status} />
                      {p.status === "ACTIVE" && p.stage !== "COMPLETED" && (
                        <StatusBadge tone="plain">{STAGE_LABELS[p.stage]}</StatusBadge>
                      )}
                    </>
                  }
                  value={`${n(p.produced)} of ${n(p.targetQuantity)}`}
                  sub="pcs"
                />
              ))}
            </List>
          )}
        </Panel>
      )}

      <DocumentsPanel
        documents={documents}
        history="documents"
        open={open}
        basePath={basePath}
        className={cn(
          // Alone on its row when the panels above leave it no partner.
          [orders, quotations, payments, production].filter(Boolean).length % 2 === 0 &&
            "lg:col-span-2",
        )}
      />
    </div>
  );
}
