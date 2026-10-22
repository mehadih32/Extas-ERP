import { ACCESS_TREE, type AccessNode, isBranch } from "@/components/settings/roles/access-tree";

/*
 * Control: what the AI may do, as Do (does it itself), Ask (asks the owner,
 * then does it) or Off (won't; it asks for permission instead). It is the
 * access tree of the roles screen (Main area > sub-area > action), not a second
 * tree: every permission is a cell, without the ones the AI may never have
 * (managing the team and roles, backups, the AI Center itself), with the AI's
 * own actions added where they belong (sending to buyers and suppliers,
 * agreeing a CM).
 *
 * Every cell starts at Ask. Setting an area sets everything in it; a cell can
 * then be set on its own (shown as an exception). Locked cells (money, prices,
 * anything that leaves the company, cancelling) stay Ask under an area or a
 * preset set to Do: they become Do only when that exact cell is set to Do by
 * the owner. Deleting has no cell at all: the AI sends a Deletion request.
 * Plain data and functions, tested on their own.
 */

export const CELL_STATES = ["DO", "ASK", "OFF"] as const;
export type CellState = (typeof CELL_STATES)[number];

export const CELL_LABELS: Record<CellState, string> = { DO: "Do", ASK: "Ask", OFF: "Off" };

export const CELL_HINTS: Record<CellState, string> = {
  DO: "Does it itself and tells you after",
  ASK: "Asks you first, then does it",
  OFF: "Won't do it; asks you for permission",
};

export type AiLeaf = {
  /** A permission key, or an AI action ("ai.…"). */
  key: string;
  label: string;
  /** Stays Ask unless this exact cell is set to Do. */
  locked?: true;
};

export type AiBranch = { id: string; label: string; children: AiNode[] };

export type AiNode = AiLeaf | AiBranch;

export const isAiBranch = (node: AiNode): node is AiBranch => "children" in node;

/**
 * Permissions the AI never gets: the team, roles, backups, its own controls,
 * and approving a booking past a check (only a person, with a reason).
 */
export const NEVER_FOR_AI: ReadonlySet<string> = new Set([
  "production.bookings.override",
  "company.members.manage",
  "company.roles.manage",
  "backups.manage",
  "integrations.ecommerce.manage",
  "ai.view",
  "ai.manage",
]);

/**
 * Permissions that stay Ask under an area or preset set to Do: money in or out,
 * committing to a price, voiding or cancelling, approvals that commit the
 * company to a supplier, campaigns to buyers, and the owner's logo tick.
 */
export const LOCKED_PERMISSIONS: ReadonlySet<string> = new Set([
  "accounts.receipts.record",
  "accounts.payments.record",
  "accounts.manage",
  "expenses.manage",
  "hr.payroll.approve",
  "materials.purchase",
  "sales.quotation.manage",
  "sales.order.create",
  "sales.invoice.edit",
  "sales.force_override",
  "sales.campaigns.manage",
  "production.bookings.approve",
  "production.bookings.close",
  "production.logo.approve",
  "costing.decide",
]);

/** The AI's own actions, added under these areas of the access tree. */
const AI_ACTIONS: Record<string, AiLeaf[]> = {
  sales: [
    { key: "ai.buyer.first_email", label: "Write the first email to a new buyer", locked: true },
    { key: "ai.buyer.reply", label: "Reply to a buyer", locked: true },
    { key: "ai.buyer.follow_up", label: "Follow up with a buyer", locked: true },
    { key: "ai.buyer.chase", label: "Chase a buyer (reminders)", locked: true },
    { key: "ai.buyer.claim", label: "Make or answer a claim", locked: true },
  ],
  "sales.orders": [
    { key: "ai.sales.quotation.send", label: "Send a quotation to the buyer", locked: true },
    { key: "ai.sales.invoice.send", label: "Send an invoice to the buyer", locked: true },
  ],
  production: [
    { key: "ai.production.costing", label: "Work out costing" },
    { key: "ai.production.techpack.draft", label: "Draft and check tech packs" },
    { key: "ai.production.cm.agree", label: "Agree a CM with the factory", locked: true },
    { key: "ai.production.new_supplier", label: "Add a new supplier or factory" },
    { key: "ai.production.message.supplier", label: "Message suppliers and mills", locked: true },
    { key: "ai.production.message.factory", label: "Message the factory", locked: true },
  ],
  "production.bookings": [
    { key: "ai.production.booking.send", label: "Send a booking to the supplier", locked: true },
    { key: "ai.production.fabric_first", label: "Send fabric first", locked: true },
  ],
  hr: [
    { key: "ai.hr.notice.draft", label: "Draft notices" },
    { key: "ai.hr.message.staff", label: "Message staff", locked: true },
  ],
  reports: [{ key: "ai.reports.send", label: "Make a report PDF and send it to you" }],
};

