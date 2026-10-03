import { ComplianceType } from "@prisma/client";
import { z } from "zod";

import { queryBoolean } from "@/lib/query-params";

const day = z.iso.date();
const text = (max: number) => z.string().trim().max(max).nullish();
const someField = (v: Record<string, unknown>) => Object.values(v).some((x) => x !== undefined);

const STATUSES = ["VALID", "EXPIRING", "EXPIRED", "NO_EXPIRY", "SUPERSEDED", "ARCHIVED"] as const;

const fields = {
  type: z.enum(ComplianceType),
  /** Defaults to the type's name ("Trade licence"); e.g. "Trade licence (Gazipur factory)". */
  title: z.string().trim().min(2).max(200).optional(),
  /** Licence, BIN or TIN number. */
  number: text(100),
  issuingAuthority: text(200),
  issueDate: day.nullish(),
  /** Empty for records that never expire (e.g. a TIN). */
  expiryDate: day.nullish(),
  /** Renewal alerts start this many days before the expiry date. */
  alertDaysBefore: z.number().int().min(0).max(365).optional(),
  notes: text(2000),
};

const issueBeforeExpiry = (
  v: { issueDate?: string | null; expiryDate?: string | null },
  ctx: z.RefinementCtx,
) => {
  if (v.issueDate && v.expiryDate && v.expiryDate < v.issueDate) {
    ctx.addIssue({
      code: "custom",
      path: ["expiryDate"],
      message: "The expiry date is before the issue date",
    });
  }
};

export const createComplianceSchema = z.object(fields).superRefine(issueBeforeExpiry);

export const updateComplianceSchema = z
  .object(fields)
  .partial()
  .refine(someField, "Nothing to change")
  .superRefine(issueBeforeExpiry);

/** The new term of a licence: what changed (the rest is copied from the current one). */
export const renewComplianceSchema = z
  .object({
    expiryDate: day,
    issueDate: day.nullish(),
    number: text(100),
    issuingAuthority: text(200),
    title: z.string().trim().min(2).max(200).optional(),
    alertDaysBefore: z.number().int().min(0).max(365).optional(),
    notes: text(2000),
  })
  .superRefine(issueBeforeExpiry);

export const listComplianceSchema = z.object({
  type: z.enum(ComplianceType).optional(),
  status: z.enum(STATUSES).optional(),
  /** Include renewed (superseded) and archived records. */
  history: queryBoolean.optional(),
  search: z.string().trim().max(100).optional(),
});
