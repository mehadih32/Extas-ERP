import type { PrismaClient } from "@prisma/client";

/*
 * Bug Guard, the owner's all-round auditor (AI Center > Bug Guard): the shapes
 * every check shares. A check reads (it runs inside readOnly(), so it cannot
 * write) and returns what it found, in the owner's words: simple Bengali with
 * Western digits, English labels of the ERP quoted exactly. What may be done
 * about a finding is said here too, and only done elsewhere, with the owner's
 * OK (fixes.service.ts, corrections.ts, security.ts).
 */

export const AREAS = ["APP", "DATA", "SECURITY", "PRODUCT", "AI"] as const;
export type Area = (typeof AREAS)[number];

export const AREA_LABELS: Record<Area, string> = {
  APP: "Screens and server",
  DATA: "Data and accounts",
  SECURITY: "Security",
  PRODUCT: "Product",
  AI: "AI",
};

/** In Bengali, for the report. */
export const AREA_BN: Record<Area, string> = {
  APP: "স্ক্রিন ও সার্ভার",
  DATA: "ডেটা ও হিসাব",
  SECURITY: "নিরাপত্তা",
  PRODUCT: "ব্যবহার",
  AI: "এআই",
};

export const SEVERITIES = ["URGENT", "IMPORTANT", "LATER"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_LABELS: Record<Severity, string> = {
  URGENT: "Urgent",
  IMPORTANT: "Important",
  LATER: "Can wait",
};

export const SEVERITY_BN: Record<Severity, string> = {
  URGENT: "জরুরি",
  IMPORTANT: "গুরুত্বপূর্ণ",
  LATER: "পরে দেখলেও চলবে",
};

/**
 * What "Fix" does for a finding:
 *   CODE      Claude Code makes a pull request with a test; the owner merges it with the PIN.
 *   DATA      the exact correction (before → after), applied with the PIN after a backup, undoable.
 *   SECURITY  a safe step (end a session, block or unblock a login source), with the PIN.
 *   MANUAL    only the owner can do it; Bug Guard says how, step by step.
 *   NONE      nothing to do (a note).
 */
export const FIX_KINDS = ["CODE", "DATA", "SECURITY", "MANUAL", "NONE"] as const;
export type FixKind = (typeof FIX_KINDS)[number];

/** One stored figure Bug Guard may put right: a total kept beside the records it adds up. */
export type FieldChange = {
  /** A model in CORRECTABLE (correctable.ts); nothing else is ever changed. */
  model: string;
  id: string;
  field: string;
  /** As text, exactly as read ("1250.00"); the change applies only while it is still so. */
  before: string;
  after: string;
  /** What it is, in Bengali ("PO-2026-00012 এর মোট"). */
  label: string;
};

/** An adjusting journal entry's line (accounts are never edited: a new entry corrects them). */
export type JournalLinePlan = {
  accountId: string;
  /** The account's name, for the owner. */
  account: string;
  partyId?: string | null;
  employeeId?: string | null;
  debit: string;
  credit: string;
  memo?: string;
};

/**
 * The exact correction for a data or accounting mistake, shown before → after.
 * Applied only with the owner's PIN, after a backup, as a logged and reversible
 * change: a SET puts back a stored total (undo puts the old figure back); a
 * JOURNAL posts an adjusting entry (undo reverses it). History is never edited
 * or deleted.
 */
export type CorrectionPlan =
  | { kind: "SET"; changes: FieldChange[] }
  | {
      kind: "JOURNAL";
      /** "YYYY-MM-DD". */
      date: string;
      description: string;
      lines: JournalLinePlan[];
    };

/** A safe security step (security.ts). */
export type SecurityAction =
  | { kind: "END_SESSION"; sessionId: string; userId: string }
  | { kind: "BLOCK_SOURCE"; source: string; failures: number }
  | { kind: "UNBLOCK_SOURCE"; blockId: string };

/**
 * The facts a code fix may carry to Claude Code. The issue is public (the
 * repository is): never screen text or business data, only these.
 */
export type CodeFacts = {
  /** The route pattern ("/sales/orders/[id]"), never an address with ids. */
  route: string;
  method?: string | null;
  status?: number | null;
  errorType?: string | null;
  /** Stack lines from the ERP's own code only (src/...). */
  stack?: string[];
  /** Full check problems behind it, when it came from one. */
  problemIds?: string[];
  /** More route patterns it is about (screens without a guide). */
  routes?: string[];
  /** How often it happened since the last run. */
  times?: number;
};

/** One thing a check found, before it is kept. */
export type Found = {
  /** The same problem keeps the same key from run to run ("data.stock:<id>"). */
  key: string;
  area: Area;
  severity: Severity;
  /** What is wrong, one or two lines (Bengali). */
  title: string;
  /** Where: a screen of the ERP ("/purchases/orders/abc") and its name. */
  href?: string | null;
  place?: string | null;
  /** Why it matters (Bengali). */
  why: string;
  /** The proposed fix (Bengali). */
  fix: string;
  fixKind: FixKind;
  /** The facts behind it: a small table (labels in Bengali; never a secret or a password). */
  evidence?: Array<{ label: string; value: string }>;
  correction?: CorrectionPlan | null;
  action?: SecurityAction | null;
  code?: CodeFacts | null;
};

/** What a check is given. `db` only reads (the run is inside readOnly()). */
export type CheckContext = {
  companyId: string;
  now: Date;
  /** The last run's start (or a week back): "since the last check". */
  since: Date;
  /** This company also gets the checks of the server itself (the oldest company). */
  platform: boolean;
  db: PrismaClient;
  /**
   * When what the check reads was seen, if earlier than now (the Full check's
   * findings date from its own run): a fix merged after that is not judged on it.
   */
  observed?: (at: Date) => void;
};

export type Check = {
  /** "data.ledger.balanced" */
  key: string;
  area: Area;
  /** A few words in English, for the screen's list of checks. */
  label: string;
  /** Only in the platform's own company (server, packages, certificate). */
  platform?: boolean;
  run: (ctx: CheckContext) => Promise<Found[]>;
};

/** How one check went in a run. */
export type CheckResult = {
  key: string;
  area: Area;
  label: string;
  status: "OK" | "FOUND" | "SKIPPED" | "FAILED";
  found: number;
  ms: number;
  note?: string;
};