/**
 * What goes to a buyer (replies, follow-ups, reminders, claims, quotations,
 * invoices, campaigns to win back quiet buyers) is never Do, not even by hand:
 * the AI drafts it and reminds the owner, who sends it. The owner can only
 * choose between Ask and Off.
 */
export const BUYER_ACTIONS: ReadonlySet<string> = new Set([
  ...AI_ACTIONS.sales!.map((l) => l.key),
  "ai.sales.quotation.send",
  "ai.sales.invoice.send",
  "sales.campaigns.manage",
]);

/** The AI's actions that leave the company or commit it; never Do through an area or preset. */
const LOCKED_ACTIONS = new Set(
  Object.values(AI_ACTIONS)
    .flat()
    .filter((l) => l.locked)
    .map((l) => l.key),
);

function fromAccess(node: AccessNode): AiNode[] {
  if (!isBranch(node)) {
    if (NEVER_FOR_AI.has(node.key)) return [];
    return [
      {
        key: node.key,
        label: node.label,
        ...(LOCKED_PERMISSIONS.has(node.key) ? { locked: true as const } : {}),
      },
    ];
  }
  const children = [...node.children.flatMap(fromAccess), ...(AI_ACTIONS[node.id] ?? [])];
  return children.length > 0 ? [{ id: node.id, label: node.label, children }] : [];
}

/** The whole tree: one root ("Everything") over the areas of the access tree. */
export const AI_TREE: AiBranch = {
  id: "all",
  label: "Everything",
  children: ACCESS_TREE.flatMap(fromAccess),
};

/** A cell's address: "b:<branch id>" for an area, "k:<key>" for an action. */
export type NodeRef = `b:${string}` | `k:${string}`;

export const refOf = (node: AiNode): NodeRef =>
  isAiBranch(node) ? `b:${node.id}` : `k:${node.key}`;

type Indexed = { node: AiNode; ancestors: NodeRef[] };

const INDEX = new Map<NodeRef, Indexed>();
(function index(node: AiNode, ancestors: NodeRef[]) {
  const ref = refOf(node);
  INDEX.set(ref, { node, ancestors });
  if (isAiBranch(node)) for (const child of node.children) index(child, [...ancestors, ref]);
})(AI_TREE, []);

/** Whether this address is a cell of the tree. */
export const isNode = (ref: string): ref is NodeRef => INDEX.has(ref as NodeRef);

export function nodeAt(ref: NodeRef): AiNode {
  const found = INDEX.get(ref);
  if (!found) throw new Error(`Unknown AI control cell: ${ref}`);
  return found.node;
}

/** Every action under a node (or the action itself), in tree order. */
export function actionsOf(node: AiNode): AiLeaf[] {
  return isAiBranch(node) ? node.children.flatMap(actionsOf) : [node];
}

/** Every cell under a node, not counting the node itself. */
export function descendantsOf(ref: NodeRef): NodeRef[] {
  const node = nodeAt(ref);
  if (!isAiBranch(node)) return [];
  return node.children.flatMap((c) => [refOf(c), ...descendantsOf(refOf(c))]);
}

/** Every action key in the tree. */
export const ACTION_KEYS: readonly string[] = actionsOf(AI_TREE).map((l) => l.key);

export const isLocked = (key: string) => LOCKED_PERMISSIONS.has(key) || LOCKED_ACTIONS.has(key);

/** The path to an action, for the screen and the requests: "Production › Bookings › Send…". */
export function pathText(ref: NodeRef): string {
  const found = INDEX.get(ref);
  if (!found) return ref;
  return [...found.ancestors.slice(1), ref].map((r) => labelOf(nodeAt(r))).join(" › ");
}

