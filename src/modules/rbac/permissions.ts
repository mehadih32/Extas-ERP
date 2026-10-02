import type { AppModule, SystemRole } from "@prisma/client";

/**
 * The permission catalogue — the single source of truth for what can be granted.
 * `npm run db:seed` syncs it into the Permission table. Add new keys here as
 * each module is built.
 */
export const PERMISSIONS = [
  // Dashboard
  { key: "dashboard.view", module: "DASHBOARD", description: "View the master dashboard" },
  {
    key: "dashboard.financials",
    module: "DASHBOARD",
    description: "See stock value, assets, liabilities and profit cards",
  },
  // Company administration
  {
    key: "company.settings",
    module: "SETTINGS",
    description: "Edit company profile and letterhead details",
  },
  {
    key: "company.members.manage",
    module: "SETTINGS",
    description: "Add, deactivate and change the role of users",
  },
  {
    key: "company.roles.manage",
    module: "SETTINGS",
    description: "Create roles and edit their permissions",
  },
  { key: "audit.view", module: "SETTINGS", description: "View the audit trail / activity log" },
  // Sales
  { key: "sales.view", module: "SALES", description: "View quotations, orders and invoices" },
  {
    key: "sales.quotation.manage",
    module: "SALES",
    description: "Create and edit quotations and proforma invoices",
  },
  {
    key: "sales.order.create",
    module: "SALES",
    description: "Create sales orders, invoices, packing lists and delivery challans",
  },
  { key: "sales.invoice.edit", module: "SALES", description: "Edit or void issued invoices" },
  {
    key: "sales.force_override",
    module: "SALES",
    description: "Sell more than available stock (Force Override)",
  },
  {
    key: "sales.returns.qc",
    module: "RETAIL",
    description: "Inspect returns and move items to main or bad stock",
  },
  {
    key: "sales.campaigns.manage",
    module: "WHOLESALE",
    description: "Run dormant buyer re-engagement campaigns",
  },
  // Inventory
  { key: "inventory.view", module: "INVENTORY", description: "View stock and the product matrix" },
  {
    key: "inventory.manage",
    module: "INVENTORY",
    description: "Manage catalog, adjust stock and record bad stock",
  },
  // Production
  {
    key: "production.view",
    module: "PRODUCTION",
    description: "View production projects (costs need production.manage or accounts.view)",
  },
  {
    key: "production.manage",
    module: "PRODUCTION",
    description: "Create projects, update stages and record supplier bills on credit (Due)",
  },
  {
    key: "production.stock_intake",
    module: "PRODUCTION",
    description: "Move finished goods to stock (AI / manual intake)",
  },
  // Parties
  { key: "parties.view", module: "PARTIES", description: "View buyer and supplier profiles" },
  {
    key: "parties.manage",
    module: "PARTIES",
    description: "Create and edit buyers and suppliers, grading and badges",
  },
  {
    key: "parties.ledger.view",
    module: "PARTIES",
    description: "View lifetime ledgers and statements",
  },
  // Accounts & expenses
  {
    key: "accounts.view",
    module: "ACCOUNTS",
    description: "View accounts, bank statements and P&L",
  },
  {
    key: "accounts.manage",
    module: "ACCOUNTS",
    description: "Post journal entries, write-offs, assets and capital",
  },
  {
    key: "accounts.receipts.record",
    module: "ACCOUNTS",
    description: "Record money received from buyers (payments and advances)",
  },
  {
    key: "accounts.payments.record",
    module: "ACCOUNTS",
    description: "Pay suppliers and record costs paid in cash or bank",
  },
  { key: "expenses.create", module: "EXPENSES", description: "Record expenses and conveyance" },
  { key: "expenses.manage", module: "EXPENSES", description: "Edit or delete any expense" },
  // HR
  { key: "hr.view", module: "HR", description: "View employee profiles" },
  { key: "hr.manage", module: "HR", description: "Manage employees, leave and salary advances" },
  { key: "hr.payroll", module: "HR", description: "Run and pay payroll" },
  {
    key: "portal.self",
    module: "HR",
    description: "Employee portal: own profile, leave, orders and expenses",
  },
  // Other modules
  {
    key: "compliance.manage",
    module: "COMPLIANCE",
    description: "Manage licences and renewal alerts",
  },
  {
    key: "templates.manage",
    module: "TEMPLATES",
    description: "Upload and map document templates",
  },
  { key: "reports.export", module: "REPORTS", description: "Generate PDF / Excel reports" },
  { key: "notepad.use", module: "NOTEPAD", description: "Use the personal notepad and planner" },
  {
    key: "reminders.manage",
    module: "REMINDERS",
    description: "Create tasks and WhatsApp / email reminders",
  },
  { key: "backups.manage", module: "BACKUPS", description: "Run and download backups" },
] as const satisfies ReadonlyArray<{ key: string; module: AppModule; description: string }>;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const ALL_PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.map((p) => p.key);

const PERMISSION_KEY_SET = new Set<string>(ALL_PERMISSION_KEYS);
export function isPermissionKey(value: string): value is PermissionKey {
  return PERMISSION_KEY_SET.has(value);
}

/** Display names of the built-in roles: the five from the blueprint plus Accounts. */
export const SYSTEM_ROLE_NAMES: Record<SystemRole, string> = {
  SUPER_ADMIN: "Super Admin",
  PRODUCTION_MANAGER: "Production Manager",
  SALES_EXECUTIVE: "Sales Executive",
  WAREHOUSE_TEAM: "Warehouse Team",
  EMPLOYEE: "Employee",
  ACCOUNTS: "Accounts",
};

/**
 * Money in and money out. By default only Super Admin and Accounts hold these,
 * so the people who sell or produce never record cash themselves.
 */
export const MONEY_PERMISSIONS: readonly PermissionKey[] = [
  "accounts.receipts.record",
  "accounts.payments.record",
];

/**
 * Default grants for the built-in roles. Super Admin always has every permission
 * (checked in code), so its list here is only used to fill the table.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRole, readonly PermissionKey[]> = {
  SUPER_ADMIN: ALL_PERMISSION_KEYS,
  PRODUCTION_MANAGER: [
    "dashboard.view",
    "production.view",
    "production.manage",
    "production.stock_intake",
    "inventory.view",
    "inventory.manage",
    "parties.view",
    "expenses.create",
    "reports.export",
    "notepad.use",
    "reminders.manage",
  ],
  SALES_EXECUTIVE: [
    "dashboard.view",
    "sales.view",
    "sales.quotation.manage",
    "sales.order.create",
    "sales.campaigns.manage",
    "inventory.view",
    "parties.view",
    "parties.manage",
    "parties.ledger.view",
    "expenses.create",
    "notepad.use",
    "reminders.manage",
  ],
  WAREHOUSE_TEAM: [
    "inventory.view",
    "inventory.manage",
    "sales.view",
    "sales.returns.qc",
    "production.view",
    "production.stock_intake",
    "notepad.use",
  ],
  EMPLOYEE: ["portal.self", "expenses.create", "notepad.use"],
  ACCOUNTS: [
    "dashboard.view",
    "dashboard.financials",
    "sales.view",
    "production.view",
    "parties.view",
    "parties.ledger.view",
    "accounts.view",
    "accounts.manage",
    "accounts.receipts.record",
    "accounts.payments.record",
    "expenses.create",
    "expenses.manage",
    "reports.export",
    "notepad.use",
  ],
};
