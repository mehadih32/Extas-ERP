import {
  CustomFieldEntity,
  CustomFieldType,
  PaymentMethod,
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
export const convertToProformaSchema = z.object({
  /** Defaults to the company's advance percentage (30%). */
  advancePercent: z.number().min(0).max(100).optional(),
  issueDate: z.coerce.date().optional(),
});
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

const checkoutPaymentSchema = z.object({
  amount: positiveMoney,
  method: z.enum(PaymentMethod),
  accountId: id.optional(),
  reference: optionalText(120),
});

const orderLines = {
  lines: z.array(orderLineSchema).max(500).optional(),
  matrix: z.array(matrixEntrySchema).max(100).optional(),
};

const orderCharges = {
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
    ...orderLines,
    ...orderCharges,
    /** Money taken at checkout (e.g. cash at the counter). */
    payment: checkoutPaymentSchema.optional(),
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
  });

export const updateOrderSchema = z.object({ ...orderLines, ...orderCharges }).partial();

export const convertProformaToOrderSchema = z
  .object({
    warehouseId: id.optional(),
    orderDate: z.coerce.date().optional(),
    ...orderLines,
    ...orderCharges,
  })
  .superRefine((v, ctx) => {
    if (!v.lines?.length && !v.matrix?.length) {
      ctx.addIssue({ code: "custom", path: ["lines"], message: "Add at least one item" });
    }
  });

export const cancelOrderSchema = z.object({ reason: z.string().trim().min(3).max(500) });

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
});
export const voidInvoiceSchema = z.object({ reason: z.string().trim().min(5).max(500) });

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
  })
  .superRefine((v, ctx) => {
    const targets = [v.orderId, v.proformaId].filter(Boolean).length;
    if (targets > 1) {
      ctx.addIssue({ code: "custom", path: ["orderId"], message: "Choose an order or a proforma" });
    }
    if (targets === 0 && !v.partyId) {
      ctx.addIssue({ code: "custom", path: ["partyId"], message: "Choose a buyer or an order" });
    }
  });

export const listPaymentsSchema = z.object({
  partyId: id.optional(),
  orderId: id.optional(),
  from: dayOrInstant.optional(),
  to: dayOrInstant.optional(),
  cursor: z.string().optional(),
  take,
});

export const salesSummarySchema = z.object({
  from: dayOrInstant.optional(),
  to: dayOrInstant.optional(),
});
