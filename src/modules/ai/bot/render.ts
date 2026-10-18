import { createHash } from "node:crypto";

import type { CardStatus, ChatCard } from "../chat/cards";
import { countOf } from "@/lib/display";

/*
 * Chat cards as bot messages: plain text (no markup to escape) and rows of
 * buttons. A button carries a short code (at most 64 bytes on Telegram):
 *   ap:<message>  Apply a change card      cx:<message>  Cancel it
 *   sd:<draft>:<version>  Send a draft as shown   dd:<draft>    Discard it
 *   hr:<rule>:y|n Approve or reject a House Rule
 *   pr:<request>:ONCE|TODAY|ALWAYS|REFUSED  answer a permission request
 *   dr:<request>:y|n                        answer a Deletion request
 *   bg:<finding>:f|i|l   Bug Guard: Fix, Ignore, Remind me later
 *   bg:run:<company>     Bug Guard: Run now
 *   bc:<correction>:a|x|u  Bug Guard: Apply, Cancel or Undo a correction
 * Pure: no database and no network. A Send button carries the draft's
 * version (draftVersion), so a draft changed after the message showed it is
 * never sent from that message (v6.4.1).
 */

export type BotButton = { label: string; data: string };

export type BotOut = {
  text: string;
  buttons: BotButton[][];
  /** A report to send as a file with the text. */
  exportId?: string;
};

/** Telegram takes up to 4096 characters a message; WhatsApp 4096 too. */
export const MAX_TEXT = 3900;

export const clip = (text: string, max = MAX_TEXT) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const DOTS = { green: "🟢", yellow: "🟡", red: "🔴" } as const;

const link = (appUrl: string, href: string | null | undefined) =>
  href ? (href.startsWith("http") ? href : `${appUrl.replace(/\/$/, "")}${href}`) : null;

/** One answer of the chat (its words and its card) as a bot message. */
export function renderAnswer(
  answer: { id: string; text: string; card: ChatCard | null; cardStatus: CardStatus | null },
  appUrl: string,
): BotOut {
  const card = answer.card;
  const words = answer.text.trim();
  if (!card) return { text: clip(words || "Done."), buttons: [] };
  const shown = renderCard(card, { messageId: answer.id, status: answer.cardStatus, appUrl });
  return {
    ...shown,
    text: clip([words, shown.text].filter(Boolean).join("\n\n")),
  };
}

export function renderCard(
  card: ChatCard,
  at: { messageId: string; status: CardStatus | null; appUrl: string },
): BotOut {
  switch (card.type) {
    case "change": {
      const lines = card.lines.map(
        (l) => `• ${l.label}: ${l.before ? `${l.before} → ` : ""}${l.after}`,
      );
      const open = at.status === null || at.status === "PROPOSED";
      return {
        text: [
          `${card.title} (${card.page})`,
          ...lines,
          open ? "" : at.status === "APPLIED" ? "Applied." : "Cancelled.",
        ]
          .filter(Boolean)
          .join("\n"),
        buttons: open
          ? [
              [
                { label: "Apply", data: `ap:${at.messageId}` },
                { label: "Cancel", data: `cx:${at.messageId}` },
              ],
            ]
          : [],
      };
    }
    case "draft":
      return renderDraft(card);
    case "report":
      return {
        text: `${card.title} · ${card.range}${card.emailed ? `\nEmailed to ${card.emailed}.` : ""}`,
        buttons: [],
        exportId: card.exportId,
      };
    case "check":
      return {
        text: [
          `Order check: ${card.number} ${card.title}`,
          ...card.rows.map((r) => `${DOTS[r.signal]} ${r.label}: ${r.reason}`),
          `Profit: ${card.profitPercent ? `${card.profitPercent}%` : "not set yet (yours to set)"}`,
          link(at.appUrl, card.href) ?? "",
        ]
          .filter(Boolean)
          .join("\n"),
        buttons: [],
      };
    case "costs":
      return {
        text: [
          `${card.period}: ${card.currency} ${card.total} for ${countOf(card.calls, "AI call")}`,
          ...card.byTask.map((t) => `• ${t.label}: ${card.currency} ${t.cost} (${t.calls})`),
        ].join("\n"),
        buttons: [],
      };
    case "requests":
      return {
        text: `${card.count} ${card.what}${card.count > 1 ? "s" : ""} waiting for you. ${link(at.appUrl, card.href)}`,
        buttons: [],
      };
    case "rule":
      return {
        text: `House Rule proposal: ${card.text}\nFor: ${card.scope}`,
        buttons: [
          [
            { label: "Approve", data: `hr:${card.ruleId}:y` },
            { label: "Reject", data: `hr:${card.ruleId}:n` },
          ],
        ],
      };
    case "facts":
      return {
        text: [card.title, ...card.rows.map((r) => `• ${r.label}: ${r.value}`)].join("\n"),
        buttons: [],
      };
    case "help":
      // The answer's own words already say "You can say:".
      return { text: card.rows.map((r) => `• ${r.say}\n   ${r.does}`).join("\n"), buttons: [] };
  }
}

/** A short mark of what a draft says and where it goes: it changes when any of them changes. */
export function draftVersion(draft: { subject: string; to: string | null; body: string }) {
  return createHash("sha256")
    .update(JSON.stringify([draft.subject, draft.to ?? "", draft.body]))
    .digest("hex")
    .slice(0, 12);
}

