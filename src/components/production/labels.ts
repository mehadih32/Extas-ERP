import type {
  BillStatus,
  ContractKind,
  CostAllocationMethod,
  ExpenseCategory,
  IntakeStatus,
  MaterialSplit,
  PaymentType,
  ProductionKind,
  ProductionStage,
  ProductionStatus,
  SupplierFaultKind,
  SupplierFaultStatus,
} from "@prisma/client";

import type { BatchState } from "@/modules/production/schemas";

import { money } from "@/components/sales/labels";
import { formatCount, groupDigits, usesLakhGrouping } from "@/lib/display";

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

/** How a master batch's goods are made or bought. */
export const BATCH_KIND_LABELS: Record<ProductionKind, string> = {
  CM: "Made at a factory (CM)",
  READYMADE: "Bought ready-made",
  DROPSHIP: "Dropshipping",
};

export const BATCH_KIND_HINTS: Record<ProductionKind, string> = {
  CM: "Our fabric and accessories, cut and made at a factory for a making charge.",
  READYMADE: "Finished goods bought in bulk, labels changed to ours.",
  DROPSHIP: "Sourced to order and sent straight on; nothing kept in our stock.",
};

export const BATCH_STATE_LABELS: Record<BatchState, string> = {
  EMPTY: "No styles yet",
  PLANNED: "Planned",
  ACTIVE: "In production",
  DONE: "Done",
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
/** "500", "12.5", "1,20,000.25": a quantity of up to 3 decimals, grouped like the company's money. */
export function plainQuantity(value: number, currency: string): string {
  const [whole = "0", fraction] = value
    .toFixed(3)
    .replace(/\.?0+$/, "")
    .split(".");
  return `${groupDigits(whole, usesLakhGrouping(currency))}${fraction ? `.${fraction}` : ""}`;
}

/** "500 kg Oxford fabric": a line of a material challan as one phrase. */
export function materialLine(
  item: { description: string; quantity: number; unit: string },
  currency: string,
): string {
  return `${plainQuantity(item.quantity, currency)} ${item.unit} ${item.description}`;
}

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
  batch: (id: string) => `/production/batches/${encodeURIComponent(id)}`,
  editBatch: (id: string) => `/production/batches/${encodeURIComponent(id)}/edit`,
  /** "Add a style" on a batch: a new project in it. */
  addStyle: (batchId: string) => `/production/projects/new?batch=${encodeURIComponent(batchId)}`,
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
  /** "Start production" on a sales order or a proforma: a new project filled in from it. */
  startFrom: (from: { orderId: string } | { proformaId: string }) =>
    "orderId" in from
      ? `/production/projects/new?order=${encodeURIComponent(from.orderId)}`
      : `/production/projects/new?proforma=${encodeURIComponent(from.proformaId)}`,
  /** "Order now" on low stock: a new in-house project for the style. */
  restock: (styleId: string) => `/production/projects/new?restock=${encodeURIComponent(styleId)}`,
  supplier: (id: string) => `/parties/suppliers/${encodeURIComponent(id)}`,
  buyer: (id: string) => `/parties/buyers/${encodeURIComponent(id)}`,
  file: (id: string) => `/api/files/${encodeURIComponent(id)}`,
  /** A style's materials per piece and tech pack notes. */
  materials: (projectId: string) =>
    `/production/projects/${encodeURIComponent(projectId)}/materials`,
  techPack: (projectId: string) =>
    `/api/production/projects/${encodeURIComponent(projectId)}/tech-pack`,
  /** Fabric and trims bookings (supplier POs and market purchases), and their PDF. */
  bookings: (filter: { batchId?: string } = {}) =>
    filter.batchId
      ? `/production/bookings?batch=${encodeURIComponent(filter.batchId)}`
      : "/production/bookings",
  booking: (id: string) => `/production/bookings/${encodeURIComponent(id)}`,
  newBooking: (batchId?: string) =>
    batchId
      ? `/production/bookings/new?batch=${encodeURIComponent(batchId)}`
      : "/production/bookings/new",
  editBooking: (id: string) => `/production/bookings/${encodeURIComponent(id)}/edit`,
  bookingPdf: (id: string) => `/api/production/bookings/${encodeURIComponent(id)}/pdf`,
  /** A batch's booking book: every booking of it in one PDF. */
  bookingBook: (batchId: string) =>
    `/api/production/batches/${encodeURIComponent(batchId)}/booking-book`,
  /** "Make purchase orders" for a batch's materials. */
  batchOrders: (batchId: string) => `/production/batches/${encodeURIComponent(batchId)}/orders/new`,
  /** A batch's fabric, accessories or factory (CM) agreement, and its PDF. */
  contract: (batchId: string, contractId: string) =>
    `/production/batches/${encodeURIComponent(batchId)}/contracts/${encodeURIComponent(contractId)}`,
  contractPdf: (contractId: string) =>
    `/api/production/contracts/${encodeURIComponent(contractId)}/pdf`,
  /** The batch's central receive: a delivery on one of its orders, Challan vs Actual. */
  receive: (batchId: string, orderId?: string) =>
    `/production/batches/${encodeURIComponent(batchId)}/receive${
      orderId ? `?order=${encodeURIComponent(orderId)}` : ""
    }`,
  /** Issuing the batch's materials from the store to its styles, colour by colour. */
  issue: (batchId: string) => `/production/batches/${encodeURIComponent(batchId)}/issue`,
  /** The supplier fault log, for one batch or supplier when given. */
  faults: (filter: { batchId?: string; supplierId?: string; status?: string } = {}) => {
    const query = new URLSearchParams(
      Object.entries(filter).filter((e): e is [string, string] => Boolean(e[1])),
    ).toString();
    return `/production/faults${query ? `?${query}` : ""}`;
  },
  reportCard: (supplierId: string) =>
    `/api/production/suppliers/${encodeURIComponent(supplierId)}/report-card`,
  /** A style's cutting, embroidery and print, and its cutting and sewing dates. */
  cutting: (projectId: string) => `/production/projects/${encodeURIComponent(projectId)}/cutting`,
  newCutting: (projectId: string) =>
    `/production/projects/${encodeURIComponent(projectId)}/cutting/new`,
  /** A style's finishing and QC (A, B, C, rejects, missing) and its full packing list. */
  finishing: (projectId: string) =>
    `/production/projects/${encodeURIComponent(projectId)}/finishing`,
  newFinishing: (projectId: string) =>
    `/production/projects/${encodeURIComponent(projectId)}/finishing/new`,
  /** The Employee Action Log of a style, or of a master batch and all its styles. */
  projectLog: (projectId: string) => `/production/projects/${encodeURIComponent(projectId)}/log`,
  batchLog: (batchId: string) => `/production/batches/${encodeURIComponent(batchId)}/log`,
  /** A batch's whole money story on one page (cost, cost a piece, penalties, stock), and its PDF. */
  batchSummary: (batchId: string) => `/production/batches/${encodeURIComponent(batchId)}/summary`,
  batchSummaryPdf: (batchId: string) =>
    `/api/production/batches/${encodeURIComponent(batchId)}/summary/pdf`,
  /** A batch's final CM settlement with its factory, and its PDF bill. */
  cmSettlement: (batchId: string) =>
    `/production/batches/${encodeURIComponent(batchId)}/cm-settlement`,
  cmSettlementPdf: (settlementId: string) =>
    `/api/production/cm-settlements/${encodeURIComponent(settlementId)}/pdf`,
};

