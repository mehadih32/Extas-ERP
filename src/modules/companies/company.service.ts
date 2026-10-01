import type { Company } from "@prisma/client";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { recordAudit } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { setSessionCompany, type ValidSession } from "@/modules/auth/session.service";
import { resolveCompanyAccess } from "@/modules/companies/access";
import { ensureSystemRoles } from "@/modules/rbac/role.service";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #0B3D2E");

export const companyProfileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: z.string().trim().max(200).nullish(),
  logoUrl: z.string().trim().max(500).nullish(),
  address: z.string().trim().max(500).nullish(),
  phone: z.string().trim().max(50).nullish(),
  email: z.email().nullish(),
  website: z.string().trim().max(200).nullish(),
  letterheadFooter: z.string().trim().max(500).nullish(),
  primaryColor: hexColor.optional(),
  accentColor: hexColor.optional(),
  currency: z.string().trim().length(3).optional(),
  timezone: z.string().trim().max(60).optional(),
  lowStockThreshold: z.number().int().min(0).max(100000).optional(),
  defaultAdvancePercent: z.number().min(0).max(100).optional(),
  dormantAfterMonths: z.number().int().min(1).max(60).optional(),
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

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "company"
  );
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  for (let i = 2; await prisma.company.findUnique({ where: { slug } }); i++) {
    slug = `${base}-${i}`;
  }
  return slug;
}

/**
 * Creates a company with the five built-in roles and makes the creator its
 * Super Admin. Platform owner only (checked by the caller).
 */
export async function createCompany(
  actor: { userId: string },
  rawInput: unknown,
  meta: RequestMeta = {},
): Promise<Company> {
  const input = createCompanySchema.parse(rawInput);
  const slug = input.slug ?? (await uniqueSlug(slugify(input.name)));
  if (input.slug && (await prisma.company.findUnique({ where: { slug } }))) {
    throw new AppError("CONFLICT", "That company short name is already taken.");
  }

  return prisma.$transaction(async (tx) => {
    const company = await tx.company.create({ data: { ...input, slug } });
    const roles = await ensureSystemRoles(company.id, tx);
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
