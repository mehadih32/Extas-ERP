import type { Company } from "@prisma/client";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { slugify } from "@/lib/slug";
import { ensureAccountsSetup } from "@/modules/accounts/setup";
import { recordAudit } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { setSessionCompany, type ValidSession } from "@/modules/auth/session.service";
import { resolveCompanyAccess } from "@/modules/companies/access";
import { ensureHrSetup } from "@/modules/hr/setup";
import { ensureSystemRoles } from "@/modules/rbac/role.service";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #0B3D2E");

/** Whether the server can work in this time zone ("Asia/Dhaka"); every report and day uses it. */
export function isKnownTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The zone's own spelling ("asia/dhaka" is kept as "Asia/Dhaka"). */
const canonicalTimeZone = (value: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: value }).resolvedOptions().timeZone;

const text = (max: number) => z.string().trim().max(max, `Use at most ${max} characters`);
const wholeNumber = z.number("Enter a number").int("Enter a whole number");

export const companyProfileSchema = z.object({
  name: z.string().trim().min(2, "Enter the company name").max(120, "Use at most 120 characters"),
  legalName: text(200).nullish(),
  logoUrl: text(500).nullish(),
  address: text(500).nullish(),
  phone: text(50).nullish(),
  email: z.email("Enter a valid email address").nullish(),
  website: text(200).nullish(),
  letterheadFooter: text(500).nullish(),
  primaryColor: hexColor.optional(),
  accentColor: hexColor.optional(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a three-letter currency code such as BDT")
    .optional(),
  timezone: z
    .string()
    .trim()
    .max(60)
    .refine(isKnownTimeZone, "Choose a time zone from the list, such as Asia/Dhaka")
    .transform(canonicalTimeZone)
    .optional(),
  lowStockThreshold: wholeNumber
    .min(0, "Use 0 or more")
    .max(100000, "Use at most 100000")
    .optional(),
  defaultAdvancePercent: z
    .number("Enter a number")
    .min(0, "Use a percentage from 0 to 100")
    .max(100, "Use a percentage from 0 to 100")
    .optional(),
  dormantAfterMonths: wholeNumber
    .min(1, "Use 1 to 60 months")
    .max(60, "Use 1 to 60 months")
    .optional(),
  /** Month the financial year starts in (7 = July, the Bangladesh income year). */
  fiscalYearStartMonth: wholeNumber.min(1, "Choose a month").max(12, "Choose a month").optional(),
});

export const createCompanySchema = companyProfileSchema.extend({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and dashes")
    .max(60)
    .optional(),
});

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  for (let i = 2; await prisma.company.findUnique({ where: { slug } }); i++) {
    slug = `${base}-${i}`;
  }
  return slug;
}

/**
 * Creates a company with the built-in roles and makes the creator its
 * Super Admin. Platform owner only (checked by the caller).
 */
export async function createCompany(
  actor: { userId: string },
  rawInput: unknown,
  meta: RequestMeta = {},
): Promise<Company> {
  const input = createCompanySchema.parse(rawInput);
  const slug = input.slug ?? (await uniqueSlug(slugify(input.name, "company")));
  if (input.slug && (await prisma.company.findUnique({ where: { slug } }))) {
    throw new AppError("CONFLICT", "That company short name is already taken.");
  }

  return prisma.$transaction(async (tx) => {
    const company = await tx.company.create({ data: { ...input, slug } });
    const roles = await ensureSystemRoles(company.id, tx);
    await ensureAccountsSetup(company.id, tx);
    await ensureHrSetup(company.id, tx);
    await tx.companyMembership.create({
      data: { companyId: company.id, userId: actor.userId, roleId: roles.SUPER_ADMIN },
    });
    await recordAudit(
      {
        companyId: company.id,
        userId: actor.userId,
        action: "CREATE",
        entityType: "Company",
        entityId: company.id,
        summary: `Created company "${company.name}"`,
        meta,
      },
      tx,
    );
    return company;
  });
}

export async function getCompanyProfile(ctx: CompanyContext): Promise<Company> {
  return ctx.company;
}

/** The company settings screen's copy of the profile, with the letterhead logo if there is one. */
export async function getCompanyDetails(ctx: CompanyContext) {
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: ctx.company.id },
    include: { logoFile: { select: { id: true, fileName: true } } },
  });
  return {
    name: company.name,
    legalName: company.legalName,
    address: company.address,
    phone: company.phone,
    email: company.email,
    website: company.website,
    letterheadFooter: company.letterheadFooter,
    primaryColor: company.primaryColor,
    accentColor: company.accentColor,
    currency: company.currency,
    timezone: company.timezone,
    lowStockThreshold: company.lowStockThreshold,
    defaultAdvancePercent: company.defaultAdvancePercent.toString(),
    dormantAfterMonths: company.dormantAfterMonths,
    fiscalYearStartMonth: company.fiscalYearStartMonth,
    /** The uploaded logo; its id changes with every upload, so it can version the image link. */
    logo: company.logoFile,
  };
}

export type CompanyDetails = Awaited<ReturnType<typeof getCompanyDetails>>;

export async function updateCompanyProfile(
  ctx: CompanyContext,
  rawInput: unknown,
  meta: RequestMeta = {},
): Promise<Company> {
  const input = companyProfileSchema.partial().parse(rawInput);
  const before = ctx.company;
  const updated = await prisma.company.update({ where: { id: before.id }, data: input });
  const changed = Object.keys(input) as Array<keyof typeof input>;
  await recordAudit({
    companyId: before.id,
    userId: ctx.user.id,
    action: "UPDATE",
    entityType: "Company",
    entityId: before.id,
    summary: `Updated company settings: ${changed.join(", ")}`,
    before: Object.fromEntries(changed.map((k) => [k, String(before[k] ?? "")])),
    after: Object.fromEntries(changed.map((k) => [k, String(updated[k] ?? "")])),
    meta,
  });
  return updated;
}

/** Company switcher: re-checks access, then points this session at the new company. */
export async function switchCompany(
  current: ValidSession,
  companyId: string,
  meta: RequestMeta = {},
) {
  const access = await resolveCompanyAccess(current.user, companyId);
  if (!access) throw new AppError("FORBIDDEN", "You do not have access to that company.");

  await setSessionCompany(current.session.id, companyId);
  await prisma.user.update({ where: { id: current.user.id }, data: { lastCompanyId: companyId } });
  await recordAudit({
    companyId,
    userId: current.user.id,
    action: "COMPANY_SWITCH",
    entityType: "Session",
    entityId: current.session.id,
    summary: `Switched to ${access.company.name}`,
    meta,
  });
  return {
    company: { id: access.company.id, name: access.company.name, slug: access.company.slug },
    role: access.role,
    permissions: [...access.permissions],
  };
}
