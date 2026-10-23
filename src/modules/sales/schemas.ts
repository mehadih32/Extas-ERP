import {
  ChequeStatus,
  CustomFieldEntity,
  CustomFieldType,
  InvoiceStatus,
  PaymentMethod,
  RefundKind,
  SalesChannel,
  SalesOrderStatus,
  QuotationStatus,
  ProformaStatus,
} from "@prisma/client";
import { z } from "zod";

const id = z.string().min(1);
const money = z.number().min(0).max(1_000_000_000).multipleOf(0.01);
const positiveMoney = money.refine((v) => v > 0, "Must be more than zero");
const qty = z.number().int().min(1).max(1_000_000);
const optionalText = (max: number) => z.string().trim().max(max).nullish();
const take = z.coerce.number().int().min(1).max(200).optional();
/** A calendar day ("2026-02-28", whole day in company time) or an exact timestamp. */
const dayOrInstant = z.union([z.date(), z.iso.date(), z.iso.datetime({ offset: true })]);
/** The day the goods are due to leave for the buyer ("2026-11-20"); shipment reminders follow it. */
const shipmentDate = z.iso.date().nullish();

// --- Custom fields ---------------------------------------------------------------
export const customFieldDefinitionSchema = z
  .object({
    entity: z.enum(CustomFieldEntity),
    key: z
      .string()
      .trim()
      .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/, "Use letters, numbers and _ (start with a letter)"),
    label: z.string().trim().min(1).max(80),
    fieldType: z.enum(CustomFieldType),
    options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    isRequired: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.fieldType === "SELECT" && !v.options?.length) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Add at least one option" });
    }
  });
export const updateCustomFieldSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  isRequired: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
});
const customFieldValues = z.record(z.string(), z.unknown()).nullish();

// --- Quotations ------------------------------------------------------------------
const quotationItemSchema = z
  .object({
    categoryId: id.nullish(),
    styleId: id.nullish(),
    description: z.string().trim().min(1).max(500),
    fabric: optionalText(200),
    colorNote: optionalText(200),
    /** Fabric weight in grams per square metre. */
    gsm: z.number().int().min(10).max(2000).nullish(),
    /** Free text, e.g. "1:2:2:1" for S:M:L:XL. */
    sizeRatio: optionalText(100),
    accessories: optionalText(1000),
    /** A reference picture uploaded through POST /api/sales/reference-images. */
    imageId: id.nullish(),
    /** Pieces per size, e.g. { "S": 20, "M": 40, "L": 40 }. */
    sizeBreakdown: z.record(z.string().trim().min(1).max(20), z.number().int().min(0)).nullish(),
    quantity: qty.optional(),
    unitPrice: money,
  })
  .superRefine((v, ctx) => {
    const fromSizes = v.sizeBreakdown
      ? Object.values(v.sizeBreakdown).reduce((a, b) => a + b, 0)
      : undefined;
    if (v.quantity === undefined && !fromSizes) {
      ctx.addIssue({ code: "custom", path: ["quantity"], message: "Enter a quantity or sizes" });
    }
    if (v.quantity !== undefined && fromSizes !== undefined && v.quantity !== fromSizes) {
      ctx.addIssue({
        code: "custom",
        path: ["quantity"],
        message: `Quantity ${v.quantity} does not match the size breakdown (${fromSizes})`,
      });
    }
  });

const stylingRuleSchema = z.object({
  area: optionalText(80),
  instruction: z.string().trim().min(2).max(1000),
});

