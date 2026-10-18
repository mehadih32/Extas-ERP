import {
  BillStatus,
  ContractKind,
  CostAllocationMethod,
  IntakeStatus,
  MaterialSplit,
  PaymentMethod,
  PaymentType,
  ProductionKind,
  ProductionStage,
  ProductionStatus,
  StockGrade,
} from "@prisma/client";
import { z } from "zod";

import { queryBoolean } from "@/lib/query-params";

const id = z.string().min(1);
const money = z.number().min(0).max(1_000_000_000).multipleOf(0.01);
const positiveMoney = money.refine((v) => v > 0, "Must be more than zero");
const qty = z.number().int().min(1).max(1_000_000);
const optionalText = (max: number) => z.string().trim().max(max).nullish();
const reason = z.string().trim().min(5).max(500);
const take = z.coerce.number().int().min(1).max(200).optional();
/** A calendar day ("2026-02-28", in company time) or an exact timestamp. */
const dayOrInstant = z.union([z.date(), z.iso.date(), z.iso.datetime({ offset: true })]);

// --- Projects ----------------------------------------------------------------------
/** The pieces to make per SKU (colour and size): the target grid, each SKU once. */
const targets = z
  .array(z.object({ variantId: id, quantity: qty }))
  .max(1000)
  .refine(
    (lines) => new Set(lines.map((l) => l.variantId)).size === lines.length,
    "Each colour and size can be given once",
  );

const projectFields = {
  name: z.string().trim().min(2).max(160),
  categoryId: id.nullish(),
  styleId: id.nullish(),
  /** The factory as a supplier profile (its bills go to its ledger)... */
  factoryId: id.nullish(),
  /** ...or just its name. */
  factoryName: optionalText(160),
  /** The buyer it is made for; leave empty for In-House production. */
  buyerId: id.nullish(),
  startDate: dayOrInstant.optional(),
  targetDate: dayOrInstant,
  /** The pieces to make; with a target grid it is the grid's sum and may be left out. */
  targetQuantity: qty,
  /** Replaces the target grid; an empty list clears it. */
  targets: targets.optional(),
  notes: optionalText(4000),
  /** The master batch it is one style of; null takes it out of its batch. */
  batchId: id.nullish(),
  /** The most a piece should cost (the cost guard's "Target price"); null clears it. */
  targetUnitCost: positiveMoney.nullish(),
};

export const createProjectSchema = z
  .object({
    ...projectFields,
    targetQuantity: qty.optional(),
    /** PLANNED projects have not started yet; the default is ACTIVE. */
    status: z.enum(["PLANNED", "ACTIVE"]).optional(),
    /** "Start production" on a sales order or a proforma: made for its buyer. */
    salesOrderId: id.optional(),
    proformaId: id.optional(),
  })
  .refine((v) => v.targetQuantity !== undefined || (v.targets?.length ?? 0) > 0, {
    path: ["targetQuantity"],
    message: "Enter how many pieces, or the pieces per colour and size",
  })
  .refine((v) => !(v.salesOrderId && v.proformaId), {
    path: ["proformaId"],
    message: "Start it from the order or from the proforma, not both",
  });
export const updateProjectSchema = z.object(projectFields).partial();

export const listProjectsSchema = z.object({
  status: z.enum(ProductionStatus).optional(),
  batchId: id.optional(),
  stage: z.enum(ProductionStage).optional(),
  buyerId: id.optional(),
  factoryId: id.optional(),
  inHouse: queryBoolean.optional(),
  /** Open projects past their target date. */
  overdue: queryBoolean.optional(),
  search: z.string().trim().max(100).optional(),
  cursor: z.string().optional(),
  take,
});

// --- Master batches ------------------------------------------------------------------
const batchFields = {
  name: z.string().trim().min(2).max(160),
  /** CM (cut and made at a factory), READYMADE (bought ready-made) or DROPSHIP. */
  kind: z.enum(ProductionKind),
  /** The factory its styles are made at; a new style starts with it. */
  factoryId: id.nullish(),
  /** The day it should all be done; a new style starts with it. */
  targetDate: dayOrInstant.nullish(),
  /** Rejects up to this share of the pieces cut cost the factory nothing (2 unless changed). */
  rejectTolerancePercent: z
    .number()
    .min(0, "0 or more")
    .max(100, "100 at most")
    .multipleOf(0.01, "Up to 2 decimal places")
    .optional(),
  notes: optionalText(4000),
};

