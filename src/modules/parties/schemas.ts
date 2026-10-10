import {
  BuyerType,
  MessageChannel,
  PartyGrade,
  PartyKind,
  PartyStatus,
  SupplierCategory,
} from "@prisma/client";
import { z } from "zod";

import { queryBoolean } from "@/lib/query-params";

const optionalText = (max: number) => z.string().trim().max(max).nullish();
const phone = z
  .string()
  .trim()
  .max(30)
  .regex(/^[+0-9 ()-]*$/, "Use digits, spaces, +, - or brackets")
  .nullish();

/** In the order they are shown. */
export const SUPPLIER_CATEGORIES: SupplierCategory[] = ["FABRIC", "ACCESSORIES", "FOB", "CM"];

const partyFields = {
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{0,29}$/, "Use letters, numbers and dashes")
    .optional(),
  kind: z.enum(PartyKind),
  buyerType: z.enum(BuyerType).nullish(),
  name: z.string().trim().min(2).max(160),
  contactPerson: optionalText(120),
  phone,
  whatsapp: phone,
  email: z
    .email()
    .nullish()
    .or(z.literal("").transform(() => null)),
  address: optionalText(500),
  city: optionalText(80),
  country: optionalText(80),
  taxId: optionalText(60),
  grade: z.enum(PartyGrade).nullish(),
  creditLimit: z.number().min(0).max(10_000_000_000).nullish(),
  paymentTermsDays: z.number().int().min(0).max(365).nullish(),
  notes: optionalText(4000),
  customFields: z.record(z.string(), z.unknown()).nullish(),
  /** What a supplier supplies, any number of them (none for buyers). */
  supplierCategories: z
    .array(z.enum(SupplierCategory))
    .max(4)
    .transform((list) => SUPPLIER_CATEGORIES.filter((c) => list.includes(c)))
    .optional(),
};

export const createPartySchema = z.object(partyFields).superRefine((v, ctx) => {
  if (v.kind === "SUPPLIER" && v.buyerType) {
    ctx.addIssue({ code: "custom", path: ["buyerType"], message: "Suppliers have no buyer type" });
  }
  if (v.kind === "BUYER" && v.supplierCategories?.length) {
    ctx.addIssue({
      code: "custom",
      path: ["supplierCategories"],
      message: "Buyers have no supplier categories",
    });
  }
});

export const updatePartySchema = z.object(partyFields).omit({ code: true }).partial();

export const listPartiesSchema = z.object({
  kind: z.enum(["BUYER", "SUPPLIER"]).optional(), // BOTH parties appear in either list
  buyerType: z.enum(BuyerType).optional(),
  grade: z.enum(PartyGrade).optional(),
  status: z.enum(PartyStatus).optional(),
  /** Suppliers of this category. */
  category: z.enum(SupplierCategory).optional(),
  verified: queryBoolean.optional(),
  city: z.string().trim().max(80).optional(),
  search: z.string().trim().max(100).optional(),
  withBalance: queryBoolean.optional(),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(200).optional(),
});

export const gradeSchema = z.object({ grade: z.enum(PartyGrade).nullable() });
export const verifySchema = z.object({ isVerified: z.boolean() });
export const statusSchema = z.object({
  status: z.enum(PartyStatus),
  reason: z.string().trim().max(500).optional(),
});

export const openingBalanceSchema = z.object({
  /** Positive: they owe us (receivable). Negative: we owe them (payable). */
  amount: z.number().min(-10_000_000_000).max(10_000_000_000),
  asOf: z.coerce.date().optional(),
});

/** A calendar day ("2026-02-28", whole day in company time) or an exact timestamp. */
const dayOrInstant = z.union([z.date(), z.iso.date(), z.iso.datetime({ offset: true })]);

export const statementSchema = z.object({
  from: dayOrInstant.optional(),
  to: dayOrInstant.optional(),
});

export const dormantQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(60).optional(),
  buyerTypes: z
    .union([z.array(z.enum(BuyerType)), z.string().transform((s) => s.split(","))])
    .pipe(z.array(z.enum(BuyerType)))
    .optional(),
});

export const createCampaignSchema = z.object({
  name: z.string().trim().min(2).max(120),
  inactivityMonths: z.number().int().min(1).max(60),
  channel: z.enum(MessageChannel).refine((c) => c === "WHATSAPP" || c === "EMAIL" || c === "SMS", {
    message: "Campaigns go out by WhatsApp, Email or SMS",
  }),
  /** Supports {BuyerName}, {ContactPerson}, {CompanyName} and {CatalogLink}. */
  message: z.string().trim().min(5).max(2000),
  catalogFileUrl: z.url().nullish(),
  /** Explicit recipients; defaults to every dormant wholesale / B2B buyer. */
  partyIds: z.array(z.string()).min(1).max(5000).optional(),
});

export const recipientStatusSchema = z.object({
  status: z.enum(["SENT", "DELIVERED", "READ", "FAILED"]),
  error: z.string().trim().max(500).optional(),
  responded: z.boolean().optional(),
});