/** A draft with its Send and Discard buttons (Send only with an address to send to). */
export function renderDraft(draft: {
  draftId: string;
  subject: string;
  to: string | null;
  party: string | null;
  forBuyer: boolean;
  body: string;
}): BotOut {
  const head = [
    `Draft${draft.forBuyer ? " for the buyer" : ""}${draft.party ? `: ${draft.party}` : ""}`,
    `To: ${draft.to ?? "no address yet (add it in AI Center > Drafts)"}`,
    `Subject: ${draft.subject}`,
  ].join("\n");
  return {
    text: clip(`${head}\n\n${draft.body}`),
    buttons: [
      [
        ...(draft.to
          ? [{ label: "Send", data: `sd:${draft.draftId}:${draftVersion(draft)}` }]
          : []),
        { label: "Discard", data: `dd:${draft.draftId}` },
      ],
    ],
  };
}

export type ButtonPress =
  | { kind: "apply" | "cancel"; messageId: string }
  /** version: the draft as the message showed it (draftVersion); none on a button made before v6.4.1. */
  | { kind: "send"; draftId: string; version?: string }
  | { kind: "discard"; draftId: string }
  | { kind: "rule"; ruleId: string; approve: boolean }
  | { kind: "permission"; requestId: string; answer: "ONCE" | "TODAY" | "ALWAYS" | "REFUSED" }
  | { kind: "deletion"; requestId: string; approve: boolean }
  | { kind: "guard"; findingId: string; choice: "fix" | "ignore" | "later" }
  | { kind: "guard-run"; companyId: string }
  | { kind: "guard-correction"; correctionId: string; choice: "apply" | "cancel" | "undo" }
  /** The owner wrote "unlock" (v6.4.1 B5): never a button, so readButton never makes it. */
  | { kind: "unlock"; companyId: string };

const GUARD_CHOICE = { f: "fix", i: "ignore", l: "later" } as const;
const CORRECTION_CHOICE = { a: "apply", x: "cancel", u: "undo" } as const;

const ID = "[a-z0-9]{10,40}";

/** Reads a button's code back; anything else is null. */
export function readButton(data: string): ButtonPress | null {
  let m = new RegExp(`^(ap|cx):(${ID})$`).exec(data);
  if (m) return { kind: m[1] === "ap" ? "apply" : "cancel", messageId: m[2]! };
  m = new RegExp(`^sd:(${ID})(?::([a-f0-9]{12}))?$`).exec(data);
  if (m) return { kind: "send", draftId: m[1]!, ...(m[2] ? { version: m[2] } : {}) };
  m = new RegExp(`^dd:(${ID})$`).exec(data);
  if (m) return { kind: "discard", draftId: m[1]! };
  m = new RegExp(`^hr:(${ID}):(y|n)$`).exec(data);
  if (m) return { kind: "rule", ruleId: m[1]!, approve: m[2] === "y" };
  m = new RegExp(`^pr:(${ID}):(ONCE|TODAY|ALWAYS|REFUSED)$`).exec(data);
  if (m) {
    return {
      kind: "permission",
      requestId: m[1]!,
      answer: m[2] as "ONCE" | "TODAY" | "ALWAYS" | "REFUSED",
    };
  }
  m = new RegExp(`^dr:(${ID}):(y|n)$`).exec(data);
  if (m) return { kind: "deletion", requestId: m[1]!, approve: m[2] === "y" };
  m = new RegExp(`^bg:run:(${ID})$`).exec(data);
  if (m) return { kind: "guard-run", companyId: m[1]! };
  m = new RegExp(`^bg:(${ID}):(f|i|l)$`).exec(data);
  if (m) return { kind: "guard", findingId: m[1]!, choice: GUARD_CHOICE[m[2] as "f" | "i" | "l"] };
  m = new RegExp(`^bc:(${ID}):(a|x|u)$`).exec(data);
  if (m) {
    return {
      kind: "guard-correction",
      correctionId: m[1]!,
      choice: CORRECTION_CHOICE[m[2] as "a" | "x" | "u"],
    };
  }
  return null;
}

/** A permission request as a bot message with its four answers. */
export function renderPermission(request: {
  id: string;
  task: string;
  why: string | null;
  path: string;
}): BotOut {
  return {
    text: `Permission request: ${request.task}\n${request.path}${request.why ? `\nWhy: ${request.why}` : ""}`,
    buttons: [
      [
        { label: "Only this task", data: `pr:${request.id}:ONCE` },
        { label: "For today", data: `pr:${request.id}:TODAY` },
      ],
      [
        { label: "Always", data: `pr:${request.id}:ALWAYS` },
        { label: "No", data: `pr:${request.id}:REFUSED` },
      ],
    ],
  };
}

/** A Deletion request as a bot message: the owner approves (with the PIN) or refuses it. */
export function renderDeletion(request: {
  id: string;
  what: string;
  why: string;
  ifKept: string;
}): BotOut {
  return {
    text: `Deletion request: ${request.what}\nWhy: ${request.why}\nIf it is kept: ${request.ifKept}\nApproving (with your PIN) deletes it (cancels it) in your name, with its page's checks.`,
    buttons: [
      [
        { label: "Approve", data: `dr:${request.id}:y` },
        { label: "Refuse", data: `dr:${request.id}:n` },
      ],
    ],
  };
}