export const createBatchSchema = z.object({
  ...batchFields,
  kind: batchFields.kind.optional(),
});
export const updateBatchSchema = z.object(batchFields).partial();

/** Planned (no style started), in production, or done (every style closed). */
export const BATCH_STATES = ["EMPTY", "PLANNED", "ACTIVE", "DONE"] as const;
export type BatchState = (typeof BATCH_STATES)[number];

export const listBatchesSchema = z.object({
  state: z.enum(BATCH_STATES).optional(),
  kind: z.enum(ProductionKind).optional(),
  search: z.string().trim().max(100).optional(),
  cursor: z.string().optional(),
  take,
});

// --- Materials per piece and batch purchase orders ---------------------------------
/** How much one piece takes, in the material's unit: up to 4 decimals (0.2850 kg). */
const perPiece = z
  .number()
  .max(100_000)
  .multipleOf(0.0001)
  .refine((v) => v > 0, "Must be more than zero");

const materialNeedSchema = z.object({
  materialId: id,
  perPiece,
  /** Ordered on top for cutting loss, as a percent (5 for 5%). */
  wastagePercent: z.number().min(0).max(100).multipleOf(0.01).optional(),
  /** One total (default), per garment colour, or per colour and size (collars, cuffs). */
  split: z.enum(MaterialSplit).optional(),
  /** Where it goes on the garment ("Main body", "Collar", "Back neck label"). */
  placement: optionalText(80),
  /** A material picture uploaded first (uploadMaterialImageAction). */
  imageId: id.nullish(),
  notes: optionalText(500),
});

/** Replaces a style's materials per piece; an empty list clears them. */
export const setMaterialNeedsSchema = z.object({ needs: z.array(materialNeedSchema).max(60) });

export const techPackNotesSchema = z.object({ notes: optionalText(4000) });

/** Raw material quantities: to the gram or millimetre (3 decimals). */
const materialQuantity = z
  .number()
  .max(100_000_000)
  .multipleOf(0.001)
  .refine((v) => v > 0, "Must be more than zero");

const batchOrderLineSchema = z.object({
  materialId: id,
  quantity: materialQuantity,
  /** Empty: the price is agreed when the goods arrive ("price at receive"). */
  unitPrice: z.number().min(0).max(100_000_000).multipleOf(0.0001).nullish(),
  /** Defaults to the picture on the styles' materials. */
  imageId: id.nullish(),
  description: optionalText(500),
});

/** One purchase order per supplier for what the batch's styles need. */
export const createBatchOrdersSchema = z.object({
  orders: z
    .array(
      z.object({
        supplierId: id,
        expectedDate: z.iso.date().nullish(),
        supplierRef: optionalText(60),
        notes: optionalText(2000),
        lines: z
          .array(batchOrderLineSchema)
          .min(1)
          .max(100)
          .refine(
            (lines) => new Set(lines.map((l) => l.materialId)).size === lines.length,
            "Each material can be on an order once",
          ),
      }),
    )
    .min(1)
    .max(20)
    .refine(
      (orders) => new Set(orders.map((o) => o.supplierId)).size === orders.length,
      "Put everything from one supplier on one order",
    ),
});

// --- Batch contracts ----------------------------------------------------------------
/** Draft a fabric, accessories or factory (CM) agreement with one party for a batch. */
export const createContractSchema = z.object({
  kind: z.enum(ContractKind),
  partyId: id,
});

const clause = z.object({
  title: z.string().trim().min(1, "Give the clause a title").max(80),
  text: z.string().trim().min(1, "Write what the clause says").max(2000),
});

/**
 * The reviewed clauses, the day it was signed, and each style's CM (factory):
 * `cmRate` is the amount as agreed, per piece or per dozen (`cmPer`, per piece
 * when left out).
 */
export const updateContractSchema = z.object({
  clauses: z.array(clause).min(1, "Keep at least one clause").max(30),
  signedOn: z.iso.date().nullish(),
  cmRates: z
    .array(
      z.object({
        projectId: id,
        cmRate: money.nullable(),
        cmPer: z.enum(["PIECE", "DOZEN"]).default("PIECE"),
      }),
    )
    .max(200)
    .refine(
      (rates) => new Set(rates.map((r) => r.projectId)).size === rates.length,
      "Each style once",
    )
    .optional(),
});