const quotationFields = {
  partyId: id,
  issueDate: z.coerce.date().optional(),
  validUntil: z.coerce.date().nullish(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  items: z.array(quotationItemSchema).min(1).max(200),
  stylingRules: z.array(stylingRuleSchema).max(100).optional(),
  discount: money.optional(),
  tax: money.optional(),
  terms: optionalText(4000),
  notes: optionalText(4000),
  customFields: customFieldValues,
  templateId: id.nullish(),
};
export const createQuotationSchema = z.object(quotationFields);
export const updateQuotationSchema = z.object(quotationFields).partial();
export const quotationStatusSchema = z.object({
  status: z.enum(["SENT", "ACCEPTED", "REJECTED"]),
});
export const listQuotationsSchema = z.object({
  status: z.enum(QuotationStatus).optional(),
  partyId: id.optional(),
  search: z.string().trim().max(100).optional(),
  from: dayOrInstant.optional(),
  to: dayOrInstant.optional(),
  cursor: z.string().optional(),
  take,
});

// --- Proforma invoices -------------------------------------------------------------
const proformaDetails = {
  /** The buyer's purchase order number, printed on the PI. */
  buyerPoNumber: optionalText(80),
  /** The last day of the PI's offer ("2026-11-20"). */
  validUntil: z.iso.date().nullish(),
  /** One of the company's bank accounts, printed as the bank details. */
  bankAccountId: id.nullish(),
};
export const convertToProformaSchema = z.object({
  /** Defaults to the company's advance percentage (30%). */
  advancePercent: z.number().min(0).max(100).optional(),
  issueDate: z.coerce.date().optional(),
  ...proformaDetails,
});
export const updateProformaSchema = z.object(proformaDetails).partial();
export const listProformasSchema = z.object({
  status: z.enum(ProformaStatus).optional(),
  partyId: id.optional(),
  cursor: z.string().optional(),
  take,
});

// --- Orders --------------------------------------------------------------------------
const orderLineSchema = z.object({
  variantId: id,
  quantity: qty,
  /** Defaults to the SKU's wholesale or retail price for the channel. */
  unitPrice: money.optional(),
  /** Discount amount for the whole line. */
  discount: money.optional(),
});

/** Matrix entry: one style, quantities per SKU (color x size cell). */
const matrixEntrySchema = z.object({
  styleId: id,
  unitPrice: money.optional(),
  quantities: z.record(id, z.number().int().min(0).max(1_000_000)),
});

/** The cheque's own details: its number, the bank it is drawn on and the day written on it. */
const chequeDetails = {
  chequeNo: z.string().trim().min(1).max(40),
  bankName: optionalText(120),
  /** Defaults to the day it is received. */
  chequeDate: z.iso.date().optional(),
};

const checkoutPaymentSchema = z.object({
  amount: positiveMoney,
  method: z.enum(PaymentMethod),
  accountId: id.optional(),
  reference: optionalText(120),
  /** A cheque (method CHEQUE): kept as pending; it reaches the bank when marked cleared. */
  cheque: z.object(chequeDetails).optional(),
  /** A photo of the proof, uploaded first (uploadPaymentProofAction). */
  proofFileId: id.optional(),
});

const orderLines = {
  lines: z.array(orderLineSchema).max(500).optional(),
  matrix: z.array(matrixEntrySchema).max(100).optional(),
};

/** How the goods go out: cartons and the employee who packed them (both optional). */
const orderLogistics = {
  totalCartons: z.number().int().min(0).max(100_000).nullish(),
  packedById: id.nullish(),
};

const orderCharges = {
  ...orderLogistics,
  discount: money.optional(),
  shippingCharge: money.optional(),
  tax: money.optional(),
  notes: optionalText(4000),
  customerName: optionalText(120),
  customerPhone: optionalText(30),
  shippingAddress: optionalText(500),
  /** Sell beyond available stock (needs the Force Override permission). */
  forceOverride: z.object({ reason: z.string().trim().min(5).max(500) }).optional(),
};

export const createOrderSchema = z
  .object({
    channel: z.enum(SalesChannel),
    partyId: id.nullish(),
    warehouseId: id.optional(),
    orderDate: z.coerce.date().optional(),
    shipmentDate,
    ...orderLines,
    ...orderCharges,
    /**
     * Money taken at checkout (e.g. cash at the counter). With the invoice issued
     * and a named buyer it may be more than the order: the extra pays the buyer's
     * older dues oldest first when includePreviousDue is set, and the rest is kept
     * as their advance balance.
     */
    payment: checkoutPaymentSchema.optional(),
    /** Prints what the buyer already owed on the invoice ("Total payable"); never revenue. */
    includePreviousDue: z.boolean().optional(),
    /** The buyer's credit (advance balance) to put against this order's invoice. */
    useCredit: positiveMoney.optional(),
    /** Documents to create right away (blueprint "checkout" checkboxes). */
    documents: z
      .object({
        invoice: z.boolean().optional(),
        packingList: z.boolean().optional(),
        deliveryChallan: z.boolean().optional(),
      })
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.lines?.length && !v.matrix?.length) {
      ctx.addIssue({ code: "custom", path: ["lines"], message: "Add at least one item" });
    }
    if ((v.channel === "WHOLESALE" || v.channel === "B2B_PREORDER") && !v.partyId) {
      ctx.addIssue({ code: "custom", path: ["partyId"], message: "Choose the buyer" });
    }
    if (v.payment?.cheque && v.payment.method !== "CHEQUE") {
      ctx.addIssue({ code: "custom", path: ["payment", "method"], message: "Choose Cheque" });
    }
    if ((v.includePreviousDue || v.useCredit) && !v.partyId) {
      ctx.addIssue({
        code: "custom",
        path: [v.useCredit ? "useCredit" : "includePreviousDue"],
        message: "Only a buyer with an account has dues and credit",
      });
    }
  });

