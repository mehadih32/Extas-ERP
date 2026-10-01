"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requirePermission, requirePlatformSuperAdmin } from "@/modules/auth/context";
import { createCompany, updateCompanyProfile } from "@/modules/companies/company.service";

/** Platform owner only: adds a new business entity (e.g. "Fabric Apparel"). */
export async function createCompanyAction(input: unknown) {
  return runAction(async () => {
    const { user } = await requirePlatformSuperAdmin();
    return createCompany({ userId: user.id }, input, await getRequestMeta());
  });
}

export async function updateCompanyProfileAction(input: unknown) {
  return runAction(async () => {
    const ctx = await requirePermission("company.settings");
    const company = await updateCompanyProfile(ctx, input, await getRequestMeta());
    revalidatePath("/", "layout");
    return company;
  });
}
