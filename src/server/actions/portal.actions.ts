"use server";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requirePermission } from "@/modules/auth/context";
import * as advances from "@/modules/hr/advance.service";
import * as attendance from "@/modules/hr/attendance.service";
import * as leave from "@/modules/hr/leave.service";
import * as payroll from "@/modules/hr/payroll.service";
import * as portal from "@/modules/hr/portal.service";

/*
 * Employee portal Server Actions (portal.self): the signed-in employee's own
 * records only. Each returns { ok: true, data } or { ok: false, error }.
 */

const self = () => requirePermission("portal.self");

export const getMyOverviewAction = async () =>
  runAction(async () => portal.getMyOverview(await self()));
export const myAttendanceAction = async (query: unknown) =>
  runAction(async () => attendance.myAttendance(await self(), query));
export const checkInAction = async (input: unknown = {}) =>
  runAction(async () => attendance.checkIn(await self(), input, await getRequestMeta()));
export const checkOutAction = async (input: unknown = {}) =>
  runAction(async () => attendance.checkOut(await self(), input, await getRequestMeta()));
export const myLeaveAction = async (query: unknown) =>
  runAction(async () => leave.myLeave(await self(), query));
export const requestMyLeaveAction = async (input: unknown) =>
  runAction(async () => leave.requestMyLeave(await self(), input, await getRequestMeta()));
export const cancelMyLeaveAction = async (leaveId: string, input: unknown = {}) =>
  runAction(async () => leave.cancelMyLeave(await self(), leaveId, input, await getRequestMeta()));
export const myPayslipsAction = async () => runAction(async () => payroll.myPayslips(await self()));
export const myPayslipAction = async (itemId: string) =>
  runAction(async () => payroll.myPayslip(await self(), itemId));
export const myAdvancesAction = async () =>
  runAction(async () => advances.myAdvances(await self()));