export const updateOrderSchema = z
  .object({
    ...orderLines,
    ...orderCharges,
    /**
     * Smart Edit: the order has a live invoice that is not fully paid, and the
     * edit revises it under the same number (needs the invoice edit key).
     */
    reviseInvoice: z.boolean(),
  })
  .partial();

export const convertProformaToOrderSchema = z
  .object({
    warehouseId: id.optional(),
    orderDate: z.coerce.date().optional(),
    shipmentDate,
    ...orderLines,
    ...orderCharges,
  })
  .superRefine((v, ctx) => {
    if (!v.lines?.length && !v.matrix?.length) {
      ctx.addIssue({ code: "custom", path: ["lines"], message: "Add at least one item" });
    }
  });

/**
 * How money held for a buyer is settled when it is taken off an order, a proforma
 * or their account (Accounts):
 *   CASH     paid back from cash, bank or a wallet (`method`; `accountId` defaults by method)
 *   CREDIT   kept as credit on the buyer's account for later orders (not for walk-in customers)
 *   FORFEIT  kept by the company as a cancellation charge (other income)
 */
const settlement = {
  kind: z.enum(RefundKind),
  method: z.enum(PaymentMethod).optional(),
  accountId: id.optional(),
  refundDate: z.coerce.date().optional(),
  reference: optionalText(120),
  notes: optionalText(1000),
};

type Settlement = { kind: RefundKind; method?: PaymentMethod; accountId?: string };

function checkSettlement(v: Settlement, ctx: z.RefinementCtx) {
  if (v.kind === "CASH" && !v.method) {
    ctx.addIssue({ code: "custom", path: ["method"], message: "Say how the money was paid back" });
  }
  if (v.kind !== "CASH" && (v.method || v.accountId)) {
    ctx.addIssue({
      code: "custom",
      path: ["method"],
      message: "Only money paid back comes out of an account",
    });
  }
}

/** Settles all the money still held on an order or proforma that is being cancelled. */
export const settleSchema = z.object(settlement).superRefine(checkSettlement);

export const cancelOrderSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  /**
   * How to settle money still held on it (Accounts' money keys needed). Without it,
   * an order or proforma holding money is not cancelled: Accounts settles it first.
   */
  settle: settleSchema.optional(),
  /**
   * Safe Void: pieces already delivered come back into good stock at the cost
   * they left at (needs the invoice edit key). Without it an order with
   * delivered goods is not cancelled.
   */
  returnDelivered: z.boolean().optional(),
});

/** Sets or (null) clears an order's cartons and packer after it was taken. */
export const orderLogisticsSchema = z.object(orderLogistics);

/** Whether a buyer can take this much more on credit (checked before an order is placed). */
export const creditCheckSchema = z.object({ partyId: id, amount: money });

/** Sets, moves or (null) clears the day an open order is due to ship. */
export const orderShipmentSchema = z.object({ shipmentDate: z.iso.date().nullable() });

export const listOrdersSchema = z.object({
  status: z.enum(SalesOrderStatus).optional(),
  channel: z.enum(SalesChannel).optional(),
  partyId: id.optional(),
  search: z.string().trim().max(100).optional(),
  from: dayOrInstant.optional(),
  to: dayOrInstant.optional(),
  cursor: z.string().optional(),
  take,
});

// --- Documents ----------------------------------------------------------------------
export const issueInvoiceSchema = z.object({
  issueDate: z.coerce.date().optional(),
  /** Defaults to the buyer's payment terms. */
  dueDate: z.coerce.date().nullish(),
  /** Prints what the buyer already owed on it ("Previous due", "Total payable"). */
  includePreviousDue: z.boolean().optional(),
});
export const voidInvoiceSchema = z.object({
  reason: z.string().trim().min(5).max(500),
  /**
   * Safe Void: cancel the order too, so its reserved stock is freed, delivered
   * pieces come back into stock and money held is settled (`settle`). Without
   * it the order stays open to be corrected and invoiced again.
   */
  cancelOrder: z.boolean().optional(),
  settle: settleSchema.optional(),
});
export const listInvoicesSchema = z.object({
  status: z.enum(InvoiceStatus).optional(),
  /** Unpaid or part-paid invoices past their due day. */
  overdue: z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .transform((v) => v === true || v === "true" || v === "1")
    .optional(),
  partyId: id.optional(),
  /** Invoice or order number, buyer or customer name. */
  search: z.string().trim().max(100).optional(),
  from: dayOrInstant.optional(),
  to: dayOrInstant.optional(),
  cursor: z.string().optional(),
  take,
});

