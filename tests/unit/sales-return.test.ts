import { describe, expect, it } from "vitest";

import { estimateReturn } from "@/components/sales/return-estimate";
import {
  isSalesFiltered,
  returnListQuery,
  returnViewFrom,
  salesListSearch,
} from "@/components/sales/list-view";
import { AppError } from "@/lib/errors";
import {
  canReturnOnInvoice,
  canVoidInvoice,
  canVoidSalesReturn,
  statusAfterReturns,
} from "@/modules/sales/rules";
import { salesReturnSchema } from "@/modules/sales/schemas";
import { returnTotals } from "@/modules/sales/totals";

const fixed = (t: ReturnType<typeof returnTotals>) => ({
  amounts: t.amounts.map((a) => a.toFixed(2)),
  goods: t.goods.toFixed(2),
  discount: t.discount.toFixed(2),
  tax: t.tax.toFixed(2),
  total: t.total.toFixed(2),
});

/** An invoice of 10,800 (S 2 × 900, M 4 × 900, L 4 × 900, XL 2 × 900) less 1,000, plus 333.33 VAT. */
const invoice = { subtotal: 10800, discount: 1000, tax: 333.33 };
const line = (pieces: number) => ({ lineTotal: pieces * 900, quantity: pieces });

describe("sales return totals", () => {
  it("credits a share of the discount and VAT by the goods' value", () => {
    const t = returnTotals({
      lines: [
        { ...line(2), returnedQuantity: 0, returnedAmount: 0, take: 1 },
        { ...line(4), returnedQuantity: 0, returnedAmount: 0, take: 3 },
      ],
      invoice,
      earlier: { discount: 0, tax: 0 },
      last: false,
    });
    expect(fixed(t)).toEqual({
      amounts: ["900.00", "2700.00"],
      goods: "3600.00",
      discount: "333.33",
      tax: "111.11",
      total: "3377.78",
    });
  });

  it("gives the last return whatever is left, so the returns add up to the invoice", () => {
    const t = returnTotals({
      lines: [
        { ...line(2), returnedQuantity: 1, returnedAmount: 900, take: 1 },
        { ...line(4), returnedQuantity: 3, returnedAmount: 2700, take: 1 },
        { ...line(4), returnedQuantity: 0, returnedAmount: 0, take: 4 },
        { ...line(2), returnedQuantity: 0, returnedAmount: 0, take: 2 },
      ],
      invoice,
      earlier: { discount: 333.33, tax: 111.11 },
      last: true,
    });
    expect(fixed(t)).toEqual({
      amounts: ["900.00", "900.00", "3600.00", "1800.00"],
      goods: "7200.00",
      discount: "666.67",
      tax: "222.22",
      total: "6755.55",
    });
    expect(t.total.plus(3377.78).toFixed(2)).toBe("10133.33");
  });

  it("prices a line from what is left of it, so odd prices add up exactly", () => {
    // 3 pieces billed 1,000.00 together (333.33 + 333.33 + 333.34).
    const lines = [{ lineTotal: 1000, quantity: 3 }];
    const one = returnTotals({
      lines: [{ ...lines[0]!, returnedQuantity: 0, returnedAmount: 0, take: 1 }],
      invoice: { subtotal: 1000, discount: 0, tax: 0 },
      earlier: { discount: 0, tax: 0 },
      last: false,
    });
    const two = returnTotals({
      lines: [{ ...lines[0]!, returnedQuantity: 1, returnedAmount: one.goods, take: 1 }],
      invoice: { subtotal: 1000, discount: 0, tax: 0 },
      earlier: { discount: 0, tax: 0 },
      last: false,
    });
    const three = returnTotals({
      lines: [
        { ...lines[0]!, returnedQuantity: 2, returnedAmount: one.goods.plus(two.goods), take: 1 },
      ],
      invoice: { subtotal: 1000, discount: 0, tax: 0 },
      earlier: { discount: 0, tax: 0 },
      last: true,
    });
    expect([one, two, three].map((t) => t.total.toFixed(2))).toEqual([
      "333.33",
      "333.34",
      "333.33",
    ]);
  });

  it("refuses more pieces than are left on a line", () => {
    expect(() =>
      returnTotals({
        lines: [{ ...line(2), returnedQuantity: 1, returnedAmount: 900, take: 2 }],
        invoice,
        earlier: { discount: 0, tax: 0 },
        last: false,
      }),
    ).toThrow(AppError);
  });

  it("is estimated in the browser the way the server records it", () => {
    const form = {
      lines: [
        { id: "s", left: 2, leftValue: "1800.00" },
        { id: "m", left: 4, leftValue: "3600.00" },
        { id: "l", left: 4, leftValue: "3600.00" },
        { id: "xl", left: 2, leftValue: "1800.00" },
      ],
      shares: {
        subtotal: "10800.00",
        discount: "1000.00",
        tax: "333.33",
        earlierDiscount: "0.00",
        earlierTax: "0.00",
        ordered: 12,
        returned: 0,
      },
    } as unknown as Parameters<typeof estimateReturn>[0];
    expect(estimateReturn(form, { s: 1, m: 3 })).toEqual({
      amounts: { s: "900.00", m: "2700.00", l: "0.00", xl: "0.00" },
      pieces: 4,
      goods: "3600.00",
      discount: "333.33",
      tax: "111.11",
      total: "3377.78",
    });
    // Everything: the whole discount and VAT, the invoice less its delivery charge.
    expect(estimateReturn(form, { s: 2, m: 4, l: 4, xl: 2 })).toMatchObject({
      pieces: 12,
      discount: "1000.00",
      tax: "333.33",
      total: "10133.33",
    });
    expect(estimateReturn(form, {})).toMatchObject({ pieces: 0, total: "0.00" });
    // More than is left counts only what is left.
    expect(estimateReturn(form, { xl: 5 }).amounts.xl).toBe("1800.00");
  });
});

