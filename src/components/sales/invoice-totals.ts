import type { InvoiceScreen } from "@/modules/sales/screens.service";

import type { TotalLine } from "./detail-bits";

/** An invoice's totals as shown on screen: with the buyer's previous due when it carries it. */
export function invoiceTotalLines(inv: InvoiceScreen["invoice"]): TotalLine[] {
  return [
    { label: "Subtotal", amount: inv.subtotal },
    { label: "Discount", amount: inv.discount, minus: true, optional: true },
    { label: "Delivery charge", amount: inv.shippingCharge, optional: true },
    { label: "Tax / VAT", amount: inv.tax, optional: true },
    { label: "Total", amount: inv.total, strong: true },
    ...(inv.previous
      ? [
          { label: "Previous due", amount: inv.previous.previousDue },
          { label: "Total payable", amount: inv.previous.totalPayable, strong: true },
          { label: "Paid", amount: inv.previous.paid, tone: "muted" as const },
          {
            label: "Balance due",
            amount: inv.previous.balanceDue,
            strong: true,
            tone: "due" as const,
          },
        ]
      : [
          { label: "Paid", amount: inv.paid, tone: "muted" as const },
          { label: "Due", amount: inv.due, strong: true, tone: "due" as const },
        ]),
  ];
}
