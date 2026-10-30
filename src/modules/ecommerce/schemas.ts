import { z } from "zod";

/*
 * The shapes of the e-commerce API (CN-005), one place for the routes, the
 * tests and openapi.yaml. Field names are the contract's. Money is a number in
 * the company's currency with at most 2 decimals; times are ISO 8601; a day is
 * YYYY-MM-DD. Enum values are taken in any case ("bkash", "bKash", "BKASH").
 */

const upper = (value: unknown) => (typeof value === "string" ? value.trim().toUpperCase() : value);
const upperEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(upper, z.enum(values));

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();
const money = z
  .number()
  .finite()
  .min(0)
  .max(1_000_000_000)
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, "At most 2 decimals");
const positiveMoney = money.refine((v) => v > 0, "Must be more than 0");
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "A day as YYYY-MM-DD")
  .refine((v) => {
    const at = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(at.getTime()) && at.toISOString().startsWith(v);
  }, "Not a real day");
const instant = z.string().datetime({ offset: true });

export const externalOrderIdSchema = text(100);
export const skuSchema = text(80);

// ---------------------------------------------------------------------------
// Reading: catalog and stock (GET)
// ---------------------------------------------------------------------------

/** ?updatedSince=&cursor=&limit= on the lists (limit 1-500, 100 by default). */
export const pageQuerySchema = z.object({
  updatedSince: instant.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** GET /catalog/variants: also one style's SKUs (`styleCode`), for the site's "Import from ERP". */
export const catalogQuerySchema = pageQuerySchema.extend({
  styleCode: z.string().trim().min(1).max(60).optional(),
});

/** One SKU in a retail store's catalog: only the price the store buys at (plan v6 sec 2). */
export type StoreCatalogVariant = {
  sku: string;
  barcode: string | null;
  styleCode: string;
  styleName: string;
  color: string;
  size: string;
  grade: "A";
  shopPrice: number;
  active: boolean;
  updatedAt: string;
};

export const stockQuerySchema = pageQuerySchema.extend({
  warehouseId: z.string().max(40).optional(),
});

/** One variant in GET /catalog/variants and in variant.changed. */
export type CatalogVariant = {
  sku: string;
  barcode: string | null;
  styleCode: string;
  styleName: string;
  color: string;
  size: string;
  /** The variant's own retail price, else its style's. */
  retailPrice: number;
  avgCost: number;
  /** For sale: the variant and its style are active and it was not taken off the matrix. */
  active: boolean;
  /** The later of the variant's and its style's last change. */
  updatedAt: string;
};

/** One SKU in one warehouse in GET /stock, GET /stock/{sku} and stock.changed (A grade only). */
export type StockRow = {
  sku: string;
  warehouseId: string;
  warehouseName: string;
  onHand: number;
  reserved: number;
  /** onHand - reserved, never below 0. */
  available: number;
  updatedAt: string;
};

/** A page of a list: the rows and the cursor for the next page (null on the last). */
export type Page<T> = { data: T[]; nextCursor: string | null };

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export const SHOP_PAYMENT_METHODS = ["COD", "BKASH", "NAGAD", "CARD"] as const;
export type ShopPaymentMethod = (typeof SHOP_PAYMENT_METHODS)[number];

export const orderItemSchema = z.object({
  sku: skuSchema,
  quantity: z.number().int().min(1).max(100_000),
  /** The price per piece the shop charged, before the line's discount. */
  unitPrice: money,
  /** The discount on the whole line (not per piece). */
  discount: money.default(0),
  /** A retail store's shop (plan v6): the site's own id for the line, e.g. "WEB-1043-3". */
  lineId: z.string().trim().min(1).max(60).optional(),
  /** The customer's price per piece after the combo split and discounts (the store's own figure). */
  customerPrice: money.optional(),
  /** The combo the piece is part of. */
  comboId: z.string().trim().min(1).max(60).optional(),
  /** "A" (the default) or "B" for B-grade stock. */
  grade: z.enum(["A", "B"]).default("A"),
  /** On an exchange order: the lineId (of the order being exchanged) this piece replaces. */
  replacesLineId: z.string().trim().min(1).max(60).optional(),
});

export const createOrderSchema = z.object({
  externalOrderId: externalOrderIdSchema,
  orderDate: instant.optional(),
  customer: z.object({
    name: text(120),
    phone: text(30),
  }),
  /** At most 500 characters, as on the ERP's own order screens. */
  shippingAddress: text(500),
  items: z.array(orderItemSchema).min(1).max(200),
  shippingFee: money.default(0),
  /** What the courier collects on delivery (0 when paid online). */
  codAmount: money.default(0),
  paymentMethod: upperEnum(SHOP_PAYMENT_METHODS),
  note: optionalText(1000),
  /** A retail store's shop: what the customer was to pay for delivery (0 when free). */
  deliveryCharge: money.default(0),
  /** A retail store's shop: the customer's advance (bKash or another). */
  advancePaid: money.default(0),
  /** A retail store's exchange (plan v6 sec 8.9): the order whose pieces this one replaces. */
  exchange: z
    .object({ ofExternalOrderId: externalOrderIdSchema, note: optionalText(500) })
    .optional(),
});

export const ORDER_STATUSES = [
  "PROCESSING",
  "PACKED",
  "CANCELLED",
  "DELIVERED",
  "RETURNED",
] as const;

/** PATCH /orders/{externalOrderId}: a status change, an edit before packing, or both. */
export const updateOrderSchema = z
  .object({
    status: upperEnum(ORDER_STATUSES).optional(),
    /** Why it was cancelled or came back (kept on the order). */
    reason: optionalText(500),
    /** The new lines, replacing the old ones: only before the order is packed. */
    items: z.array(orderItemSchema).min(1).max(200).optional(),
    shippingFee: money.optional(),
    codAmount: money.optional(),
    customer: z.object({ name: text(120), phone: text(30) }).optional(),
    shippingAddress: text(500).optional(),
    note: optionalText(1000),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Send a status or a change");

/** The order as the API answers it (POST and PATCH /orders). */
export type ShopOrder = {
  erpOrderId: string;
  erpOrderNumber: string;
  externalOrderId: string;
  status: string;
  total: number;
  paid: number;
  due: number;
  codAmount: number;
  items: Array<{ sku: string; quantity: number; unitPrice: number; discount: number }>;
  /** A retail store's order: what the store owes the ERP for it, fixed when it came. */
  erpTotal?: number;
  /** When the store was billed (the parcel left), or null. */
  billedAt?: string | null;
  /** A retail store's order: the site's lines with the shop price fixed for each. */
  lines?: Array<{
    lineId: string;
    sku: string;
    grade: "A" | "B";
    quantity: number;
    shopPrice: number;
    customerPrice: number;
    fromReturnStock: boolean;
    /** On an exchange: the line it replaces and what the store paid for that piece. */
    replacesLineId?: string;
    replacedShopPrice?: number;
  }>;
  /** An exchange order (plan v6 sec 8.9). */
  exchangeId?: string;
  /** What would be billed if the old pieces do not come back. */
  atRisk?: number;
};

/** details of the 409 INSUFFICIENT_STOCK answer to POST /orders (and an edit). */
export type ShortStock = {
  shortSkus: Array<{ sku: string; requested: number; available: number }>;
};

// ---------------------------------------------------------------------------
// Payments, shipments, returns, ad spend
// ---------------------------------------------------------------------------

export const paymentSchema = z
  .object({
    externalOrderId: externalOrderIdSchema,
    amount: positiveMoney,
    method: upperEnum(SHOP_PAYMENT_METHODS),
    /**
     * The transaction id (bKash TrxID, card reference, courier invoice...):
     * required for BKASH, NAGAD and CARD, so a payment sent again is known.
     */
    reference: optionalText(120),
    /** When the money was received (now when left out). */
    date: z.union([day, instant]).optional(),
    note: optionalText(500),
  })
  .superRefine((v, ctx) => {
    if (v.method !== "COD" && !v.reference) {
      ctx.addIssue({
        code: "custom",
        path: ["reference"],
        message: `Send the ${v.method} transaction id`,
      });
    }
  });

export const shipmentSchema = z.object({
  externalOrderId: externalOrderIdSchema,
  /** Steadfast, Pathao, RedX or any other courier's name. */
  courier: text(60),
  consignmentId: text(100),
  trackingCode: optionalText(100),
  /** What the courier charges for the delivery. */
  charge: money.default(0),
  /** What the courier collects (the order's COD amount when left out). */
  codAmount: money.optional(),
});

export const SHIPMENT_EVENT_STATUSES = [
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "PARTIALLY_DELIVERED",
  "RETURNED",
  "CANCELLED",
] as const;

/** Couriers' own words the API understands as well. */
export const SHIPMENT_STATUS_ALIASES: Record<string, (typeof SHIPMENT_EVENT_STATUSES)[number]> = {
  PICKED: "PICKED_UP",
  PICKUP: "PICKED_UP",
  TRANSIT: "IN_TRANSIT",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  PARTIAL_DELIVERED: "PARTIALLY_DELIVERED",
  RETURN: "RETURNED",
};

export const shipmentEventSchema = z.object({
  status: z.preprocess((value) => {
    const v = upper(value);
    return typeof v === "string"
      ? (SHIPMENT_STATUS_ALIASES[v.replace(/[\s-]+/g, "_")] ?? v.replace(/[\s-]+/g, "_"))
      : v;
  }, z.enum(SHIPMENT_EVENT_STATUSES)),
  occurredAt: instant,
  /** The courier's own status text, kept as it came. */
  courierStatus: optionalText(100),
  note: optionalText(500),
});

/** The answer to POST /shipments. */
export type ShopShipment = {
  erpShipmentId: string;
  externalOrderId: string;
  courier: string;
  consignmentId: string;
  /** The shipment's status (CREATED when it is new). */
  status: string;
  /** The order's status after it (SHIPPED once a shipment is booked). */
  orderStatus: string;
};

/** The answer to POST /shipments/{consignmentId}/events. */
export type ShopShipmentEvent = {
  erpShipmentId: string;
  consignmentId: string;
  /** The shipment's status: that of its latest event (by occurredAt). */
  status: string;
  orderStatus: string;
  /**
   * Set when the event was saved but the order could not follow it (for
   * example money held on a parcel that came back): the step's error.
   */
  orderError?: { code: string; message: string };
};

export const RETURN_QC_RESULTS = ["GOOD", "B_GRADE", "DAMAGED"] as const;

export const returnSchema = z.object({
  externalOrderId: externalOrderIdSchema,
  /** The shop's own id for this return: one already used is answered 409 RETURN_EXISTS. */
  externalReturnId: optionalText(100),
  reason: text(500),
  /** The day the goods came back (today when left out). */
  returnDate: day.optional(),
  items: z
    .array(
      z.object({
        sku: skuSchema,
        quantity: z.number().int().min(1).max(100_000),
        /** GOOD: back into sellable stock; B_GRADE: into B-grade stock; DAMAGED: to Damage & QC Rejects. */
        qc: z.preprocess(
          (value) =>
            typeof upper(value) === "string"
              ? (upper(value) as string).replace(/[\s-]+/g, "_")
              : value,
          z.enum(RETURN_QC_RESULTS),
        ),
        note: optionalText(300),
      }),
    )
    .min(1)
    .max(200),
});

export const AD_PLATFORMS = ["FACEBOOK", "INSTAGRAM", "GOOGLE", "TIKTOK", "OTHER"] as const;

/** One day's total for one platform (and campaign); a repeat replaces that day's figure. */
export const adSpendSchema = z.object({
  date: day,
  platform: upperEnum(AD_PLATFORMS),
  amount: money,
  campaign: optionalText(120),
});

// ---------------------------------------------------------------------------
// A retail store's returns (plan v6 sec 8, site-changes 2.5)
// ---------------------------------------------------------------------------

/** PUT /orders/{externalOrderId}/delivery: the courier's result. */
export const deliveryResultSchema = z.object({
  status: upperEnum(["DELIVERED", "PARTIAL", "RETURNED"] as const),
  courier: text(60),
  consignmentId: text(100),
  /** What the courier collected from the customer. */
  collected: money.default(0),
  at: instant,
  /** The site's "Partial delivery" mark, when its staff ticked the lines the customer kept. */
  mark: z
    .object({
      keptLines: z.array(text(60)).max(200),
      discountGiven: money.default(0),
      phoneConfirmed: z.boolean().default(false),
      note: optionalText(500),
    })
    .optional(),
});

/** POST /return-lists: a lot the courier handed back (returnListId is the idempotency key). */
export const returnListSchema = z.object({
  returnListId: text(60),
  courier: text(60),
  handedBackAt: day,
  parcels: z
    .array(
      z.object({
        consignmentId: text(100),
        externalOrderId: externalOrderIdSchema,
        receivedCount: z.number().int().min(0).max(10_000).optional(),
        note: optionalText(500),
      }),
    )
    .min(1)
    .max(500),
});

/** GET /exchanges: pending (the default) or all, since a time. */
export const exchangesQuerySchema = pageQuerySchema.extend({
  status: z.enum(["pending", "all"]).default("pending"),
});

/** POST /exchanges/{exchangeId}/late-return: an old piece that came back on no matching consignment. */
export const lateReturnSchema = z.object({
  handedBackAt: day,
  courier: text(60),
  returnListId: z.string().trim().min(1).max(60).nullish(),
  consignmentId: z.string().trim().min(1).max(100).nullish(),
  note: optionalText(500),
});
