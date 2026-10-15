import type { AiDraftKind } from "@prisma/client";

/*
 * The plain drafts Mehedi 2.0 writes while the AI is off or has no key: short,
 * polite English after the K5 templates. The owner edits them before sending.
 * Client-safe: no database, no server code.
 */

export const DRAFT_KINDS = [
  "BUYER_REPLY",
  "BUYER_FOLLOW_UP",
  "BUYER_CHASE",
  "BUYER_CLAIM",
  "QUOTATION",
  "INVOICE",
  "SUPPLIER",
  "FACTORY",
  "OTHER",
] as const satisfies readonly AiDraftKind[];

export const DRAFT_KIND_LABELS: Record<AiDraftKind, string> = {
  BUYER_REPLY: "Reply to a buyer",
  BUYER_FOLLOW_UP: "Follow-up to a buyer",
  BUYER_CHASE: "Payment reminder to a buyer",
  BUYER_CLAIM: "Claim answer to a buyer",
  QUOTATION: "Quotation to a buyer",
  INVOICE: "Invoice to a buyer",
  SUPPLIER: "Message to a supplier or mill",
  FACTORY: "Message to the factory",
  OTHER: "Other message",
};

/** What reaches a buyer: only ever sent by the owner (Send, or "পাঠাও"). */
export const BUYER_KINDS: ReadonlySet<AiDraftKind> = new Set([
  "BUYER_REPLY",
  "BUYER_FOLLOW_UP",
  "BUYER_CHASE",
  "BUYER_CLAIM",
  "QUOTATION",
  "INVOICE",
]);

/** The Control action each kind of message belongs to. */
export const DRAFT_ACTION: Record<AiDraftKind, string | null> = {
  BUYER_REPLY: "ai.buyer.reply",
  BUYER_FOLLOW_UP: "ai.buyer.follow_up",
  BUYER_CHASE: "ai.buyer.chase",
  BUYER_CLAIM: "ai.buyer.claim",
  QUOTATION: "ai.sales.quotation.send",
  INVOICE: "ai.sales.invoice.send",
  SUPPLIER: "ai.production.message.supplier",
  FACTORY: "ai.production.message.factory",
  OTHER: null,
};

export type DraftFacts = {
  kind: AiDraftKind;
  company: string;
  /** The party's contact person, else its name. */
  to: string | null;
  /** What it is about ("PO 4501, 3 polo styles"). */
  about: string | null;
  /** The owner's points, one per line. */
  points: string | null;
  /** "Mehedi 2.0 (AI)". */
  label: string;
};

const SUBJECTS: Record<AiDraftKind, string> = {
  BUYER_REPLY: "Re: {about}",
  BUYER_FOLLOW_UP: "Following up: {about}",
  BUYER_CHASE: "Payment reminder: {about}",
  BUYER_CLAIM: "Your claim: {about}",
  QUOTATION: "Quotation: {about}",
  INVOICE: "Invoice: {about}",
  SUPPLIER: "{about}",
  FACTORY: "{about}",
  OTHER: "{about}",
};

const OPENINGS: Record<AiDraftKind, string> = {
  BUYER_REPLY: "Thank you for your email about {about}.",
  BUYER_FOLLOW_UP: "I hope you are well. I am following up on {about}.",
  BUYER_CHASE:
    "This is a friendly reminder about the payment for {about}. Could you please let us know when it will be made?",
  BUYER_CLAIM:
    "Thank you for letting us know about {about}. We take it seriously. To look into it properly, please send us the photos, the quantities affected and the inspection report.",
  QUOTATION: "Please find our quotation for {about} below.",
  INVOICE: "Please find the invoice for {about}.",
  SUPPLIER: "About {about}:",
  FACTORY: "About {about}:",
  OTHER: "About {about}:",
};

const CLOSINGS: Record<AiDraftKind, string> = {
  BUYER_REPLY: "Please let us know if you need anything else from our side.",
  BUYER_FOLLOW_UP: "Please let us know if you need anything from our side.",
  BUYER_CHASE: "Thank you for your support.",
  BUYER_CLAIM: "We will come back to you as soon as we have checked.",
  QUOTATION: "The prices are valid for 30 days. Please let us know if you have any questions.",
  INVOICE: "Please confirm receipt.",
  SUPPLIER: "Please confirm.",
  FACTORY: "Please confirm.",
  OTHER: "Thank you.",
};

const fill = (text: string, about: string) => text.replaceAll("{about}", about);

/** A plain draft: subject and body, signed by the company and labelled as the AI's. */
export function templateDraft(facts: DraftFacts): { subject: string; body: string } {
  const about = facts.about?.trim() || "your order";
  const points = (facts.points ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const body = [
    `Dear ${facts.to?.trim() || "Sir or Madam"},`,
    "",
    fill(OPENINGS[facts.kind], about),
    ...(points.length > 0 ? ["", ...points.map((p) => (points.length > 1 ? `- ${p}` : p))] : []),
    "",
    CLOSINGS[facts.kind],
    "",
    "Best regards,",
    facts.company,
    "",
    `Drafted by ${facts.label}`,
  ].join("\n");
  return { subject: `${facts.company} | ${fill(SUBJECTS[facts.kind], about)}`.slice(0, 200), body };
}
