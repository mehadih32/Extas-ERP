import { Prisma } from "@prisma/client";

/*
 * Fresh start (the owner's decision, 2026-11-12): what happens to every table
 * when a company starts fresh. This is the ONE list, reviewed by hand: every
 * model in prisma/schema.prisma is here, and tests/unit/fresh-start-plan.test.ts
 * fails when a model is missing, so a new table is never forgotten.
 *
 *   KEEP       stays as it is (settings, set-ups, the team, platform tables).
 *   ERASE      every row of this company goes.
 *   PARTIES    kept when the owner ticks "Keep buyers and suppliers", else erased.
 *   PRODUCTS   kept when the owner ticks "Keep products and styles", else erased.
 *   EMPLOYEES  kept when the owner ticks "Keep employees", else erased.
 *
 * Special rows (wipe.ts): the Walk-in customers account and each retail store's
 * own buyer are always kept (the store set-up needs them); files (FileAsset) go
 * when nothing kept still uses them. Kept rows that hold a running figure are
 * set back to zero (RESETS), so every balance starts at zero.
 */

export type FreshStartTick = "PARTIES" | "PRODUCTS" | "EMPLOYEES";
export type FreshStartRule = "KEEP" | "ERASE" | FreshStartTick;

export type FreshStartTicks = {
  keepParties: boolean;
  keepProducts: boolean;
  keepEmployees: boolean;
};

