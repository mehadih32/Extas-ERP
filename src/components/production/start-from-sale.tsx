"use client";

import { useRouter } from "next/navigation";

import { ORDER_STATUS_LABELS, PROFORMA_STATUS_LABELS } from "@/components/sales/labels";
import { SearchList } from "@/components/sales/pickers";
import type { SaleToStart } from "@/modules/production/screens.service";
import { findSalesToStartAction } from "@/server/actions/production.actions";

import { pieces, productionHref } from "./labels";

/**
 * "Start from a sale" on a new project: find an open sales order or proforma by its number or
 * buyer, and the form opens filled in from it. Production Managers start projects but do not
 * open Sales, so this is their way to what "Start production" does on an order's page.
 */
export function StartFromSale({ currency }: { currency: string }) {
  const router = useRouter();
  return (
    <section
      aria-labelledby="start-from-sale-heading"
      className="grid min-w-0 gap-3 rounded-lg border bg-card p-4 sm:p-5"
    >
      <div>
        <h3 id="start-from-sale-heading" className="font-medium">
          Making a sales order or a proforma?
        </h3>
        <p className="text-[0.8125rem] text-muted-foreground">
          Find it, and the form fills in its buyer, style and pieces per colour and size.
        </p>
      </div>
      <SearchList<SaleToStart>
        id="from-sale"
        label="Find a sales order or proforma"
        placeholder="Order or PI number, or buyer"
        search={async (text) => {
          try {
            const result = await findSalesToStartAction({ search: text });
            return result.ok ? result.data : result.error.message;
          } catch {
            return "The search could not run. Try again.";
          }
        }}
        onPick={(sale) =>
          router.push(
            productionHref.startFrom(
              sale.kind === "ORDER" ? { orderId: sale.id } : { proformaId: sale.id },
            ),
          )
        }
        renderOption={(sale) => (
          <span className="grid gap-0.5">
            <span className="truncate text-sm font-medium">
              {sale.number} · {sale.buyer}
            </span>
            <span className="truncate text-[0.8125rem] text-muted-foreground">
              {[
                sale.kind === "ORDER" ? "Sales order" : "Proforma",
                sale.orderStatus
                  ? ORDER_STATUS_LABELS[sale.orderStatus]
                  : PROFORMA_STATUS_LABELS[sale.proformaStatus!],
                pieces(sale.pieces, currency),
              ].join(" · ")}
            </span>
          </span>
        )}
      />
    </section>
  );
}