const docItemSchema = z.object({ variantId: id, quantity: qty });

export const packingListSchema = z.object({
  cartons: z.number().int().min(0).max(100_000).nullish(),
  grossWeightKg: z.number().min(0).max(1_000_000).nullish(),
  notes: optionalText(2000),
  /** Defaults to every item on the order. */
  items: z
    .array(docItemSchema.extend({ cartonNo: optionalText(30) }))
    .min(1)
    .max(500)
    .optional(),
});
export const pickItemsSchema = z.object({
  itemIds: z.array(id).min(1).max(500),
  isPicked: z.boolean(),
});

export const deliveryChallanSchema = z.object({
  deliveryDate: z.coerce.date().optional(),
  vehicleNo: optionalText(40),
  driverName: optionalText(80),
  driverPhone: optionalText(30),
  receivedBy: optionalText(120),
  notes: optionalText(2000),
  /** Defaults to everything not delivered yet. */
  items: z.array(docItemSchema).min(1).max(500).optional(),
});

// --- Payments ---------------------------------------------------------------------
export const receivePaymentSchema = z
  .object({
    orderId: id.optional(),
    proformaId: id.optional(),
    /** On-account payment from a buyer, not tied to one order. */
    partyId: id.optional(),
    amount: positiveMoney,
    method: z.enum(PaymentMethod),
    /** Cash / bank / wallet ledger account; defaults by method. */
    accountId: id.optional(),
    paymentDate: z.coerce.date().optional(),
    reference: optionalText(120),
    notes: optionalText(1000),
    /** A photo of the proof, uploaded first (uploadPaymentProofAction). */
    proofFileId: id.optional(),
    /**
     * On account: how the money pays the buyer's invoices, as amounts by order.
     * What is left over stays on their account as advance balance.
     */
    allocations: z
      .array(z.object({ orderId: id, amount: positiveMoney }))
      .max(200)
      .optional(),
    /** On account, without allocations: pay the oldest dues first. */
    oldestFirst: z.boolean().optional(),
    /**
     * On an invoiced order, money above its due: ADVANCE keeps the extra as the
     * buyer's advance balance; OLDER_DUES pays their other dues oldest first and
     * keeps the rest. Without it, more than the due is refused.
     */
    extra: z.enum(["ADVANCE", "OLDER_DUES"]).optional(),
  })
  .superRefine((v, ctx) => {
    const targets = [v.orderId, v.proformaId].filter(Boolean).length;
    if (targets > 1) {
      ctx.addIssue({ code: "custom", path: ["orderId"], message: "Choose an order or a proforma" });
    }
    if (targets === 0 && !v.partyId) {
      ctx.addIssue({ code: "custom", path: ["partyId"], message: "Choose a buyer or an order" });
    }
    if ((v.allocations || v.oldestFirst) && targets > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["allocations"],
        message: "Only money on a buyer's account is spread over invoices",
      });
    }
    if (v.extra && !v.orderId) {
      ctx.addIssue({ code: "custom", path: ["extra"], message: "Only for a payment on an order" });
    }
  });

/** "Use credit" on an invoiced order. */
export const applyCreditSchema = z.object({ amount: positiveMoney });

// --- Cheques ------------------------------------------------------------------------
/** A cheque received: for an order, a proforma or a buyer's account, like a payment. */
export const recordChequeSchema = z
  .object({
    orderId: id.optional(),
    proformaId: id.optional(),
    partyId: id.optional(),
    amount: positiveMoney,
    ...chequeDetails,
    /** The day it was handed over; defaults to now. */
    receivedAt: z.coerce.date().optional(),
    notes: optionalText(1000),
    proofFileId: id.optional(),
    /** On account: how it pays the buyer's invoices once cleared (as for a payment). */
    allocations: z
      .array(z.object({ orderId: id, amount: positiveMoney }))
      .max(200)
      .optional(),
    oldestFirst: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    const targets = [v.orderId, v.proformaId].filter(Boolean).length;
    if (targets > 1) {
      ctx.addIssue({ code: "custom", path: ["orderId"], message: "Choose an order or a proforma" });
    }
    if (targets === 0 && !v.partyId) {
      ctx.addIssue({ code: "custom", path: ["partyId"], message: "Choose a buyer or an order" });
    }
    if ((v.allocations || v.oldestFirst) && targets > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["allocations"],
        message: "Only a cheque on a buyer's account is spread over invoices",
      });
    }
  });