export const FRESH_START_RULES: Readonly<Record<string, FreshStartRule>> = {
  // The platform and the team.
  Company: "KEEP",
  User: "KEEP",
  Session: "KEEP",
  CompanyMembership: "KEEP",
  MemberPermission: "KEEP",
  Role: "KEEP",
  Permission: "KEEP",
  RolePermission: "KEEP",
  UserPreference: "KEEP",
  OneTimeCode: "KEEP",
  FreshStart: "KEEP",
  // Backups (platform-wide) and the server's own records.
  BackupConfig: "KEEP",
  ErpCopy: "KEEP",
  BackupRun: "KEEP",
  LoginBlock: "KEEP",
  ServerError: "KEEP",
  UsageCount: "KEEP",
  ServerHealthRun: "KEEP",
  // Settings and set-ups.
  CustomFieldDefinition: "KEEP",
  DocumentSequence: "KEEP",
  Category: "KEEP",
  Brand: "KEEP",
  Color: "KEEP",
  Size: "KEEP",
  SizeRatioPreset: "KEEP",
  SizeRatioEntry: "KEEP",
  Warehouse: "KEEP",
  // How each factory's packing lists are laid out (a setting, 2026-11-12).
  PackingListSource: "KEEP",
  // Which approvals the bot may show with buttons (a setting, release 5).
  BotApprovalSetting: "KEEP",
  SalesChannelIntegration: "KEEP",
  CourierAccount: "KEEP",
  LedgerAccount: "KEEP",
  BankAccount: "KEEP",
  PettyCashBox: "KEEP",
  ExpenseHead: "KEEP",
  TermsVersion: "KEEP",
  HrSettings: "KEEP",
  Holiday: "KEEP",
  WorkLocation: "KEEP",
  LeaveType: "KEEP",
  ComplianceDocument: "KEEP",
  DocumentTemplate: "KEEP",
  TemplatePlaceholder: "KEEP",
  ReminderRule: "KEEP",
  RetailStore: "KEEP",
  // AI Center, the bot and Bug Guard settings (and the AI's spend, PIN tries and security log).
  AiSettings: "KEEP",
  AiControlCell: "KEEP",
  AiGrant: "KEEP",
  AiBudget: "KEEP",
  AiUsage: "KEEP",
  AiKnowledgeBook: "KEEP",
  AiTestRun: "KEEP",
  AiModelPrice: "KEEP",
  AiModelTest: "KEEP",
  HouseRule: "KEEP",
  CompanyMailSettings: "KEEP",
  AiBotLink: "KEEP",
  AiPinTry: "KEEP",
  AiSkill: "KEEP",
  AiSkillVersion: "KEEP",
  ClaudeCodeRequest: "KEEP",
  BugGuardSettings: "KEEP",
  BugGuardEvent: "KEEP",

  // Buyers and suppliers (the tick).
  Party: "PARTIES",

  // Products and styles (the tick), with their shop prices, size charts and the materials list.
  Style: "PRODUCTS",
  ProductVariant: "PRODUCTS",
  StyleSizeChart: "PRODUCTS",
  RetailPrice: "PRODUCTS",
  RawMaterial: "PRODUCTS",

  // Employees (the tick), with their papers, salary history, leave balances and terms agreed.
  Employee: "EMPLOYEES",
  EmployeeDocument: "EMPLOYEES",
  SalaryRevision: "EMPLOYEES",
  LeaveBalance: "EMPLOYEES",
  TermsAcceptance: "EMPLOYEES",

  // Files: erased when nothing kept uses them (wipe.ts).
  FileAsset: "ERASE",

  // Everything the business did: erased (notes and the planner too).
  Note: "ERASE",
  AuditLog: "ERASE",
  SalesTarget: "ERASE",
  StockBalance: "ERASE",
  StockMovement: "ERASE",
  StockLot: "ERASE",
  BadStockEntry: "ERASE",
  RawMaterialStock: "ERASE",
  RawMaterialMovement: "ERASE",
  PurchaseOrder: "ERASE",
  PurchaseOrderLine: "ERASE",
  PurchaseOrderLineShare: "ERASE",
  Booking: "ERASE",
  BookingRevision: "ERASE",
  BookingCollarSize: "ERASE",
  BookingCollarColour: "ERASE",
  BookingCollarQuantity: "ERASE",
  SupplierBillItem: "ERASE",
  MaterialIssue: "ERASE",
  MaterialChallan: "ERASE",
  PurchaseReturn: "ERASE",
  PurchaseReturnLine: "ERASE",
  ReEngagementCampaign: "ERASE",
  CampaignRecipient: "ERASE",
  Quotation: "ERASE",
  QuotationItem: "ERASE",
  QuotationStylingRule: "ERASE",
  ProformaInvoice: "ERASE",
  SalesOrder: "ERASE",
  SalesOrderItem: "ERASE",
  Invoice: "ERASE",
  PackingList: "ERASE",
  PackingListItem: "ERASE",
  DeliveryChallan: "ERASE",
  DeliveryChallanItem: "ERASE",
  Payment: "ERASE",
  CreditAllocation: "ERASE",
  Cheque: "ERASE",
  Refund: "ERASE",
  WebhookEvent: "ERASE",
  IntegrationApiCall: "ERASE",
  IntegrationIdempotency: "ERASE",
  Shipment: "ERASE",
  ShipmentEvent: "ERASE",
  SalesReturn: "ERASE",
  SalesReturnItem: "ERASE",
  ProductionProject: "ERASE",
  ProductionBatch: "ERASE",
  ProductionContract: "ERASE",
  ProductionMaterialNeed: "ERASE",
  TechPack: "ERASE",
  TechPackChange: "ERASE",
  TechPackMeasurement: "ERASE",
  TechPackReference: "ERASE",
  TechPackLogo: "ERASE",
  TechPackColour: "ERASE",
  LabDipOption: "ERASE",
  TechPackAiDraft: "ERASE",
  TechPackExpertAnswer: "ERASE",
  ProductionTargetLine: "ERASE",
  ProjectSettlement: "ERASE",
  ProductionStageLog: "ERASE",
  SupplierBill: "ERASE",
  SupplierFault: "ERASE",
  CuttingReport: "ERASE",
  FinishingReport: "ERASE",
  CmSettlement: "ERASE",
  EmbroideryJob: "ERASE",
  SupplierBillAllocation: "ERASE",
  StockIntake: "ERASE",
  StockIntakeLine: "ERASE",
  JournalEntry: "ERASE",
  JournalLine: "ERASE",
  FixedAsset: "ERASE",
  CapitalSource: "ERASE",
  CapitalLender: "ERASE",
  RecurringExpense: "ERASE",
  CapitalInstallment: "ERASE",
  Expense: "ERASE",
  AdSpend: "ERASE",
  PayDetailsRequest: "ERASE",
  BackgroundJob: "ERASE",
  Attendance: "ERASE",
  OvertimeEntry: "ERASE",
  StaffClaim: "ERASE",
  Notice: "ERASE",
  NoticeRead: "ERASE",
  EmployeeAsset: "ERASE",
  LocationPing: "ERASE",
  StaffPosition: "ERASE",
  LeaveRequest: "ERASE",
  PayrollRun: "ERASE",
  PayrollItem: "ERASE",
  PayrollPayment: "ERASE",
  PayrollPaymentLine: "ERASE",
  SalaryAdvance: "ERASE",
  AdvanceSettlement: "ERASE",
  GeneratedDocument: "ERASE",
  ReportExport: "ERASE",
  Task: "ERASE",
  Reminder: "ERASE",
  ReminderRecipient: "ERASE",
  NotificationLog: "ERASE",
  AiPermissionRequest: "ERASE",
  AiDeletionRequest: "ERASE",
  FabricQuote: "ERASE",
  OrderCosting: "ERASE",
  OrderCostingStyle: "ERASE",
  AiChatMessage: "ERASE",
  AiDraft: "ERASE",
  AiFollowUp: "ERASE",
  // Release 2 (2026-11-12): sent documents, their links, follow-ups, order-status links.
  DocumentSend: "ERASE",
  DocumentLink: "ERASE",
  FollowUp: "ERASE",
  OrderStatusLink: "ERASE",
  AiBotMessage: "ERASE",
  AiOrderRun: "ERASE",
  AiStaffUpdate: "ERASE",
  FullCheckRun: "ERASE",
  FullCheckProblem: "ERASE",
  BugGuardRun: "ERASE",
  BugGuardFinding: "ERASE",
  BugGuardCorrection: "ERASE",
  RetailPriceChange: "ERASE",
  RetailOrder: "ERASE",
  RetailOrderLine: "ERASE",
  RetailDelivery: "ERASE",
  RetailReturnList: "ERASE",
  RetailReturnParcel: "ERASE",
  RetailReturnPiece: "ERASE",
  RetailExchange: "ERASE",
  RetailExchangeEvent: "ERASE",
  RetailReserve: "ERASE",
  ReadyStockPurchase: "ERASE",
  ReadyStockLine: "ERASE",
  RetailDailySummary: "ERASE",
  RetailFixedCost: "ERASE",
  RetailBudget: "ERASE",
  // Release 4 (2026-11-12): wholesale returns and the B2B budgets.
  WholesaleReturn: "ERASE",
  WholesaleReturnLine: "ERASE",
  B2bAcquisitionBudget: "ERASE",
  RetailAlert: "ERASE",
  RetailYearReport: "ERASE",
  RetailTarget: "ERASE",
};

