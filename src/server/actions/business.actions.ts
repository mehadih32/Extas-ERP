"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireCompany } from "@/modules/auth/context";
import * as b2b from "@/modules/business/b2b.service";

/*
 * Business > B2B (2026-11-12): what finding new wholesale buyers costs. Seeing it
 * and setting its budget need the right to see the financials, as Business >
 * Overview: checked in the service.
 */

export async function b2bPageAction(query: { month?: unknown } = {}) {
  return runAction(async () => b2b.b2bPage(await requireCompany(), query));
}

export async function setB2bBudgetAction(input: unknown) {
  return runAction(async () => {
    await b2b.setB2bBudget(await requireCompany(), input, await getRequestMeta());
    revalidatePath("/business/b2b");
    return null;
  });
}
