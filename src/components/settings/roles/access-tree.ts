import type { PermissionKey } from "@/modules/rbac/permissions";
import { PERMISSIONS } from "@/modules/rbac/permissions";

/*
 * The access tree: every permission in the catalogue (rbac/permissions.ts) as an
 * action under its area of the app, Main area > sub-area (> sub-sub-area) >
 * action, e.g. Production > Bookings > Add bookings > Ready stock. Ticking an
 * area gives everything in it; opening it lets someone tick only some of it.
 * Each permission sits in the tree exactly once (a test keeps it that way as
 * modules add keys). Plain data and functions, so they are tested on their own.
 */

export type AccessLeaf = {
  key: PermissionKey;
  /** What the box says, in a few words. */
  label: string;
};

export type AccessBranch = {
  id: string;
  label: string;
  /** Said once under the area's name when it is open. */
  note?: string;
  children: AccessNode[];
};

export type AccessNode = AccessLeaf | AccessBranch;

export const isBranch = (node: AccessNode): node is AccessBranch => "children" in node;

const leaf = (key: PermissionKey, label: string): AccessLeaf => ({ key, label });
const branch = (
  id: string,
  label: string,
  children: AccessNode[],
  note?: string,
): AccessBranch => ({ id, label, children, ...(note ? { note } : {}) });

export const ACCESS_TREE: readonly AccessBranch[] = [
  branch("dashboard", "Dashboard", [
    leaf("dashboard.view", "See the dashboard"),
    leaf("dashboard.financials", "See the money cards (stock value, assets, profit)"),
  ]),
  branch(
    "administration",
    "Company administration",
    [
      branch("administration.team", "Team and roles", [
        leaf("company.members.manage", "Add people and change their roles"),
        leaf("company.roles.manage", "Create roles and change their permissions"),
      ]),
      leaf("company.settings", "Edit the company details and letterhead"),
      leaf("integrations.ecommerce.manage", "Connect online shops and make their keys"),
      leaf("audit.view", "See the activity log"),
    ],
    "These let people manage the team, the roles and the company details. Someone who can manage roles can give any role every permission, so keep them for people you trust with the whole company.",
  ),
  branch("sales", "Sales", [
    branch("sales.orders", "Quotations, orders and invoices", [
      leaf("sales.view", "See quotations, orders and invoices"),
      leaf("sales.quotation.manage", "Make quotations and proforma invoices"),
      leaf("sales.order.create", "Make orders, invoices, packing lists and challans"),
      leaf("sales.invoice.edit", "Edit or void issued invoices"),
      leaf("sales.force_override", "Sell more than the stock (Force Override)"),
    ]),
    leaf("sales.returns.qc", "Check returned goods (QC)"),
    leaf("sales.campaigns.manage", "Win back quiet buyers (campaigns)"),
  ]),
  branch("stock", "Stock and raw materials", [
    branch("stock.finished", "Finished goods stock", [
      leaf("inventory.view", "See stock and the product matrix"),
      leaf("inventory.manage", "Manage the catalogue and adjust stock"),
    ]),
    branch("stock.materials", "Raw materials", [
      leaf("materials.view", "See raw material stock and purchase orders"),
      leaf("materials.manage", "Run the store: count, issue, move and wastage"),
      leaf("materials.purchase", "Buy: purchase orders, bills on credit and returns"),
    ]),
  ]),
  branch("production", "Production", [
    branch("production.batches", "Batches and projects", [
      leaf("production.view", "See batches, projects and deliveries"),
      leaf("production.manage", "Run batches and projects, stages and bills on credit"),
    ]),
    branch("production.bookings", "Bookings", [
      leaf("production.bookings.view", "See bookings"),
      branch("production.bookings.add", "Add bookings", [
        leaf("production.bookings.supplier", "Supplier PO (a mill or trims house)"),
        leaf("production.bookings.market", "Ready stock (market purchase)"),
      ]),
      leaf("production.bookings.attach", "Attach bookings to a batch"),
      leaf("production.bookings.close", "Close or cancel bookings"),
      leaf("production.bookings.approve", "Approve bookings and choose Fabric first"),
      leaf(
        "production.bookings.override",
        "Approve collar, cuff and trims before the tech pack is approved (with a reason)",
      ),
    ]),
    leaf("production.techpack.approve", "Lock fabric parts and approve tech packs"),
    leaf("production.logo.approve", "Tick logos for bulk after the sew-out"),
    branch("production.costing", "Costing", [
      leaf("costing.view", "See costing sheets, costs, profit and the Order check card"),
      leaf("costing.manage", "Make costing sheets and add supplier fabric quotes"),
      leaf("costing.decide", "Take or decline an order"),
    ]),
    leaf("production.stock_intake", "Move finished goods into stock"),
  ]),
  branch("parties", "Buyers and suppliers", [
    leaf("parties.view", "See buyers and suppliers"),
    leaf("parties.manage", "Add and edit buyers and suppliers"),
    leaf("parties.ledger.view", "See ledgers and statements"),
  ]),
  branch(
    "accounts",
    "Accounts",
    [
      branch("accounts.books", "The books", [
        leaf("accounts.view", "See accounts, bank statements and P&L"),
        leaf("accounts.manage", "Journals, chart of accounts, banks, assets and capital"),
      ]),
      branch("accounts.money", "Money in and out", [
        leaf("accounts.receipts.record", "Record money received"),
        leaf("accounts.payments.record", "Record money paid out"),
      ]),
    ],
    "Recording money in or out is kept to Accounts and Super Admin by default, so the people who sell or produce never record cash themselves.",
  ),
  branch("expenses", "Expenses", [
    leaf("expenses.create", "Record expenses and conveyance"),
    leaf("expenses.manage", "See, edit and void any expense"),
  ]),
  branch("hr", "HR and payroll", [
    branch("hr.staff", "Staff", [
      leaf("hr.view", "See staff, attendance, leave and holidays"),
      leaf("hr.manage", "Manage staff, salaries, attendance and leave"),
    ]),
    branch("hr.payroll", "Payroll", [
      leaf("hr.payroll", "Prepare payroll"),
      leaf("hr.payroll.approve", "Approve payroll"),
      leaf("hr.money.view", "See the staff money drill-down"),
    ]),
    leaf("portal.self", "Use the employee portal"),
  ]),
  branch("compliance", "Licences and registrations", [
    leaf("compliance.view", "See licences and their renewal dates"),
    leaf("compliance.manage", "Add, renew and archive licences"),
  ]),
  branch("documents", "Documents and letterhead", [
    leaf("templates.manage", "Upload and map document templates"),
    leaf("documents.letterhead", "Print the blank letterhead pad"),
  ]),
  branch("reports", "Reports", [leaf("reports.export", "Make PDF and Excel reports")]),
  branch("notepad", "Notepad and reminders", [
    leaf("notepad.use", "Use the notepad and own reminders"),
    leaf("reminders.manage", "Give tasks and reminders to other people"),
  ]),
  branch("backups", "Backups", [leaf("backups.manage", "Backups (platform owner only)")]),
  branch(
    "ai",
    "AI Center",
    [
      leaf("ai.view", "See the AI Center"),
      leaf("ai.manage", "Turn AI on or off and set what it may do"),
    ],
    "The AI itself never holds these: it can never change what it may do.",
  ),
];