/**
 * Kept rows that hold a running figure built from erased work, set back as a new
 * company has them (only when the model is kept). Plain SQL fragments for SET.
 */
export const FRESH_START_RESETS: Readonly<Record<string, string>> = {
  LedgerAccount: `"openingBalance" = 0`,
  Party: `"openingBalance" = 0, "lastTransactionAt" = NULL`,
  // Marked changed, so the online shops are sent the kept SKUs again (fresh-start/shops.ts).
  ProductVariant: `"avgCost" = 0, "bGradeAvgCost" = 0, "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC')`,
  RawMaterial: `"quantity" = 0, "stockValue" = 0, "avgCost" = 0`,
  LeaveBalance: `"used" = 0`,
  RetailStore: `"holdReleasedUntil" = NULL, "holdReleaseReason" = NULL, "summaryAskedAt" = NULL, "summaryAlertedOn" = NULL, "holdTold" = false, "paymentToldAt" = NULL`,
  DocumentSequence: `"nextNumber" = 1`,
  AiBotLink: `"pending" = NULL, "pendingUntil" = NULL`,
};

/** Erased models whose rows are erased only in part (see where()). */
const PARTIAL = new Set(["Party", "FileAsset"]);

type Model = Prisma.DMMF.Model;
type Field = Prisma.DMMF.Field;

const models = (): readonly Model[] => Prisma.dmmf.datamodel.models;
const byName = (): Map<string, Model> => new Map(models().map((m) => [m.name, m]));

const hasCompany = (m: Model) => m.fields.some((f) => f.name === "companyId");

/** A relation that holds the foreign key on this side (fields → the other model). */
export type ForeignKey = {
  from: string;
  to: string;
  columns: string[];
  required: boolean;
  onDelete: string;
};