export const setStageSchema = z.object({
  stage: z
    .enum(ProductionStage)
    .refine((s) => s !== "COMPLETED", "Use Complete to finish the project"),
  /** Required when a project goes back a stage (rework). */
  note: optionalText(1000),
});

/** Takes back the stage move just made by mistake (to `stage`). */
export const undoStageSchema = z.object({ stage: z.enum(ProductionStage) });

export const setStatusSchema = z.object({
  /** ACTIVE starts a planned project or resumes one on hold. */
  status: z.enum(["ACTIVE", "ON_HOLD"]),
  note: optionalText(1000),
});

export const completeProjectSchema = z.object({
  /**
   * Cost still in work-in-progress (not moved to stock) is written off as a
   * production loss with this reason. Needs accounts.manage.
   */
  writeOffReason: reason.optional(),
  note: optionalText(1000),
});

export const cancelProjectSchema = z.object({ reason });

// --- Costs ---------------------------------------------------------------------------
export const costHeadSchema = z.object({
  name: z.string().trim().min(2).max(80),
  category: z.enum(["PRODUCTION", "RAW_MATERIAL"]).optional(),
});
export const updateCostHeadSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  isActive: z.boolean().optional(),
});
export const listCostHeadsSchema = z.object({ includeInactive: queryBoolean.optional() });

/** How a Cash/Bank cost is paid (Accounts only); defaults to cash in hand. */
const cashPaymentFields = {
  method: z.enum(PaymentMethod).optional(),
  /** Cash / bank / wallet ledger account; defaults by method. */
  accountId: id.optional(),
  reference: optionalText(120),
};

const costFields = {
  expenseHeadId: id,
  amount: positiveMoney,
  paymentType: z.enum(PaymentType),
  /** Required for Due; optional for Cash/Bank (keeps the supplier's history). */
  supplierId: id.optional(),
  supplierRef: optionalText(60),
  date: dayOrInstant.optional(),
  description: optionalText(500),
  ...cashPaymentFields,
  /** Enter it although it looks like a bill or cost already entered. */
  allowDuplicate: z.boolean().optional(),
};

const dueNeedsSupplier = (
  v: { paymentType: PaymentType; supplierId?: string },
  ctx: z.RefinementCtx,
) => {
  if (v.paymentType === "DUE" && !v.supplierId) {
    ctx.addIssue({
      code: "custom",
      path: ["supplierId"],
      message: "Choose the supplier this is due to",
    });
  }
};

/** One cost on one project: paid now (Cash/Bank) or owed to a supplier (Due). */
export const addProjectCostSchema = z.object(costFields).superRefine(dueNeedsSupplier);

/**
 * A cost of a master batch (QC, travel...) with its Cost Setup: on one style,
 * or split equally among the batch's open styles.
 */
export const addBatchCostSchema = z
  .object({
    ...costFields,
    split: z.enum(["EQUAL", "ONE"]),
    /** The style it is for, when on one style. */
    projectId: id.optional(),
  })
  .superRefine((v, ctx) => {
    dueNeedsSupplier(v, ctx);
    if (v.split === "ONE" && !v.projectId) {
      ctx.addIssue({ code: "custom", path: ["projectId"], message: "Choose the style" });
    }
  });

// --- Materials sent (MC- challans) ---------------------------------------------------
/** One line of what was sent: "Oxford fabric", 500, "kg". Quantities to 3 decimals. */
const challanItemSchema = z.object({
  description: z.string().trim().min(2).max(200),
  quantity: z
    .number()
    .max(100_000_000)
    .multipleOf(0.001)
    .refine((v) => v > 0, "Must be more than zero"),
  unit: z.string().trim().min(1).max(20),
});

/** "Send material": what went to the factory, line by line, and where and how it went. */
export const createMaterialChallanSchema = z.object({
  /** The day it was sent (company time); today when left out. */
  sentOn: dayOrInstant.optional(),
  /** Where it went; the project's factory when left out. */
  sentTo: z.string().trim().min(2).max(300).optional(),
  items: z.array(challanItemSchema).min(1).max(30),
  carrier: optionalText(120),
  notes: optionalText(1000),
});

