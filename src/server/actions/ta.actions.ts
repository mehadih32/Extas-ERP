"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireCompany } from "@/modules/auth/context";
import * as ta from "@/modules/ta/ta.service";

/*
 * The T&A calendar of every order. Each returns { ok: true, data } or
 * { ok: false, error }. The service checks who may do what: sales.view or
 * production.view to see, sales.order.create or production.manage to change a
 * step's day or tick it, company.settings for the template.
 */

const change = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const result = await work();
    revalidatePath("/production/ta-calendar", "layout");
    revalidatePath("/sales/orders", "layout");
    return result;
  });

export const getOrderTaAction = async (orderId: string) =>
  runAction(async () => ta.orderTa(await requireCompany(), orderId));
export const getTaCalendarAction = async (filters: unknown) =>
  runAction(async () => ta.taCalendar(await requireCompany(), filters));
export const getTaTemplateAction = async () =>
  runAction(async () => ta.getTaTemplate(await requireCompany()));

export const changeTaDateAction = async (input: unknown) =>
  change(async () => ta.changeTaDate(await requireCompany(), input, await getRequestMeta()));
export const markTaDoneAction = async (input: unknown) =>
  change(async () => ta.markTaDone(await requireCompany(), input, await getRequestMeta()));
export const saveTaTemplateAction = async (input: unknown) =>
  change(async () => ta.saveTaTemplate(await requireCompany(), input, await getRequestMeta()));