export function foreignKeys(): ForeignKey[] {
  const out: ForeignKey[] = [];
  for (const m of models()) {
    for (const f of m.fields as Field[]) {
      if (f.kind !== "object" || !f.relationFromFields?.length) continue;
      const columns = [...f.relationFromFields];
      // Prisma's default: Restrict for a required relation, SetNull for an optional one.
      const onDelete = f.relationOnDelete ?? (f.isRequired ? "Restrict" : "SetNull");
      out.push({ from: m.name, to: f.type, columns, required: f.isRequired, onDelete });
    }
  }
  return out;
}

/** Whether the model's rows are erased with these ticks. */
export function erases(model: string, ticks: FreshStartTicks): boolean {
  const rule = FRESH_START_RULES[model];
  if (!rule) throw new Error(`Fresh start: the model ${model} is not in FRESH_START_RULES.`);
  if (rule === "KEEP") return false;
  if (rule === "ERASE") return true;
  if (rule === "PARTIES") return !ticks.keepParties;
  if (rule === "PRODUCTS") return !ticks.keepProducts;
  return !ticks.keepEmployees;
}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * The model that owns a row of a table with no companyId: its required relation
 * that cascades (a line's order, an entry's journal entry).
 */
function ownerOf(model: Model): ForeignKey | null {
  return (
    foreignKeys().find(
      (k) => k.from === model.name && k.required && k.onDelete === "Cascade" && k.to !== k.from,
    ) ?? null
  );
}

/**
 * SQL for "this company's rows that are erased" of a model ($1 is the company's
 * id). A table with no companyId reaches the company through its owner.
 */
export function where(modelName: string): string {
  const all = byName();
  const model = all.get(modelName);
  if (!model) throw new Error(`Fresh start: no model ${modelName}.`);
  if (hasCompany(model)) {
    if (modelName === "Party") {
      // The Walk-in customers account (any system account) and each retail store's buyer stay.
      return `"companyId" = $1 AND "systemRole" IS NULL AND "id" NOT IN (SELECT "partyId" FROM "RetailStore" WHERE "companyId" = $1)`;
    }
    return `"companyId" = $1`;
  }
  const owner = ownerOf(model);
  if (!owner || owner.columns.length !== 1) {
    throw new Error(`Fresh start: ${modelName} has no companyId and no owner to reach one.`);
  }
  return `${q(owner.columns[0]!)} IN (SELECT "id" FROM ${q(owner.to)} WHERE ${where(owner.to)})`;
}

export type FreshStartStep = { model: string; sql: string; kind: "unlink" | "erase" | "reset" };

/**
 * The whole wipe as SQL, in a safe order, for these ticks:
 *   1. kept rows that point at erased ones by an optional link lose the link;
 *   2. erased rows that point at each other within one table lose that link;
 *   3. erased tables, every row that points at another erased row first;
 *   4. kept rows' running figures back to zero.
 * Files (FileAsset) go afterwards, in wipe.ts, once nothing kept uses them.
 * Throws when the plan cannot be safe (a kept row needs an erased one, or a loop).
 */