const labelOf = (node: AiNode) => node.label;

/** The cells the owner set, by address. */
export type CellRows = ReadonlyMap<NodeRef, CellState>;

export type CellReading = {
  state: CellState;
  /** Where it comes from: the cell itself, an area above it, or the start (Ask). */
  from: "cell" | "area" | "start";
  /** A locked cell held at Ask under an area set to Do. */
  heldAtAsk: boolean;
};

/** What a cell stands at: its own setting, else the nearest area's, else Ask. */
export function readCell(rows: CellRows, ref: NodeRef): CellReading {
  const own = rows.get(ref);
  if (own) {
    const buyer = ref.startsWith("k:") && BUYER_ACTIONS.has(ref.slice(2));
    return buyer && own === "DO"
      ? { state: "ASK", from: "cell", heldAtAsk: true }
      : { state: own, from: "cell", heldAtAsk: false };
  }
  const { ancestors } = INDEX.get(ref) ?? { ancestors: [] as NodeRef[] };
  let state: CellState = "ASK";
  let from: CellReading["from"] = "start";
  for (const a of [...ancestors].reverse()) {
    const set = rows.get(a);
    if (set) {
      state = set;
      from = "area";
      break;
    }
  }
  const node = INDEX.get(ref)?.node;
  if (node && !isAiBranch(node) && isLocked(node.key) && state === "DO") {
    return { state: "ASK", from, heldAtAsk: true };
  }
  return { state, from, heldAtAsk: false };
}

/** The most a cell can be: Ask for what goes to a buyer, Do for the rest. */
export const mostFor = (key: string): CellState => (BUYER_ACTIONS.has(key) ? "ASK" : "DO");

/**
 * The rows after setting a cell: the cell takes the state and everything under
 * it follows (their own settings are cleared).
 */
export function setCell(rows: CellRows, ref: NodeRef, state: CellState): Map<NodeRef, CellState> {
  const next = new Map(rows);
  for (const d of descendantsOf(ref)) next.delete(d);
  next.set(ref, state);
  return next;
}

/** A time-limited or one-off opening of a cell (or an area), to Do. */
export type GrantReading = {
  ref: NodeRef;
  /** For one record only (an order, a booking), when given. */
  record?: { type: string; id: string } | null;
};

/**
 * Whether a grant opens this action: a grant on the action itself always does;
 * a grant on an area opens the unlocked actions in it.
 */
export function grantOpens(
  grant: GrantReading,
  key: string,
  record?: { type: string; id: string },
) {
  if (grant.record && (grant.record.type !== record?.type || grant.record.id !== record?.id)) {
    return false;
  }
  const ref: NodeRef = `k:${key}`;
  if (grant.ref === ref) return true;
  if (isLocked(key)) return false;
  return (INDEX.get(ref)?.ancestors ?? []).includes(grant.ref);
}

export const PRESETS = [
  {
    id: "techpack-and-booking",
    label: "Only tech pack and booking",
    hint: "Everything Off except tech packs and bookings, which it does itself (sending and approving still ask you).",
  },
  {
    id: "production-full",
    label: "Production full",
    hint: "All of Production set to Do (money, approvals and messages still ask you). The rest stays as it is.",
  },
  {
    id: "accounts-today",
    label: "Accounts open today",
    hint: "Opens Accounts until the end of today, to read and report (recording money still asks you).",
  },
  {
    id: "all-off",
    label: "All off",
    hint: "Every cell Off: it asks you for permission before anything.",
  },
] as const;

export type PresetId = (typeof PRESETS)[number]["id"];

/** The rows a preset leaves (the Accounts preset is a grant for today instead). */
export function presetRows(rows: CellRows, preset: Exclude<PresetId, "accounts-today">) {
  switch (preset) {
    case "all-off":
      return new Map<NodeRef, CellState>([["b:all", "OFF"]]);
    case "production-full":
      return setCell(rows, "b:production", "DO");
    case "techpack-and-booking": {
      let next = new Map<NodeRef, CellState>([["b:all", "OFF"]]);
      next = setCell(next, "b:production.bookings", "DO");
      next.set("k:production.view", "DO");
      next.set("k:production.techpack.approve", "DO");
      next.set("k:ai.production.techpack.draft", "DO");
      return next;
    }
  }
}
