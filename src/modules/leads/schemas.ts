import {
  LeadActivityKind,
  LeadCategory,
  LeadNextKind,
  LeadSampleStatus,
  LeadSourceKind,
  LeadStage,
  LeadSuppressionKind,
  TradePayment,
} from "@prisma/client";
import { z } from "zod";

const id = z.string().min(1);
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const day = z.iso.date();
const optionalDay = z
  .union([day, z.literal("")])
  .nullish()
  .transform((v) => (v ? v : null));
const money = z.number().min(0).max(1_000_000_000).multipleOf(0.01);
const words = z.array(text(60).min(1)).max(30);

/** The first contact on "Add lead", or one more on Lead 360. */
export const contactSchema = z
  .object({
    name: text(120).min(1, "Give the contact's name"),
    jobTitle: optionalText(120),
    email: z
      .union([z.email("Give a full email address").max(200), z.literal("")])
      .nullish()
      .transform((v) => (v ? v.trim().toLowerCase() : null)),
    phone: optionalText(40),
    whatsapp: optionalText(40),
    isPrimary: z.boolean().default(false),
    isDecisionMaker: z.boolean().default(false),
  })
  .strict();

/** The quick "Add lead" form (about 30 seconds at a fair). */
export const addLeadSchema = z
  .object({
    name: text(160).min(2, "Give the company's name"),
    website: optionalText(200),
    country: optionalText(80),
    city: optionalText(80),
    category: z.enum(LeadCategory).default("OTHER"),
    products: words.default([]),
    piecesPerStyle: z.number().int().min(1).max(10_000_000).nullish(),
    targetPrice: money.nullish(),
    expectedValue: money.nullish(),
    paymentTerms: z.enum(TradePayment).nullish(),
    contact: contactSchema.nullish(),
    sourceId: id.nullish(),
    sourceNote: optionalText(300),
    ownerUserId: id.nullish(),
    nextActionOn: optionalDay,
    nextActionKind: z.enum(LeadNextKind).nullish(),
    nextActionNote: optionalText(300),
    /** Saved even though it looks like a lead or buyer already there (after the warning). */
    confirmDuplicate: z.boolean().default(false),
  })
  .strict();

/** The duplicate check while typing. */
export const duplicateCheckSchema = z.object({
  name: text(160).default(""),
  website: optionalText(200),
  country: optionalText(80),
  email: optionalText(200),
  phone: optionalText(40),
  excludeLeadId: id.nullish(),
});

/** Editing a lead's details (not its stage, owner or next step: those have their own). */
export const editLeadSchema = addLeadSchema
  .omit({
    contact: true,
    ownerUserId: true,
    nextActionOn: true,
    nextActionKind: true,
    nextActionNote: true,
    confirmDuplicate: true,
  })
  .partial()
  .extend({ doNotContact: z.boolean().optional() })
  .strict();

export const listLeadsSchema = z.object({
  q: text(100).optional(),
  stage: z.enum(LeadStage).optional(),
  owner: z.union([z.literal("me"), z.literal("none"), id]).optional(),
  sourceId: id.optional(),
  country: text(80).optional(),
  /** Only leads whose next step is today or late. */
  due: z.boolean().optional(),
  /** Archived leads instead of the working ones. */
  archived: z.boolean().optional(),
});

/** Kinds a person logs by hand (the rest the ERP writes itself). */
export const LOGGABLE_KINDS = [
  "NOTE",
  "CALL",
  "MEETING",
  "FAIR_MEETING",
  "EMAIL_OUT",
  "EMAIL_IN",
  "WHATSAPP",
] as const satisfies readonly LeadActivityKind[];

export const logActivitySchema = z
  .object({
    kind: z.enum(LOGGABLE_KINDS),
    summary: text(300).min(2, "Say what happened"),
    body: optionalText(4000),
    contactId: id.nullish(),
    occurredOn: optionalDay,
  })
  .strict();

export const nextStepSchema = z
  .object({
    nextActionOn: day,
    nextActionKind: z.enum(LeadNextKind),
    nextActionNote: optionalText(300),
  })
  .strict();

export const stageSchema = z
  .object({
    stage: z.enum(LeadStage),
    /** Lost needs a reason (price, no reply, MOQ, chose another supplier...). */
    reason: optionalText(300),
    /** Nurture: the day to look at it again. */
    lookAgainOn: optionalDay,
  })
  .strict();

export const assignSchema = z.object({ ownerUserId: id.nullable() }).strict();

export const sampleSchema = z
  .object({
    description: text(300).min(2, "Say what the sample is"),
    quantity: z.number().int().min(1).max(100_000).nullish(),
    status: z.enum(LeadSampleStatus).default("REQUESTED"),
    courier: optionalText(80),
    trackingNo: optionalText(80),
    sentOn: optionalDay,
    feedback: optionalText(2000),
  })
  .strict();

export const sampleUpdateSchema = sampleSchema.partial().strict();

export const contactUpdateSchema = contactSchema.partial().extend({
  doNotContact: z.boolean().optional(),
});

export const sourceSchema = z
  .object({
    name: text(120).min(2, "Give the source a name"),
    kind: z.enum(LeadSourceKind).default("OTHER"),
  })
  .strict();

export const sourceActiveSchema = z.object({ isActive: z.boolean() }).strict();

export const settingsSchema = z
  .object({
    targetCountries: words.default([]),
    riskyCountries: words.default([]),
    productFocus: words.default([]),
    minPieces: z.number().int().min(1).max(10_000_000).nullish(),
    priceMin: money.nullish(),
    priceMax: money.nullish(),
    followUpDays: z.number().int().min(1).max(90).default(7),
  })
  .strict()
  .refine((s) => s.priceMin == null || s.priceMax == null || s.priceMin <= s.priceMax, {
    message: "The lowest price is above the highest",
    path: ["priceMax"],
  });

export const suppressionSchema = z
  .object({
    kind: z.enum(LeadSuppressionKind),
    value: text(200).min(3, "Give the email, domain or phone"),
    note: optionalText(300),
  })
  .strict();

export const eraseSchema = z
  .object({ pin: z.string().optional(), reason: optionalText(300) })
  .strict();

/** "I sent it" after the email or WhatsApp button opened the person's own app. */
export const messageSentSchema = z
  .object({
    channel: z.enum(["EMAIL", "WHATSAPP"]),
    contactId: id,
    subject: text(300).optional(),
  })
  .strict();

/** "Make buyer": a new buyer, or (partyId) a buyer already there. */
export const makeBuyerSchema = z.object({ partyId: id.nullish() }).strict();

export const reportSchema = z.object({
  from: day.optional(),
  to: day.optional(),
});
