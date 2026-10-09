"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requirePermission } from "@/modules/auth/context";
import * as files from "@/modules/files/file.service";
import * as advances from "@/modules/hr/advance.service";
import * as attendance from "@/modules/hr/attendance.service";
import * as leave from "@/modules/hr/leave.service";
import * as payroll from "@/modules/hr/payroll.service";
import * as portal from "@/modules/hr/portal.service";
import * as screens from "@/modules/hr/screens.service";
import * as tasks from "@/modules/reminders/task.service";

/*
 * Employee portal Server Actions (portal.self): the signed-in employee's own
 * records only. Each returns { ok: true, data } or { ok: false, error }.
 * Changes refresh the screens.
 */

const self = () => requirePermission("portal.self");

/** Runs a change and refreshes every screen that may show it. */
const change = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const result = await work();
    revalidatePath("/", "layout");
    return result;
  });

// --- Screens ("My HR") -------------------------------------------------------------------
export const getMyHrScreenAction = async () =>
  runAction(async () => screens.getMyHrScreen(await self()));
export const getMyMonthScreenAction = async (query: unknown) =>
  runAction(async () => screens.getMyMonthScreen(await self(), query));
export const getMyLeaveScreenAction = async (query: { year?: unknown } = {}) =>
  runAction(async () => screens.getMyLeaveScreen(await self(), query));
export const getMyPayslipsScreenAction = async () =>
  runAction(async () => screens.getMyPayslipsScreen(await self()));
export const getMyPayslipScreenAction = async (itemId: string) =>
  runAction(async () => screens.getMyPayslipScreen(await self(), itemId));
export const getMyAdvancesScreenAction = async () =>
  runAction(async () => screens.getMyAdvancesScreen(await self()));

export const getMyOverviewAction = async () =>
  runAction(async () => portal.getMyOverview(await self()));
export const myAttendanceAction = async (query: unknown) =>
  runAction(async () => attendance.myAttendance(await self(), query));
export const checkInAction = async (input: unknown = {}) =>
  change(async () => attendance.checkIn(await self(), input, await getRequestMeta()));
export const checkOutAction = async (input: unknown = {}) =>
  change(async () => attendance.checkOut(await self(), input, await getRequestMeta()));
export const myLeaveAction = async (query: unknown) =>
  runAction(async () => leave.myLeave(await self(), query));
/** A doctor's note or other paper for the employee's own leave request. */
export const uploadMyLeaveFileAction = async (form: FormData) =>
  runAction(async () => {
    const asset = await files.storeUpload(
      await self(),
      await files.fileFromForm(form),
      await getRequestMeta(),
    );
    return { id: asset.id, fileName: asset.fileName };
  });
export const requestMyLeaveAction = async (input: unknown) =>
  change(async () => {
    const request = await leave.requestMyLeave(await self(), input, await getRequestMeta());
    return { id: request.id, days: request.days, status: request.status };
  });
export const cancelMyLeaveAction = async (leaveId: string, input: unknown = {}) =>
  change(async () => {
    const request = await leave.cancelMyLeave(await self(), leaveId, input, await getRequestMeta());
    return { id: request.id, status: request.status };
  });
export const myPayslipsAction = async () => runAction(async () => payroll.myPayslips(await self()));
export const myPayslipAction = async (itemId: string) =>
  runAction(async () => payroll.myPayslip(await self(), itemId));
export const myAdvancesAction = async () =>
  runAction(async () => advances.myAdvances(await self()));
export const myTasksAction = async (query: unknown = {}) =>
  runAction(async () => tasks.myTasks(await self(), query));
export const setMyTaskStatusAction = async (taskId: string, input: unknown) =>
  change(async () => tasks.setMyTaskStatus(await self(), taskId, input, await getRequestMeta()));
