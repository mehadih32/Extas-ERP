import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { DecisionBadge } from "@/components/production/costing/badges";
import {
  CostingHeaderActions,
  DecisionPanel,
} from "@/components/production/costing/decision-panel";
import { OrderCheckCard } from "@/components/production/costing/order-check-card";
import { StylesPanel } from "@/components/production/costing/styles-panel";
import { productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { Fact, Panel, RecordHeader } from "@/components/sales/detail-bits";
import { salesHref } from "@/components/sales/labels";
import { BackLink } from "@/components/settings/back-link";
import { formatDay } from "@/lib/display";
import { TRADE_PAYMENT_LABELS } from "@/modules/costing/costing-labels";
import { getCostingAction } from "@/server/actions/costing.actions";

export const metadata: Metadata = { title: "Costing sheet" };

const linkClass = "text-primary underline-offset-4 hover:underline";
const pct = (n: number) => `${Number(n.toFixed(2))}%`;

/**
 * One order's costing sheet (costing.view): its details, the Order check card,
 * the styles costed per dozen and the owner's decision.
 */
export default async function CostingSheetPage({
  params,
}: {
  params: Promise<{ costingId: string }>;
}) {
  const { costingId } = await params;
  const result = await getCostingAction(costingId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") {
      return (
        <ProductionNoAccess title="Costing is not part of your role">
          Your administrator can give your role the permission to see costing sheets.
        </ProductionNoAccess>
      );
    }
    return (
      <SectionError
        title="Costing sheet"
        heading="The costing sheet could not load"
        error={result.error}
      />
    );
  }
  const c = result.data;
  const percentLines = [
    c.sourceTaxPercent > 0 ? `source tax ${pct(c.sourceTaxPercent)}` : null,
    c.bankChargePercent > 0 ? `bank charges ${pct(c.bankChargePercent)}` : null,
    c.commissionPercent > 0 ? `commission ${pct(c.commissionPercent)}` : null,
  ].filter(Boolean);

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href={productionHref.costings()}>All costing sheets</BackLink>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <RecordHeader
            eyebrow={`Costing ${c.number} · ${formatDay(c.createdOn)}`}
            title={c.title}
            badges={<DecisionBadge decision={c.decision} />}
          />
          <CostingHeaderActions screen={c} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <OrderCheckCard rows={c.card} />
          <StylesPanel screen={c} />
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel title="The order" id="costing-order-heading">
            <dl className="mt-4 grid grid-cols-2 gap-4">
              <Fact label="Buyer">
                {c.buyer ? (
                  <Link href={productionHref.buyer(c.buyer.id)} className={linkClass}>
                    {c.buyer.name}
                  </Link>
                ) : (
                  "Not picked"
                )}
              </Fact>
              <Fact label="Factory">
                {c.factory ? (
                  <Link href={productionHref.supplier(c.factory.id)} className={linkClass}>
                    {c.factory.name}
                  </Link>
                ) : (
                  "Not picked"
                )}
              </Fact>
              <Fact label="Profit % for this order">
                {c.profitPercent === null ? "Not set" : pct(c.profitPercent)}
              </Fact>
              <Fact label="How the buyer pays">
                {c.tradePayment ? TRADE_PAYMENT_LABELS[c.tradePayment] : "Not set"}
              </Fact>
              <Fact label="Currency">
                {c.currency}
                {c.exchangeRate !== null
                  ? ` (${c.companyCurrency} ${c.exchangeRate} for 1 ${c.currency})`
                  : ""}
              </Fact>
              <Fact label="Off the price">
                {percentLines.length > 0 ? percentLines.join(", ") : "Nothing"}
              </Fact>
              <Fact label="Ship date">{c.shipDate ? formatDay(c.shipDate) : "Not set"}</Fact>
              <Fact label="Fabric and making">
                {c.fabricDays ?? 30} + {c.makingDays ?? 25} days
              </Fact>
              {c.salesOrder && (
                <Fact label="Sales order">
                  <Link href={salesHref.order(c.salesOrder.id)} className={linkClass}>
                    {c.salesOrder.number}
                  </Link>
                </Fact>
              )}
              {c.batch && (
                <Fact label="Master batch">
                  <Link href={productionHref.batch(c.batch.id)} className={linkClass}>
                    {c.batch.code}
                  </Link>
                </Fact>
              )}
            </dl>
            {c.hints.profit.length > 0 && (
              <p className="mt-4 text-[0.8125rem] text-muted-foreground">
                Your profit % on this buyer&apos;s last sheets:{" "}
                {c.hints.profit
                  .map(
                    (h) =>
                      `${h.number} ${pct(h.profit)}${h.decision === "DECLINE" ? " (declined)" : ""}`,
                  )
                  .join(", ")}
                . Only a hint: set this order&apos;s own.
              </p>
            )}
            {c.notes && <p className="mt-4 text-sm break-words whitespace-pre-line">{c.notes}</p>}
          </Panel>
          <DecisionPanel screen={c} />
        </div>
      </div>
    </div>
  );
}
