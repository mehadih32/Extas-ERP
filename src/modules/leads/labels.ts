import type {
  LeadActivityKind,
  LeadCategory,
  LeadNextKind,
  LeadSampleStatus,
  LeadSourceKind,
  LeadStage,
  LeadSuppressionKind,
  LeadSuppressionReason,
  TradePayment,
} from "@prisma/client";

/*
 * The words the Leads screens show for each choice (plain data: the screens and
 * the server both read them).
 */

export const STAGE_LABELS: Record<LeadStage, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  IN_TALKS: "In talks",
  SAMPLING: "Sampling",
  QUOTED: "Quoted",
  WON: "Won",
  LOST: "Lost",
  NURTURE: "Nurture",
};

export const STAGE_ORDER: readonly LeadStage[] = [
  "NEW",
  "CONTACTED",
  "IN_TALKS",
  "SAMPLING",
  "QUOTED",
  "WON",
  "LOST",
  "NURTURE",
];

export const CATEGORY_LABELS: Record<LeadCategory, string> = {
  BRAND: "Brand",
  IMPORTER: "Importer",
  WHOLESALER: "Wholesaler",
  SOURCING_AGENT: "Sourcing agent",
  RETAIL_CHAIN: "Retail chain",
  CORPORATE_UNIFORM: "Corporate uniform",
  PROMOTIONAL: "Promotional wear",
  OTHER: "Other",
};

export const NEXT_KIND_LABELS: Record<LeadNextKind, string> = {
  EMAIL: "Email",
  CALL: "Call",
  MEETING: "Meeting",
  SAMPLE: "Sample",
  QUOTE: "Quotation",
  OTHER: "Other",
};

export const ACTIVITY_LABELS: Record<LeadActivityKind, string> = {
  NOTE: "Note",
  CALL: "Call",
  MEETING: "Meeting",
  FAIR_MEETING: "Met at a fair",
  EMAIL_OUT: "Email sent",
  EMAIL_IN: "Email received",
  WHATSAPP: "WhatsApp",
  SAMPLE: "Sample",
  STAGE: "Stage",
  ASSIGN: "Given to",
  NEXT_STEP: "Next step",
  CONTACT: "Contact",
  FILE: "File",
  CONVERT: "Buyer",
  ERASE: "Erased",
  EDIT: "Details",
};

export const SAMPLE_STATUS_LABELS: Record<LeadSampleStatus, string> = {
  REQUESTED: "Requested",
  IN_MAKING: "In making",
  DISPATCHED: "Sent",
  FEEDBACK: "Feedback in",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export const SOURCE_KIND_LABELS: Record<LeadSourceKind, string> = {
  TRADE_FAIR: "Trade fair",
  REFERRAL: "Referral",
  SHIPMENT_DATA: "Shipment data",
  LINKEDIN: "LinkedIn",
  WEBSITE: "Website",
  MARKETPLACE: "Marketplace",
  COLD_RESEARCH: "Own research",
  EXISTING_NETWORK: "Existing network",
  OTHER: "Other",
};

export const PAYMENT_LABELS: Record<TradePayment, string> = {
  TT: "TT",
  BANK_TRANSFER: "Bank transfer",
  LC: "LC",
};

export const SUPPRESSION_KIND_LABELS: Record<LeadSuppressionKind, string> = {
  EMAIL: "Email address",
  DOMAIN: "Whole email domain",
  PHONE: "Phone or WhatsApp",
};

export const SUPPRESSION_REASON_LABELS: Record<LeadSuppressionReason, string> = {
  ASKED: "Asked not to be contacted",
  ERASED: "Personal data erased",
  OWNER: "Owner's decision",
};
