import { type BillStatus, Prisma, type PurchaseOrderStatus } from "@prisma/client";

import { ALLOWED, refuse, type Verdict } from "@/lib/verdict";
import type { PermissionKey } from "@/modules/rbac/permissions";

/*
 * What may be done with a raw material, a purchase order, a purchase (the
 * supplier's bill) or a return to a supplier from where it stands, and who may
 * do it. The materials services refuse with these answers and the Raw
 * materials screens read the same answers to decide what to offer.
 */

type Can = { can: (permission: PermissionKey) => boolean };
type Amount = Prisma.Decimal | string | number;
const dec = (v: Amount) => new Prisma.Decimal(v);

/** Orders goods can still arrive on, and that can still change. */
export const OPEN_ORDER_STATUSES: readonly PurchaseOrderStatus[] = ["OPEN", "PARTIALLY_RECEIVED"];
const isOpen = (status: PurchaseOrderStatus) => OPEN_ORDER_STATUSES.includes(status);

const ORDER_STATUS: Record<PurchaseOrderStatus, string> = {
  OPEN: "open",
  PARTIALLY_RECEIVED: "partly received",
  RECEIVED: "received in full",
  CLOSED: "closed",
  CANCELLED: "cancelled",
};

/**
 * The raw material keys a person holds, and what they add up to:
 *   view       stock, stock cards, purchase orders and issue notes (quantities)
 *   keepStore  materials.manage: counts, wastage, moving stock, issuing to
 *              production and taking back what comes back
 *   buy        materials.purchase: purchase orders, Due bills, returns
 *   seeCosts   prices and values: buyers, Production Managers and Accounts
 *   pay        accounts.payments.record: a purchase paid now, paying a bill
 */
export function materialsKeys(ctx: Can) {
  const buy = ctx.can("materials.purchase");
  const keepStore = ctx.can("materials.manage");
  const pay = ctx.can("accounts.payments.record");
  const accountsManage = ctx.can("accounts.manage");
  return {
    view: ctx.can("materials.view"),
    keepStore,
    buy,
    pay,
    seeCosts:
      buy || ctx.can("production.manage") || ctx.can("accounts.view") || accountsManage || pay,
    /** Add materials and change their details. */
    catalogue: keepStore || buy,
    /** Record a supplier's bill as the goods arrive (Due; paid now needs pay). */
    receive: buy || pay,
    /** Void a purchase, send goods back to a supplier, void such a return. */
    undo: buy || accountsManage,
    /** Opening stock brings a value into the books. */
    openingStock: buy || accountsManage,
  };
}

// --- Materials -------------------------------------------------------------------------

type MaterialState = {
  code: string;
  isActive: boolean;
  quantity: Amount;
  /** "120.5 m", for messages. */
  onHand: string;
};

/**
 * A material is archived once none is left and nothing is still due on an open
 * purchase order (`onOrder`: how many open orders still wait for it).
 */
export function canArchiveMaterial(m: MaterialState, onOrder: number): Verdict {
  if (!m.isActive) return refuse("CONFLICT", `${m.code} is already archived.`);
  if (dec(m.quantity).gt(0)) {
    return refuse(
      "CONFLICT",
      `${m.code} still has ${m.onHand} in stock; use it up, count it or record it as wastage before archiving.`,
    );
  }
  if (onOrder > 0) {
    return refuse(
      "CONFLICT",
      `${m.code} is still due on an open purchase order; receive, close or cancel it before archiving.`,
    );
  }
  return ALLOWED;
}

export function canReactivateMaterial(m: { code: string; isActive: boolean }): Verdict {
  if (m.isActive) return refuse("CONFLICT", `${m.code} is already in use.`);
  return ALLOWED;
}

/** Stock only comes in (opening stock, a purchase) for a material in use. */
export function canStockIn(m: { code: string; name: string; isActive: boolean }): Verdict {
  if (!m.isActive) return refuse("CONFLICT", `${m.code} ${m.name} is archived.`);
  return ALLOWED;
}

/**
 * The unit is fixed once the material has stock, orders or bills in it
 * (`uses`: how many stock card lines, order lines and bill lines name it).
 */