/** What a supplier fault is for. */
export const FAULT_KIND_LABELS: Record<SupplierFaultKind, string> = {
  SHORT_RECEIVE: "Short at receive",
  FABRIC_FAULT: "Fabric fault",
  QUALITY: "Quality fault",
  MISSING_PIECES: "Missing pieces",
  OTHER: "Other",
  SPOILED_PIECES: "Spoiled at embroidery or print",
};

export const FAULT_STATUS_LABELS: Record<SupplierFaultStatus, string> = {
  OPEN: "Open",
  DEDUCTED: "Deducted",
  WAIVED: "Waived",
};

/** What a batch contract is for, short (the full titles are in contract-terms.ts). */
export const CONTRACT_KIND_LABELS: Record<ContractKind, string> = {
  FABRIC: "Fabric",
  ACCESSORIES: "Accessories",
  FACTORY_CM: "Factory (CM)",
};

/** How a material per piece is ordered. */
export const SPLIT_LABELS: Record<MaterialSplit, string> = {
  TOTAL: "One total",
  COLOUR: "By colour",
  COLOUR_SIZE: "By colour and size",
};

export const SPLIT_HINTS: Record<MaterialSplit, string> = {
  TOTAL: "Buttons, labels, thread: one quantity for all the pieces.",
  COLOUR: "Body fabric: a quantity for each garment colour.",
  COLOUR_SIZE: "Collars and cuffs: knitted for each colour and size.",
};

/** Where a material often goes, offered while typing. */
export const PLACEMENT_SUGGESTIONS = [
  "Main body",
  "Collar",
  "Cuff",
  "Rib",
  "Placket",
  "Main label",
  "Size label",
  "Care label",
  "Hang tag",
  "Button",
  "Zipper",
  "Sewing thread",
  "Poly bag",
  "Carton",
];

/**
 * What a piece costs once a project's pieces are evened out: "BDT 103.09 a
 * piece", or with B-grade valued lower "A-grade BDT 110.00, B-grade BDT 55.00 a
 * piece".
 */
export function evenCostText(
  perPiece: { a: string | null; b: string | null },
  currency: string,
): string {
  const { a, b } = perPiece;
  if (a && b && a !== b) {
    return `A-grade ${money(a, currency)}, B-grade ${money(b, currency)} a piece`;
  }
  const one = a ?? b;
  return one ? `${money(one, currency)} a piece` : "";
}

/**
 * What completing a project means for its pieces: those short of the target are
 * wastage, and (for people who see costs) the one cost every piece received
 * then carries.
 */
export function completionNote(
  completion: {
    short: number;
    perPiece: { a: string | null; b: string | null } | null;
  },
  currency: string,
): string {
  const short =
    completion.short > 0
      ? `The ${formatCount(completion.short, currency)} pieces short are listed as wastage, with no loss booked.`
      : "";
  const cost = completion.perPiece ? evenCostText(completion.perPiece, currency) : "";
  return [short, cost ? `Every piece received then costs the same: ${cost}.` : ""]
    .filter(Boolean)
    .join(" ");
}