export type ChallanItem = z.output<typeof challanItemSchema>;

/** How a challan's stored lines are read back (the same shape as when saved). */
export const challanItemsSchema = z.array(challanItemSchema);

export const billAllocationSchema = z.object({
  projectId: id,
  expenseHeadId: id,
  amount: positiveMoney,
  description: optionalText(500),
});

/** Split Bill: one supplier bill shared across one or more production projects. */
export const createBillSchema = z.object({
  supplierId: id,
  supplierRef: optionalText(60),
  billDate: dayOrInstant.optional(),
  paymentType: z.enum(PaymentType),
  ...cashPaymentFields,
  allocations: z.array(billAllocationSchema).min(1).max(100),
  notes: optionalText(2000),
  /** Photo / PDF of the bill uploaded first (POST /api/production/files). */
  attachmentId: id.optional(),
  /** Enter it although it looks like a bill already entered (same number, or total within days). */
  allowDuplicate: z.boolean().optional(),
});

export const payBillSchema = z.object({
  amount: positiveMoney,
  method: z.enum(PaymentMethod),
  accountId: id.optional(),
  paymentDate: dayOrInstant.optional(),
  reference: optionalText(120),
  notes: optionalText(1000),
});

export const voidSchema = z.object({ reason });

export const listBillsSchema = z.object({
  supplierId: id.optional(),
  projectId: id.optional(),
  status: z.enum(BillStatus).optional(),
  from: dayOrInstant.optional(),
  to: dayOrInstant.optional(),
  cursor: z.string().optional(),
  take,
});

// --- Move to Stock (stock intake) -----------------------------------------------------
const intakeLineSchema = z.object({
  variantId: id,
  /** Defaults to A-grade. */
  grade: z.enum(StockGrade).optional(),
  quantity: qty,
  /** Cost per piece, only used with MANUAL costing. */
  unitCost: z.number().min(0).max(100_000_000).optional(),
});

/** Matrix entry: one style and grade, pieces per SKU (color x size cell). */
const intakeMatrixSchema = z.object({
  styleId: id,
  grade: z.enum(StockGrade).optional(),
  quantities: z.record(id, z.number().int().min(0).max(1_000_000)),
});

const intakeLines = {
  lines: z.array(intakeLineSchema).max(2000).optional(),
  matrix: z.array(intakeMatrixSchema).max(100).optional(),
};

const intakeCosting = {
  /**
   * EQUAL_PER_PIECE (default): every piece carries the same cost.
   * B_GRADE_RATIO: a B-grade piece carries `bGradeCostRatio` of an A-grade piece.
   * MANUAL: the cost per piece entered on each line.
   */
  costAllocation: z.enum(CostAllocationMethod).optional(),
  bGradeCostRatio: z.number().min(0).max(1).optional(),
};

export const createIntakeSchema = z.object({
  projectId: id,
  warehouseId: id.optional(),
  /** Factory packing list photo / PDF uploaded first (POST /api/production/files). */
  sourceFileId: id.optional(),
  /** Read the packing list with AI; the default when a file is given without lines. */
  parse: z.boolean().optional(),
  ...intakeLines,
  ...intakeCosting,
  notes: optionalText(2000),
});

export const updateIntakeSchema = z.object({
  warehouseId: id.optional(),
  /** Either list replaces all lines. */
  ...intakeLines,
  ...intakeCosting,
  notes: optionalText(2000),
});

export const confirmIntakeSchema = z.object({
  warehouseId: id.optional(),
  /** Cost moved into stock; defaults to this delivery's share of the project's cost. */
  totalCost: money.optional(),
  /** The factory's last delivery: takes all the project's remaining cost. */
  finalDelivery: z.boolean().optional(),
  /** Also mark the project completed (implies the final delivery; Production Managers only). */
  completeProject: z.boolean().optional(),
  /** Receive at zero cost when the project has no cost left to give. */
  allowZeroCost: z.boolean().optional(),
});

export const reverseIntakeSchema = z.object({
  reason,
  /** Also open a draft copy of the delivery to correct and confirm again. */
  redraft: z.boolean().optional(),
});

export const listIntakesSchema = z.object({
  projectId: id.optional(),
  status: z.enum(IntakeStatus).optional(),
  cursor: z.string().optional(),
  take,
});
