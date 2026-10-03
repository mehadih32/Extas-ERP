import {
  BillStatus,
  CostAllocationMethod,
  IntakeStatus,
  PaymentMethod,
  PaymentType,
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
  targetQuantity: qty,
  notes: optionalText(4000),
};

export const createProjectSchema = z.object({
  ...projectFields,
  /** PLANNED projects have not started yet; the default is ACTIVE. */
  status: z.enum(["PLANNED", "ACTIVE"]).optional(),
});
export const updateProjectSchema = z.object(projectFields).partial();

export const listProjectsSchema = z.object({
  status: z.enum(ProductionStatus).optional(),
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

export const setStageSchema = z.object({
  stage: z
    .enum(ProductionStage)
    .refine((s) => s !== "COMPLETED", "Use Complete to finish the project"),
  /** Required when a project goes back a stage (rework). */
  note: optionalText(1000),
});

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

/** One cost on one project: paid now (Cash/Bank) or owed to a supplier (Due). */
export const addProjectCostSchema = z
  .object({
    expenseHeadId: id,
    amount: positiveMoney,
    paymentType: z.enum(PaymentType),
    /** Required for Due; optional for Cash/Bank (keeps the supplier's history). */
    supplierId: id.optional(),
    supplierRef: optionalText(60),
    date: dayOrInstant.optional(),
    description: optionalText(500),
    ...cashPaymentFields,
  })
  .superRefine((v, ctx) => {
    if (v.paymentType === "DUE" && !v.supplierId) {
      ctx.addIssue({
        code: "custom",
        path: ["supplierId"],
        message: "Choose the supplier this is due to",
      });
    }
  });

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
