"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { morningBrief } from "@/modules/ai/briefs";
import * as health from "@/modules/ai/health/health.service";
import * as orders from "@/modules/ai/orders/order-run.service";
import * as settings from "@/modules/ai/settings.service";
import { requireAnyPermission, requireCompany, requirePermission } from "@/modules/auth/context";
import { fileFromForm } from "@/modules/files/file.service";

/*
 * Order automation, the daily notes and Server Health (AI Center > Orders,
 * AI Home, Settings, Server Health; "Tell AI" on My HR and Production). Each returns
 * { ok: true, data } or { ok: false, error }.
 *   ai.view        see the orders and the morning brief
 *   ai.manage      give new orders, read the files, make the costing sheet and
 *                  the plan, Approve or Return, the daily notes on or off
 *   portal.self, production.view/manage   tell the AI what happened
 *   platform owner Server Health (checks, fixes, the weekly run)
 */

const view = () => requireAnyPermission("ai.view", "ai.manage");
const manage = () => requirePermission("ai.manage");

const change = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const out = await work();
    revalidatePath("/", "layout");
    return out;
  });

// ---------------------------------------------------------------- orders

export const listOrderRunsAction = async () => runAction(async () => orders.listRuns(await view()));

export const getOrderRunAction = async (runId: string) =>
  runAction(async () => orders.getRun(await view(), runId));

export const createOrderRunAction = async (input: unknown) =>
  change(async () => orders.createRun(await manage(), input, await getRequestMeta()));

export const updateOrderRunAction = async (runId: string, input: unknown) =>
  change(async () => orders.updateRun(await manage(), runId, input, await getRequestMeta()));

/** A PO, order sheet or photo: a form with a `file` field (JPG, PNG, WebP or PDF, 10 MB). */
export async function attachOrderFileAction(runId: string, form: FormData) {
  return change(async () => {
    const ctx = await manage();
    const file = await orders.attachFile(
      ctx,
      runId,
      await fileFromForm(form),
      await getRequestMeta(),
    );
    return { id: file.id, fileName: file.fileName };
  });
}

export const removeOrderFileAction = async (runId: string, fileId: string) =>
  change(async () => orders.removeFile(await manage(), runId, fileId));

export const readOrderFilesAction = async (runId: string) =>
  change(async () => orders.readFiles(await manage(), runId));

export const makeOrderCostingAction = async (runId: string, input: unknown) =>
  change(async () => {
    const costing = await orders.makeCosting(await manage(), runId, input, await getRequestMeta());
    return { id: costing.id, number: costing.number };
  });

export const makeOrderPlanAction = async (runId: string, input: unknown) =>
  change(async () => orders.makePlan(await manage(), runId, input, await getRequestMeta()));

export const decideOrderRunAction = async (runId: string, input: unknown) =>
  change(async () => orders.decideRun(await manage(), runId, input, await getRequestMeta()));

export const closeOrderRunAction = async (runId: string, input: unknown) =>
  change(async () => orders.closeRun(await manage(), runId, input, await getRequestMeta()));

export const linkOrderSalesAction = async (runId: string, input: unknown) =>
  change(async () => orders.linkSalesOrder(await manage(), runId, input, await getRequestMeta()));

// ---------------------------------------------------------------- Tell AI (My HR, Production)

export const ordersForStaffAction = async () =>
  runAction(async () => orders.ordersForStaff(await requireCompany()));

export const tellAiAction = async (input: unknown) =>
  change(async () => orders.tellAi(await requireCompany(), input, await getRequestMeta()));

// ---------------------------------------------------------------- daily notes

export const getMorningBriefAction = async () =>
  runAction(async () => {
    const ctx = await view();
    return morningBrief(ctx.company);
  });

export const setDailyNotesAction = async (input: unknown) =>
  change(async () => settings.setDailyNotes(await manage(), input, await getRequestMeta()));

// ---------------------------------------------------------------- Server Health

export const getServerHealthAction = async () =>
  runAction(async () => health.getServerHealth(await requireCompany()));

export const checkServerNowAction = async () =>
  change(async () => health.checkNow(await requireCompany(), await getRequestMeta()));

export const applyHealthFixAction = async (runId: string, input: unknown) =>
  change(async () => health.applyFix(await requireCompany(), runId, input, await getRequestMeta()));

export const setWeeklyHealthAction = async (input: unknown) =>
  change(async () => health.setWeekly(await requireCompany(), input, await getRequestMeta()));
