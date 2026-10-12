"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireCompany, requirePermission } from "@/modules/auth/context";
import * as files from "@/modules/files/file.service";
import * as advances from "@/modules/hr/advance.service";
import * as attendance from "@/modules/hr/attendance.service";
import * as claims from "@/modules/hr/claims.service";
import * as leave from "@/modules/hr/leave.service";
import * as location from "@/modules/hr/location.service";
import * as notices from "@/modules/hr/notice.service";
import * as payroll from "@/modules/hr/payroll.service";
import * as portal from "@/modules/hr/portal.service";
import * as scores from "@/modules/hr/score.service";
import * as screens from "@/modules/hr/screens.service";
import * as vault from "@/modules/hr/vault.service";
import * as plannerScreens from "@/modules/reminders/screens.service";
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
export const getMyProfileScreenAction = async () =>
  runAction(async () => screens.getMyProfileScreen(await self()));

export const getMyOverviewAction = async () =>
  runAction(async () => portal.getMyOverview(await self()));
export const myAttendanceAction = async (query: unknown) =>
  runAction(async () => attendance.myAttendance(await self(), query));
/**
 * Whether this person's phone should send its position now (GPS attendance),
 * for the app frame. Null for everyone it does not apply to.
 */
export const getDutyStateAction = async () =>
  runAction(async () => location.getDutyState(await self()));
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
export const getMyTasksScreenAction = async (query: { show?: unknown; cursor?: string } = {}) =>
  runAction(async () => plannerScreens.getMyTasksScreen(await self(), query));
export const setMyTaskStatusAction = async (taskId: string, input: unknown) =>
  change(async () => {
    const task = await tasks.setMyTaskStatus(await self(), taskId, input, await getRequestMeta());
    return { id: task.id, title: task.title, status: task.status };
  });
/**
 * The read receipt: the tasks given to the signed-in person that are on their
 * screen now. Anyone in the company (a manager reads a task given to them in
 * the Planner too); only tasks given to the person themselves change. Nothing
 * else on the screen changes, so nothing is refreshed.
 */
export const markMyTasksSeenAction = async (taskIds: string[]) =>
  runAction(async () => tasks.markTasksSeen(await requireCompany(), { taskIds }));

// --- Notice board and my score ------------------------------------------------------------
export const getMyNoticesAction = async () =>
  runAction(async () => notices.myNotices(await self()));
/** The notices on the screen are read (the first time is what HR sees). */
export const markMyNoticesReadAction = async (noticeIds: string[]) =>
  runAction(async () => notices.markNoticesRead(await self(), { noticeIds }));
export const getMyScoreAction = async () => runAction(async () => scores.myScore(await self()));

// --- My claims: conveyance and local material ---------------------------------------------
export const getMyClaimsAction = async () =>
  runAction(async () => claims.getMyClaims(await self()));
/** A receipt or memo photo for the employee's own claim. */
export const uploadMyClaimReceiptAction = async (form: FormData) =>
  runAction(async () => {
    const asset = await files.storeUpload(
      await self(),
      await files.fileFromForm(form),
      await getRequestMeta(),
    );
    return { id: asset.id, fileName: asset.fileName };
  });
export const submitMyClaimAction = async (input: unknown) =>
  change(async () => claims.submitClaim(await self(), input, await getRequestMeta()));
export const withdrawMyClaimAction = async (claimId: string) =>
  change(async () => claims.withdrawMyClaim(await self(), claimId, await getRequestMeta()));

// --- My details: the employee's own data vault ------------------------------------------
export const updateMyDetailsAction = async (input: unknown) =>
  change(async () => {
    const result = await vault.updateMyDetails(await self(), input, await getRequestMeta());
    return { changed: result.changed, gaps: result.gaps };
  });
export const requestPayDetailsChangeAction = async (input: unknown) =>
  change(async () => {
    const r = await vault.requestPayDetailsChange(await self(), input, await getRequestMeta());
    return { id: r.id, status: r.status, changesText: r.changesText };
  });
export const withdrawMyPayRequestAction = async (requestId: string) =>
  change(async () => vault.withdrawMyPayRequest(await self(), requestId, await getRequestMeta()));
/** Keeps a paper in the employee's own vault: the form carries the file, its kind and a title. */
export const addMyDocumentAction = async (form: FormData) =>
  change(async () => {
    const document = await vault.addMyDocument(
      await self(),
      { kind: form.get("kind"), title: form.get("title") || null },
      await files.fileFromForm(form),
      await getRequestMeta(),
    );
    return { id: document.id, kind: document.kind, fileName: document.fileName };
  });
export const removeMyDocumentAction = async (documentId: string) =>
  change(async () => vault.removeMyDocument(await self(), documentId, await getRequestMeta()));