export function canChangeUnit(m: { code: string; unitLabel: string }, uses: number): Verdict {
  if (uses > 0) {
    return refuse(
      "CONFLICT",
      `${m.code} already has stock or orders in ${m.unitLabel}, so its unit can no longer change. Add a new material instead.`,
    );
  }
  return ALLOWED;
}

// --- Purchase orders -------------------------------------------------------------------

type OrderState = {
  number: string;
  status: PurchaseOrderStatus;
  /** Whether any of its goods have arrived. */
  received: boolean;
};

/** An order's dates, references and project change while it is open. */
export function canChangeOrder(order: OrderState): Verdict {
  if (!isOpen(order.status)) {
    return refuse(
      "CONFLICT",
      `${order.number} is ${ORDER_STATUS[order.status]}; it can no longer change.`,
    );
  }
  return ALLOWED;
}

/** Its lines change only while nothing has arrived on it. */
export function canChangeOrderLines(order: OrderState): Verdict {
  const open = canChangeOrder(order);
  if (!open.ok) return open;
  if (order.status !== "OPEN" || order.received) {
    return refuse(
      "CONFLICT",
      `Goods have already arrived on ${order.number}, so its lines can no longer change. Close it and order the rest again.`,
    );
  }
  return ALLOWED;
}

/** An order nothing has arrived on is cancelled (the supplier will not deliver). */
export function canCancelOrder(order: OrderState): Verdict {
  if (order.status === "OPEN" && !order.received) return ALLOWED;
  return refuse(
    "CONFLICT",
    isOpen(order.status) || order.status === "RECEIVED"
      ? `Goods have already arrived on ${order.number}; close it instead of cancelling it.`
      : `${order.number} is already ${ORDER_STATUS[order.status]}.`,
  );
}

/** A partly received order is closed when the rest will not come. */
export function canCloseOrder(order: OrderState): Verdict {
  if (order.status === "PARTIALLY_RECEIVED") return ALLOWED;
  return refuse(
    "CONFLICT",
    order.status === "OPEN"
      ? `Nothing has arrived on ${order.number} yet; cancel it instead.`
      : `${order.number} is already ${ORDER_STATUS[order.status]}.`,
  );
}

/** Goods arrive on an order while it is open or partly received. */
export function canReceiveOnOrder(order: OrderState): Verdict {
  if (isOpen(order.status)) return ALLOWED;
  return refuse(
    "CONFLICT",
    `${order.number} is ${ORDER_STATUS[order.status]}; goods can no longer arrive on it.`,
  );
}

// --- Purchases (supplier bills) and returns ----------------------------------------------

type PurchaseState = {
  number: string;
  status: BillStatus;
  /** Returns to the supplier from this bill that are not void. */
  activeReturns: string[];
  /** The store the goods went into, null when it no longer exists. */
  warehouseId: string | null;
};

/**
 * A purchase entered by mistake is voided: its goods leave the store again, so
 * any return from it has to be voided first.
 */
export function canVoidPurchase(bill: PurchaseState): Verdict {
  if (bill.status === "VOID") return refuse("CONFLICT", `${bill.number} is already void.`);
  if (bill.activeReturns.length > 0) {
    return refuse(
      "CONFLICT",
      `Goods from ${bill.number} went back to the supplier on ${bill.activeReturns.join(
        ", ",
      )}; void ${bill.activeReturns.length > 1 ? "those returns" : "that return"} first.`,
    );
  }
  if (!bill.warehouseId) {
    return refuse("CONFLICT", `The store ${bill.number} received into no longer exists.`);
  }
  return ALLOWED;
}

/** Goods go back to the supplier from a bill that is not void, while some are left on it. */
export function canReturnToSupplier(bill: {
  number: string;
  status: BillStatus;
  /** What can still go back, summed over its lines. */
  returnable: Amount;
}): Verdict {
  if (bill.status === "VOID") return refuse("CONFLICT", `${bill.number} is void.`);
  if (!dec(bill.returnable).gt(0)) {
    return refuse("CONFLICT", `Everything on ${bill.number} has already gone back.`);
  }
  return ALLOWED;
}

export function canVoidSupplierReturn(ret: { number: string; isVoid: boolean }): Verdict {
  if (ret.isVoid) return refuse("CONFLICT", `${ret.number} is already void.`);
  return ALLOWED;
}