describe("sales return rules", () => {
  const live = { number: "INV-2026-00001", status: "UNPAID" as const, partyId: "buyer" };
  const open = { status: "DELIVERED" as const };

  it("takes goods back on a live invoice of a named buyer, up to what was delivered", () => {
    expect(canReturnOnInvoice(live, open, { delivered: 12, returned: 4 }).ok).toBe(true);
    expect(
      canReturnOnInvoice({ ...live, status: "VOID" }, open, { delivered: 12, returned: 0 }),
    ).toMatchObject({ ok: false, message: "Invoice INV-2026-00001 is void." });
    expect(
      canReturnOnInvoice(live, { status: "CANCELLED" }, { delivered: 12, returned: 0 }),
    ).toMatchObject({ ok: false, message: "Its order is cancelled." });
    expect(
      canReturnOnInvoice({ ...live, partyId: null }, open, { delivered: 1, returned: 0 }),
    ).toMatchObject({
      ok: false,
      message:
        "A walk-in sale has no buyer account to keep the credit on, so it takes no sales return.",
    });
    expect(canReturnOnInvoice(live, open, { delivered: 0, returned: 0 })).toMatchObject({
      ok: false,
      message: "Nothing on INV-2026-00001 has been delivered yet, so nothing can come back.",
    });
    expect(canReturnOnInvoice(live, open, { delivered: 12, returned: 12 })).toMatchObject({
      ok: false,
      message: "Every piece delivered on INV-2026-00001 has already come back.",
    });
  });

  it("keeps the invoice while a return stands, and voids a return once", () => {
    expect(canVoidInvoice({ status: "UNPAID" }).ok).toBe(true);
    expect(canVoidInvoice({ status: "UNPAID" }, 1)).toMatchObject({
      ok: false,
      message:
        "Goods on this invoice came back on a sales return. Void the return first to void the invoice.",
    });
    expect(canVoidSalesReturn({ number: "CN-2026-00001", voidedAt: null }).ok).toBe(true);
    expect(canVoidSalesReturn({ number: "CN-2026-00001", voidedAt: new Date() })).toMatchObject({
      ok: false,
      message: "CN-2026-00001 is already void.",
    });
  });

  it("names the order's state from its pieces", () => {
    expect(statusAfterReturns({ ordered: 12, delivered: 12, returned: 3 })).toBe(
      "PARTIALLY_RETURNED",
    );
    expect(statusAfterReturns({ ordered: 12, delivered: 12, returned: 12 })).toBe("RETURNED");
    expect(statusAfterReturns({ ordered: 12, delivered: 12, returned: 0 })).toBe("DELIVERED");
    expect(statusAfterReturns({ ordered: 12, delivered: 5, returned: 0 })).toBe("PROCESSING");
  });

  it("asks for whole pieces and a reason", () => {
    const ok = salesReturnSchema.safeParse({
      invoiceId: "inv",
      items: [{ orderItemId: "line", quantity: 2 }],
      reason: "Size problem",
    });
    expect(ok.success).toBe(true);
    for (const bad of [
      { items: [] },
      { items: [{ orderItemId: "line", quantity: 0 }] },
      { items: [{ orderItemId: "line", quantity: 1.5 }] },
      { reason: "no" },
      { returnDate: "11/10/2026" },
    ]) {
      const parsed = salesReturnSchema.safeParse({
        invoiceId: "inv",
        items: [{ orderItemId: "line", quantity: 2 }],
        reason: "Size problem",
        ...bad,
      });
      expect(parsed.success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("the Returns list's address", () => {
  it("keeps the search and the days, earliest first", () => {
    const view = returnViewFrom({ q: " CN-2026 ", from: "2026-10-31", to: "2026-10-01" });
    expect(view).toEqual({ list: "returns", q: "CN-2026", from: "2026-10-01", to: "2026-10-31" });
    expect(salesListSearch(view)).toBe("?q=CN-2026&from=2026-10-01&to=2026-10-31");
    expect(isSalesFiltered(view)).toBe(true);
    expect(isSalesFiltered(returnViewFrom({}))).toBe(false);
    expect(returnListQuery(view, "next")).toEqual({
      search: "CN-2026",
      from: "2026-10-01",
      to: "2026-10-31",
      cursor: "next",
      take: 30,
    });
  });
});