export const clearChequeSchema = z.object({
  /** The day the bank credited it; defaults to today. */
  clearedOn: z.iso.date().optional(),
  /** The bank account it was deposited in; defaults to the main bank account. */
  accountId: id.optional(),
});
export const bounceChequeSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  bouncedOn: z.iso.date().optional(),
});
export const listChequesSchema = z.object({
  status: z.enum(ChequeStatus).optional(),
  partyId: id.optional(),
  orderId: id.optional(),
  cursor: z.string().optional(),
  take,
});
/** A proof photo for a payment or a cheque, uploaded first (uploadPaymentProofAction). */
export const attachProofSchema = z.object({ fileId: id });

export const listPaymentsSchema = z.object({
  partyId: id.optional(),
  orderId: id.optional(),
  from: dayOrInstant.optional(),
  to: dayOrInstant.optional(),
  cursor: z.string().optional(),
  take,
});

// --- Refunds ------------------------------------------------------------------------
export const refundSchema = z
  .object({
    orderId: id.optional(),
    proformaId: id.optional(),
    /** Credit on the buyer's account (payments on account, earlier CREDIT refunds). */
    partyId: id.optional(),
    amount: positiveMoney,
    reason: z.string().trim().min(3).max(500),
    ...settlement,
  })
  .superRefine((v, ctx) => {
    const targets = [v.orderId, v.proformaId].filter(Boolean).length;
    if (targets > 1) {
      ctx.addIssue({ code: "custom", path: ["orderId"], message: "Choose an order or a proforma" });
    }
    if (targets === 0 && !v.partyId) {
      ctx.addIssue({ code: "custom", path: ["partyId"], message: "Choose a buyer or an order" });
    }
    checkSettlement(v, ctx);
  });

export const voidRefundSchema = z.object({ reason: z.string().trim().min(5).max(500) });

export const listRefundsSchema = z.object({
  partyId: id.optional(),
  orderId: id.optional(),
  proformaId: id.optional(),
  kind: z.enum(RefundKind).optional(),
  from: dayOrInstant.optional(),
  to: dayOrInstant.optional(),
  cursor: z.string().optional(),
  take,
});

export const salesSummarySchema = z.object({
  from: dayOrInstant.optional(),
  to: dayOrInstant.optional(),
});

// --- Sales returns (credit notes) ----------------------------------------------------

/** Pieces coming back on one invoice: its lines (order items) and how many of each. */
/**
 * What a returned piece's check found: GOOD goes back into sellable stock,
 * B_GRADE into B-grade stock, DAMAGED to Damage & QC Rejects (the return
 * screen's way, and the default).
 */
export const RETURN_QC = ["GOOD", "B_GRADE", "DAMAGED"] as const;
export type ReturnQc = (typeof RETURN_QC)[number];

export const salesReturnSchema = z.object({
  invoiceId: id,
  items: z
    .array(
      z.object({
        orderItemId: id,
        quantity: qty,
        /** Anything but DAMAGED needs sales.returns.qc (the e-commerce API sends it). */
        qc: z.enum(RETURN_QC).optional(),
        qcNote: optionalText(300),
      }),
    )
    .min(1, "Enter the pieces coming back")
    .max(500),
  reason: z.string().trim().min(3).max(500),
  /** The day the goods came back (company time); today when left out. */
  returnDate: z.iso.date().optional(),
  notes: optionalText(1000),
});

export const voidSalesReturnSchema = z.object({ reason: z.string().trim().min(5).max(500) });

export const listSalesReturnsSchema = z.object({
  /** Credit note or invoice number, or the buyer's name or code. */
  search: z.string().trim().max(100).optional(),
  partyId: id.optional(),
  invoiceId: id.optional(),
  orderId: id.optional(),
  from: dayOrInstant.optional(),
  to: dayOrInstant.optional(),
  cursor: z.string().optional(),
  take,
});
