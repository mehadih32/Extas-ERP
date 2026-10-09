import type {
  BillStatus,
  CostAllocationMethod,
  ExpenseCategory,
  IntakeStatus,
  PaymentType,
  ProductionStage,
  ProductionStatus,
} from "@prisma/client";

import { formatCount } from "@/lib/display";

/*
 * Words and figures for the Production screens: plain strings in, plain strings
 * out, so the browser and the tests share them.
 */

export const STAGE_LABELS: Record<ProductionStage, string> = {
  FABRIC_SOURCING: "Fabric sourcing",
  CUTTING: "Cutting",
  SEWING: "Sewing",
  WASH_QC: "Wash and QC",
  FINISHING: "Finishing",
  COMPLETED: "Completed",
};

export const PROJECT_STATUS_LABELS: Record<ProductionStatus, string> = {
  PLANNED: "Planned",
  ACTIVE: "In production",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const DELIVERY_STATUS_LABELS: Record<IntakeStatus, string> = {
  DRAFT: "Draft",
  PARSED: "Draft",
  CONFIRMED: "In stock",
  CANCELLED: "Cancelled",
  REVERSED: "Undone",
};

export const BILL_STATUS_LABELS: Record<BillStatus, string> = {
  UNPAID: "Unpaid",
  PARTIALLY_PAID: "Part paid",
  PAID: "Paid",
  VOID: "Void",
};

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  DUE: "Due to the supplier",
  CASH_BANK: "Paid now",
};

export const PAYMENT_TYPE_HINTS: Record<PaymentType, string> = {
  DUE: "It goes on the supplier's account; Accounts pays it later.",
  CASH_BANK: "Paid straight away from cash, a bank or a wallet.",
};

export const COST_HEAD_CATEGORY_LABELS: Partial<Record<ExpenseCategory, string>> = {
  PRODUCTION: "Making cost",
  RAW_MATERIAL: "Material",
};

export const COSTING_LABELS: Record<CostAllocationMethod, string> = {
  EQUAL_PER_PIECE: "Same cost for every piece",
  B_GRADE_RATIO: "B-grade pieces cost less",
  MANUAL: "Type the cost per piece",
};

export const COSTING_HINTS: Record<CostAllocationMethod, string> = {
  EQUAL_PER_PIECE: "The delivery's share of the project's cost is split evenly over its pieces.",
  B_GRADE_RATIO: "A B-grade piece carries a part of an A-grade piece's cost, say 50%.",
  MANUAL: "You enter what an A-grade and a B-grade piece cost.",
};

/** "1,200 pcs" in the company's digit grouping. */
export function pieces(count: number, currency: string): string {
  return `${formatCount(count, currency)} pcs`;
}

/** "12 days", "1 day". */
export function days(count: number): string {
  return `${count} ${count === 1 ? "day" : "days"}`;
}

/** What the timeline says about the target day: "12 days left", "3 days late", "Due today". */
export function remainingText(timeline: {
  remainingDays: number | null;
  overdueDays: number;
  isOverdue: boolean;
}): string | null {
  if (timeline.remainingDays === null) return null;
  if (timeline.isOverdue) return `${days(timeline.overdueDays)} late`;
  if (timeline.remainingDays === 0) return "Due today";
  return `${days(timeline.remainingDays)} left`;
}

export const productionHref = {
  project: (id: string) => `/production/projects/${encodeURIComponent(id)}`,
  delivery: (id: string) => `/production/deliveries/${encodeURIComponent(id)}`,
  bill: (id: string) => `/production/bills/${encodeURIComponent(id)}`,
  newDelivery: (projectId?: string) =>
    projectId
      ? `/production/deliveries/new?project=${encodeURIComponent(projectId)}`
      : "/production/deliveries/new",
  newBill: (projectId?: string) =>
    projectId
      ? `/production/bills/new?project=${encodeURIComponent(projectId)}`
      : "/production/bills/new",
  supplier: (id: string) => `/parties/suppliers/${encodeURIComponent(id)}`,
  buyer: (id: string) => `/parties/buyers/${encodeURIComponent(id)}`,
  file: (id: string) => `/api/files/${encodeURIComponent(id)}`,
};
