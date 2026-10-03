"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import {
  requireCompany,
  requirePermission,
  requirePlatformSuperAdmin,
} from "@/modules/auth/context";
import {
  createCompany,
  getCompanyDetails,
  updateCompanyProfile,
} from "@/modules/companies/company.service";
import { removeCompanyLogo, uploadCompanyLogo } from "@/modules/companies/logo.service";
import { fileFromForm } from "@/modules/files/file.service";

/** Platform owner only: adds a new business entity (e.g. "Fabric Apparel"). */
export async function createCompanyAction(input: unknown) {
  return runAction(async () => {
    const { user } = await requirePlatformSuperAdmin();
    return createCompany({ userId: user.id }, input, await getRequestMeta());
  });
}

/** The company's details for the settings screen: anyone in the company may read them. */
export async function getCompanyDetailsAction() {
  return runAction(async () => {
    const ctx = await requireCompany();
    return { details: await getCompanyDetails(ctx), canEdit: ctx.can("company.settings") };
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

/** The letterhead logo: a form with a `file` field (PNG or JPG, up to 2 MB). */
export async function uploadCompanyLogoAction(form: FormData) {
  return runAction(async () => {
    const ctx = await requirePermission("company.settings");
    const logo = await uploadCompanyLogo(ctx, await fileFromForm(form), await getRequestMeta());
    revalidatePath("/", "layout");
    return logo;
  });
}

export async function removeCompanyLogoAction() {
  return runAction(async () => {
    const ctx = await requirePermission("company.settings");
    const result = await removeCompanyLogo(ctx, await getRequestMeta());
    revalidatePath("/", "layout");
    return result;
  });
}