const DESCRIPTIONS = new Map<string, string>(PERMISSIONS.map((p) => [p.key, p.description]));

/** The catalogue's longer description of a permission. */
export const permissionDescription = (key: PermissionKey) => DESCRIPTIONS.get(key) ?? "";

/** Every action under a node, in tree order. */
export function leavesOf(node: AccessNode): AccessLeaf[] {
  return isBranch(node) ? node.children.flatMap(leavesOf) : [node];
}

/** Every branch under (and including) these nodes, in tree order. */
export function branchesOf(nodes: readonly AccessNode[]): AccessBranch[] {
  return nodes.flatMap((n) => (isBranch(n) ? [n, ...branchesOf(n.children)] : []));
}

/** Every permission in tree order. */
export const TREE_KEYS: PermissionKey[] = ACCESS_TREE.flatMap((b) => leavesOf(b).map((l) => l.key));

export type TickState = "all" | "some" | "none";

/** Whether all, some or none of a node's actions are ticked. */
export function tickState(node: AccessNode, selected: ReadonlySet<string>): TickState {
  const keys = leavesOf(node).map((l) => l.key);
  const on = keys.filter((k) => selected.has(k)).length;
  return on === 0 ? "none" : on === keys.length ? "all" : "some";
}

/** Ticks (or unticks) everything under a node. */
export function tickNode(
  node: AccessNode,
  selected: ReadonlySet<PermissionKey>,
  on: boolean,
): Set<PermissionKey> {
  const next = new Set(selected);
  for (const { key } of leavesOf(node)) {
    if (on) next.add(key);
    else next.delete(key);
  }
  return next;
}

/**
 * The tree cut down to what matches the search: an area whose name (with the
 * areas above it) matches keeps everything in it; otherwise it keeps the
 * actions that match by their label, description or key. Areas with nothing
 * left are dropped.
 */
export function searchTree(nodes: readonly AccessNode[], query: string, path = ""): AccessNode[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...nodes];
  const matches = (text: string) => {
    const lower = text.toLowerCase();
    return words.every((w) => lower.includes(w));
  };
  return nodes.flatMap((node): AccessNode[] => {
    if (!isBranch(node)) {
      return matches(`${path} ${node.label} ${permissionDescription(node.key)} ${node.key}`)
        ? [node]
        : [];
    }
    const here = `${path} ${node.label}`;
    if (matches(here)) return [node];
    const children = searchTree(node.children, query, here);
    return children.length > 0 ? [{ ...node, children }] : [];
  });
}
