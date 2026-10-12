"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import {
  requireAnyPermission,
  requireCompanyForTerms,
  requirePermission,
} from "@/modules/auth/context";
import * as terms from "@/modules/hr/terms.service";

/*
 * Terms of employment Server Actions: HR writes and publishes the terms and
 * sees who has agreed; staff read them and agree on the terms screen, which
 * works before they have agreed (requireCompanyForTerms). Each returns
 * { ok: true, data } or { ok: false, error }. Changes refresh the screens.
 */

const change = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const result = await work();
    revalidatePath("/", "layout");
    return result;
  });

const hrRead = () => requireAnyPermission("hr.view", "hr.manage", "hr.payroll");
const hrManage = () => requirePermission("hr.manage");

// --- HR ------------------------------------------------------------------------------------
export const getTermsScreenAction = async (query: { version?: unknown } = {}) =>
  runAction(async () => terms.getTermsScreen(await hrRead(), query));
export const startTermsDraftAction = async () =>
  change(async () => terms.startTermsDraft(await hrManage(), await getRequestMeta()));
export const saveTermsDraftAction = async (input: unknown) =>
  change(async () => terms.saveTermsDraft(await hrManage(), input, await getRequestMeta()));
export const discardTermsDraftAction = async () =>
  change(async () => terms.discardTermsDraft(await hrManage(), await getRequestMeta()));
export const publishTermsAction = async (input: unknown) =>
  change(async () => terms.publishTerms(await hrManage(), input, await getRequestMeta()));
export const remakeTermsPdfAction = async (acceptanceId: string) =>
  change(async () => terms.remakeTermsPdf(await hrManage(), acceptanceId, await getRequestMeta()));

// --- Staff: the terms screen -----------------------------------------------------------------
export const getTermsGateAction = async () =>
  runAction(async () => terms.getTermsGate(await requireCompanyForTerms()));
export const sendTermsCodeAction = async () =>
  runAction(async () => terms.sendTermsCode(await requireCompanyForTerms()));
export const agreeToTermsAction = async (input: unknown) =>
  change(async () =>
    terms.agreeToTerms(await requireCompanyForTerms(), input, await getRequestMeta()),
  );
