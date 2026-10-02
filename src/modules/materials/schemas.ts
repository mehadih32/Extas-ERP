import {
  BillStatus,
  MaterialIssueKind,
  MeasurementUnit,
  PaymentMethod,
  PaymentType,
  PurchaseOrderStatus,
  RawMaterialKind,
  RawMaterialMovementType,
} from "@prisma/client";
import { z } from "zod";

import { queryBoolean } from "@/lib/query-params";

const id = z.string().min(1);
/** Quantities: metres to the millimetre, kilograms to the gram (3 decimals). */
const quantity = z
  .number()
  .max(100_000_000)
  .multipleOf(0.001)
  .refine((v) => v > 0, "Must be more than zero");
const stockLevel = z.number().min(0).max(100_000_000).multipleOf(0.001);
/** Prices per unit: up to 4 decimals (a button at 0.3750 a piece). */
const price = z.number().min(0).max(100_000_000).multipleOf(0.0001);
const optionalText = (max: number) => z.string().trim().max(max).nullish();
const reason = z.string().trim().min(5).max(500);
const take = z.coerce.number().int().min(1).max(200).optional();
/** A calendar day in company time, e.g. "2026-10-05". */
const day = z.iso.date();
/** A calendar day ("2026-02-28", in company time) or an exact timestamp. */
const dayOrInstant = z.union([z.date(), z.iso.date(), z.iso.datetime({ offset: true })]);
const code = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "Use letters, digits and - . / _ only");

/** Each id at most once in a list. */
const unique =
  <T>(key: (item: T) => string, message: string) =>
  (items: T[], ctx: z.RefinementCtx) => {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      const k = key(item);
      if (seen.has(k)) ctx.addIssue({ code: "custom", path: [i], message });
      seen.add(k);
    });
  };

// --- Materials -----------------------------------------------------------------------
const materialFields = {
  name: z.string().trim().min(2).max(160),
  kind: z.enum(RawMaterialKind),
  unit: z.enum(MeasurementUnit),
  color: optionalText(60),
  specification: optionalText(500),
  /** Low stock at or below this quantity; empty for no alert. */
  reorderLevel: stockLevel.nullish(),
  /** The usual supplier. */
  supplierId: id.nullish(),
  notes: optionalText(2000),
};

export const createMaterialSchema = z.object({
  ...materialFields,
  /** Leave empty for the next code of its kind (FAB-0001, TRM-0001...). */
  code: code.optional(),
});

export const updateMaterialSchema = z
  .object({ ...materialFields, code, isActive: z.boolean() })
  .partial();

export const listMaterialsSchema = z.object({
  kind: z.enum(RawMaterialKind).optional(),
  supplierId: id.optional(),
  /** Quantities in this store only. */
  warehouseId: id.optional(),
  /** At or below the reorder level. */
  lowStock: queryBoolean.optional(),
  /** Only materials with stock on hand. */
  inStock: queryBoolean.optional(),
  includeInactive: queryBoolean.optional(),
  /** Code, name, color or specification. */
  search: z.string().trim().max(100).optional(),
  cursor: z.string().optional(),
  take,
});

// --- Stock in the store --------------------------------------------------------------
export const openingStockSchema = z.object({
  warehouseId: id.optional(),
  quantity,
  /** What each unit cost (its value reaches the books against Opening Balance Equity). */
  unitCost: price,
  date: dayOrInstant.optional(),
  note: optionalText(500),
});

export const countStockSchema = z.object({
  warehouseId: id.optional(),
  /** What is physically in the store now. */
  countedQuantity: stockLevel,
  date: dayOrInstant.optional(),
  note: optionalText(500),
});

export const wastageSchema = z.object({
  warehouseId: id.optional(),
  quantity,
  date: dayOrInstant.optional(),
  reason,
});

export const transferSchema = z
  .object({
    fromWarehouseId: id,
    toWarehouseId: id,
    quantity,
    date: dayOrInstant.optional(),
    note: optionalText(500),
  })
  .refine((v) => v.fromWarehouseId !== v.toWarehouseId, {
    path: ["toWarehouseId"],
    message: "Choose a different store to move the stock to",
  });

export const stockCardSchema = z.object({
  /** Quantities in and out of this store only (values are kept for the whole company). */
  warehouseId: id.optional(),
  from: dayOrInstant.optional(),
  to: dayOrInstant.optional(),
});

export const listMovementsSchema = z.object({
  materialId: id.optional(),
  warehouseId: id.optional(),
  projectId: id.optional(),
  type: z.enum(RawMaterialMovementType).optional(),
  from: dayOrInstant.optional(),
  to: dayOrInstant.optional(),
  cursor: z.string().optional(),
  take,
});

// --- Purchase orders -----------------------------------------------------------------
const orderLineSchema = z.object({
  materialId: id,
  quantity,
  unitPrice: price,
  description: optionalText(500),
});

const orderLines = z.array(orderLineSchema).min(1).max(100);

export const createPurchaseOrderSchema = z.object({
  supplierId: id,
  /** The production project the materials are bought for. */
  projectId: id.nullish(),
  /** Defaults to today. */
  orderDate: day.optional(),
  /** When the goods should be in-house. */
  expectedDate: day.nullish(),
  /** The supplier's PI or booking number. */
  supplierRef: optionalText(60),
  notes: optionalText(2000),
  lines: orderLines,
});