export function freshStartSteps(ticks: FreshStartTicks): FreshStartStep[] {
  const keys = foreignKeys();
  const erased = new Set(
    models()
      .map((m) => m.name)
      .filter((name) => erases(name, ticks) && name !== "FileAsset"),
  );
  const kept = (name: string) => !erased.has(name) && name !== "FileAsset";
  const steps: FreshStartStep[] = [];

  // 1. Kept → erased links.
  for (const k of keys) {
    if (!kept(k.from) || !erased.has(k.to)) continue;
    if (k.required) {
      // The only allowed case: the erased side keeps exactly the rows kept ones need.
      const allowed = k.from === "RetailStore" && k.to === "Party";
      if (!allowed) {
        throw new Error(
          `Fresh start: kept ${k.from} needs ${k.to} (${k.columns.join(", ")}), which is erased.`,
        );
      }
      continue;
    }
    const target = byName().get(k.from)!;
    const column = k.columns[0]!;
    steps.push({
      kind: "unlink",
      model: k.from,
      sql: `UPDATE ${q(k.from)} SET ${k.columns.map((c) => `${q(c)} = NULL`).join(", ")} WHERE ${q(column)} IN (SELECT "id" FROM ${q(k.to)} WHERE ${where(k.to)})${hasCompany(target) ? ` AND "companyId" = $1` : ""}`,
    });
  }

  // 2. Links inside one erased table (a reversal's original, a replaced line).
  for (const k of keys) {
    if (k.from !== k.to || !erased.has(k.from)) continue;
    if (k.required)
      throw new Error(`Fresh start: ${k.from} links to itself and the link is needed.`);
    steps.push({
      kind: "unlink",
      model: k.from,
      sql: `UPDATE ${q(k.from)} SET ${k.columns.map((c) => `${q(c)} = NULL`).join(", ")} WHERE ${where(k.from)}`,
    });
  }

  // A table with no companyId is reached through its owner, which must be erased in
  // full too, or some of its rows would be missed.
  for (const name of erased) {
    const model = byName().get(name)!;
    if (hasCompany(model)) continue;
    const owner = ownerOf(model);
    if (!owner || !erased.has(owner.to) || PARTIAL.has(owner.to)) {
      throw new Error(
        `Fresh start: ${name} is erased but its owner ${owner?.to ?? "(none)"} is not.`,
      );
    }
  }

  // 3. Erased tables: a table goes only once nothing left to erase points at it.
  const pointsAt = new Map<string, Set<string>>();
  for (const name of erased) pointsAt.set(name, new Set());
  for (const k of keys) {
    if (k.from === k.to || !erased.has(k.from) || !erased.has(k.to)) continue;
    pointsAt.get(k.to)!.add(k.from);
  }
  const done = new Set<string>();
  const order: string[] = [];
  while (order.length < erased.size) {
    const ready = [...erased]
      .filter((name) => !done.has(name) && [...pointsAt.get(name)!].every((c) => done.has(c)))
      .sort();
    if (ready.length === 0) {
      const left = [...erased].filter((name) => !done.has(name));
      throw new Error(`Fresh start: these tables point at each other: ${left.join(", ")}.`);
    }
    for (const name of ready) {
      done.add(name);
      order.push(name);
    }
  }
  for (const name of order) {
    steps.push({ kind: "erase", model: name, sql: `DELETE FROM ${q(name)} WHERE ${where(name)}` });
  }

  // 4. Running figures on kept rows (on a table erased in part, such as the
  // buyers, on the rows that stay: Walk-in customers and the stores' buyers).
  for (const [name, set] of Object.entries(FRESH_START_RESETS)) {
    if (!kept(name) && !PARTIAL.has(name)) continue;
    const model = byName().get(name)!;
    const scope = hasCompany(model) ? `"companyId" = $1` : where(name);
    steps.push({ kind: "reset", model: name, sql: `UPDATE ${q(name)} SET ${set} WHERE ${scope}` });
  }
  return steps;
}

/**
 * The columns that name a file by its address or id instead of a link (a
 * style's picture, an employee's photo, an AI skill's uploaded knowledge): a
 * file named in a kept row there is kept even with no link to it. A fixed list
 * (tests/unit/fresh-start-plan.test.ts checks each exists).
 */
export const FILE_MENTIONS: readonly { model: string; column: string; json?: boolean }[] = [
  { model: "Company", column: "logoUrl" },
  { model: "Brand", column: "logoUrl" },
  { model: "Style", column: "imageUrl" },
  { model: "Employee", column: "photoUrl" },
  { model: "User", column: "avatarUrl" },
  { model: "AiSkillVersion", column: "files", json: true },
];

/** The FILE_MENTIONS columns of the tables kept with these ticks. */
export function fileMentionColumns(
  ticks: FreshStartTicks,
): { model: string; column: string; json: boolean; tenant: boolean }[] {
  const all = byName();
  return FILE_MENTIONS.filter((c) => !erases(c.model, ticks)).map((c) => ({
    model: c.model,
    column: c.column,
    json: Boolean(c.json),
    tenant: hasCompany(all.get(c.model)!),
  }));
}

/** Every table the wipe writes to (erased, unlinked or reset), to lock it first. */
export function touchedTables(ticks: FreshStartTicks): string[] {
  return [...new Set([...freshStartSteps(ticks).map((s) => s.model), "FileAsset"])].sort();
}
