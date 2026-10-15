import type { CheckRow } from "@/modules/costing/order-check";

/*
 * What a chat answer can carry besides its words. A change card changes
 * nothing until the owner presses Apply (in the owner's name, "AI Chat,
 * approved by owner"); the other cards show something made or found. Client-
 * safe: no database, no server code.
 */

export const CHANGE_ACTIONS = [
  "accounts.today",
  "control.cell",
  "profit.set",
  "task.create",
  "followup.set",
] as const;

export type ChangeAction = (typeof CHANGE_ACTIONS)[number];

export type ChangeLine = { label: string; before?: string | null; after: string };

export type ChatCard =
  | {
      type: "change";
      action: ChangeAction;
      title: string;
      /** The page it changes. */
      page: string;
      href: string | null;
      lines: ChangeLine[];
      params: Record<string, string | number | null>;
    }
  | {
      type: "draft";
      draftId: string;
      subject: string;
      to: string | null;
      party: string | null;
      forBuyer: boolean;
      body: string;
    }
  | {
      type: "report";
      exportId: string;
      title: string;
      range: string;
      href: string;
      emailed: string | null;
    }
  | {
      type: "check";
      costingId: string;
      number: string;
      title: string;
      href: string;
      profitPercent: string | null;
      rows: CheckRow[];
    }
  | {
      type: "costs";
      period: string;
      currency: string;
      total: string;
      calls: number;
      byTask: Array<{ label: string; cost: string; calls: number }>;
      byAgent: Array<{ label: string; cost: string; calls: number }>;
    }
  | { type: "requests"; count: number; what: string; href: string }
  | { type: "rule"; ruleId: string; text: string; scope: string }
  | {
      type: "facts";
      title: string;
      rows: Array<{ label: string; value: string; href?: string | null }>;
    }
  | { type: "help"; rows: ReadonlyArray<{ say: string; does: string }> };

export type CardStatus = "PROPOSED" | "APPLIED" | "CANCELLED";

export const CARD_STATUS_TEXT: Record<CardStatus, string> = {
  PROPOSED: "Waiting for you",
  APPLIED: "Applied",
  CANCELLED: "Cancelled",
};