export const updatePurchaseOrderSchema = z.object({
  projectId: id.nullish(),
  expectedDate: day.nullish(),
  supplierRef: optionalText(60),
  notes: optionalText(2000),
  /** Replaces every line; only while nothing has been received. */
  lines: orderLines.optional(),
});

export const closeOrderSchema = z.object({ reason });

export const listPurchaseOrdersSchema = z.object({
  supplierId: id.optional(),
  projectId: id.optional(),
  materialId: id.optional(),
  status: z.enum(PurchaseOrderStatus).optional(),
  /** Still open past the expected date. */
  overdue: queryBoolean.optional(),
  /** Order number or the supplier's reference. */
  search: z.string().trim().max(100).optional(),
  from: day.optional(),
  to: day.optional(),
  cursor: z.string().optional(),
  take,
});

// --- Purchases (supplier bills for materials) ----------------------------------------
const purchaseItemSchema = z
  .object({
    /** The purchase order line the goods arrived on. */
    purchaseOrderLineId: id.optional(),
    /** Required without an order line. */
    materialId: id.optional(),
    quantity,
    /** The bill price; defaults to the order line's price. */
    unitPrice: price.optional(),
    description: optionalText(500),
  })
  .superRefine((v, ctx) => {
    if (!v.purchaseOrderLineId && !v.materialId) {
      ctx.addIssue({ code: "custom", path: ["materialId"], message: "Choose the material" });
    }
    if (!v.purchaseOrderLineId && v.unitPrice === undefined) {
      ctx.addIssue({ code: "custom", path: ["unitPrice"], message: "Enter the price per unit" });
    }
  });

/** How a purchase paid now is paid (Accounts only); defaults to cash in hand. */
const cashPaymentFields = {
  method: z.enum(PaymentMethod).optional(),
  /** Cash / bank / wallet ledger account; defaults by method. */
  accountId: id.optional(),
  reference: optionalText(120),
};

export const createPurchaseSchema = z
  .object({
    /** Taken from the purchase order when one is given. */
    supplierId: id.optional(),
    purchaseOrderId: id.optional(),
    /** The store the goods went into; defaults to the main store. */
    warehouseId: id.optional(),
    billDate: dayOrInstant.optional(),
    /** The supplier's own bill or challan number. */
    supplierRef: optionalText(60),
    paymentType: z.enum(PaymentType),
    ...cashPaymentFields,
    items: z.array(purchaseItemSchema).min(1).max(100),
    notes: optionalText(2000),
    /** Photo / PDF of the bill uploaded first (POST /api/production/files). */
    attachmentId: id.optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.supplierId && !v.purchaseOrderId) {
      ctx.addIssue({ code: "custom", path: ["supplierId"], message: "Choose the supplier" });
    }
    if (!v.purchaseOrderId && v.items.some((i) => i.purchaseOrderLineId)) {
      ctx.addIssue({
        code: "custom",
        path: ["purchaseOrderId"],
        message: "Choose the purchase order these lines arrived on",
      });
    }
  });

export const voidSchema = z.object({ reason });

export const listPurchasesSchema = z.object({
  supplierId: id.optional(),
  purchaseOrderId: id.optional(),
  materialId: id.optional(),
  warehouseId: id.optional(),
  status: z.enum(BillStatus).optional(),
  from: dayOrInstant.optional(),
  to: dayOrInstant.optional(),
  cursor: z.string().optional(),
  take,
});

// --- Returns to suppliers (debit notes) ----------------------------------------------
export const createSupplierReturnSchema = z.object({
  /** The bill the goods came on (they go back at its price). */
  billId: id,
  /** The store they leave from; defaults to the store the bill received them into. */
  warehouseId: id.optional(),
  date: dayOrInstant.optional(),
  reason,
  lines: z
    .array(z.object({ billItemId: id, quantity }))
    .min(1)
    .max(100)
    .superRefine(unique((l) => l.billItemId, "This bill line is already listed")),
});

export const listSupplierReturnsSchema = z.object({
  supplierId: id.optional(),
  billId: id.optional(),
  includeVoid: queryBoolean.optional(),
  from: dayOrInstant.optional(),
  to: dayOrInstant.optional(),
  cursor: z.string().optional(),
  take,
});

// --- Issues to production and returns from it ----------------------------------------
export const issueSchema = z.object({
  projectId: id,
  /** The store the materials leave from (issue) or come back to (return). */
  warehouseId: id.optional(),
  date: dayOrInstant.optional(),
  /** Who took the materials, or brought them back. */
  receivedBy: optionalText(120),
  note: optionalText(1000),
  lines: z
    .array(z.object({ materialId: id, quantity }))
    .min(1)
    .max(100)
    .superRefine(unique((l) => l.materialId, "List each material once")),
});

export const listIssuesSchema = z.object({
  kind: z.enum(MaterialIssueKind).optional(),
  projectId: id.optional(),
  warehouseId: id.optional(),
  materialId: id.optional(),
  from: dayOrInstant.optional(),
  to: dayOrInstant.optional(),
  cursor: z.string().optional(),
  take,
});
