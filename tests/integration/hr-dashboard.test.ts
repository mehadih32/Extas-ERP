import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The employee dashboard: the performance score worked out from the real
 * attendance, tasks and claims; task read receipts ("Seen", the first time
 * the assignee opens a task in My HR); and the staff notice board, with who
 * has read each notice. A new task or notice also goes to the phone through
 * the push plug once it is on ("log" here).
 */
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import { prisma } from "@/lib/prisma";
import * as employees from "@/modules/hr/employee.service";
import * as notices from "@/modules/hr/notice.service";
import * as scores from "@/modules/hr/score.service";
import { createRole } from "@/modules/rbac/role.service";
import { recordHref } from "@/modules/reminders/links";
import * as plannerScreens from "@/modules/reminders/screens.service";
import * as tasks from "@/modules/reminders/task.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** A Dhaka wall-clock time; 12 Oct 2026 is a Monday, 9 Oct a Friday (the weekly day off). */
const at = (day: string, time = "12:00") => new Date(`${day}T${time}:00+06:00`);
const NOW = at("2026-10-12");
const meta = { ipAddress: "203.0.113.7", userAgent: "Mozilla/5.0 (Linux; Android 14)" };

async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const member = async (roleId: string, who: string) => {
    const user = await makeUser(`${who}@extras.test`);
    await addToCompany(user.id, company.id, roleId);
    return user;
  };
  const ownerUser = await member(roles.SUPER_ADMIN, "owner");
  const admin = await contextFor(ownerUser.id, company.id);
  const hrRole = await createRole(admin, {
    name: "HR Manager",
    permissions: ["hr.view", "hr.manage", "portal.self"],
  });
  const hrUser = await member(hrRole.id, "hr");
  const sumonUser = await member(roles.EMPLOYEE, "sumon");
  const rinaUser = await member(roles.EMPLOYEE, "rina");
  const hire = async (name: string, userId: string | null) => {
    const e = await employees.createEmployee(admin, {
      name,
      joinDate: "2025-01-01",
      salary: 30000,
    });
    if (userId) await employees.grantPortalAccess(admin, e.id, { userId });
    return e;
  };
  const sumon = await hire("Sumon Mia", sumonUser.id);
  const rina = await hire("Rina Begum", rinaUser.id);
  const nasrin = await hire("Nasrin Akter", hrUser.id);
  // Jamal works on the floor without a login.
  const jamal = await hire("Jamal Hossain", null);
  return {
    company,
    admin,
    hr: await contextFor(hrUser.id, company.id),
    sumonCtx: await contextFor(sumonUser.id, company.id),
    rinaCtx: await contextFor(rinaUser.id, company.id),
    users: { owner: ownerUser, hr: hrUser, sumon: sumonUser, rina: rinaUser },
    sumon,
    rina,
    nasrin,
    jamal,
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

const mark = (
  env: Env,
  employeeId: string,
  date: string,
  status: "PRESENT" | "LATE" | "HALF_DAY" | "ABSENT",
) =>
  prisma.attendance.create({
    data: {
      companyId: env.company.id,
      employeeId,
      date: new Date(`${date}T00:00:00Z`),
      status,
    },
  });

let claimNo = 0;
const decidedClaim = (
  env: Env,
  employeeId: string,
  date: string,
  status: "APPROVED" | "REJECTED" | "PENDING",
  amount: number,
  approvedAmount: number | null = null,
) =>
  prisma.staffClaim.create({
    data: {
      companyId: env.company.id,
      employeeId,
      number: `CLM-2026-${String(++claimNo).padStart(5, "0")}`,
      kind: "CONVEYANCE",
      date: new Date(`${date}T00:00:00Z`),
      amount,
      fromPlace: "Head office",
      toPlace: "Mirpur 10",
      purpose: "Samples",
      status,
      approvedAmount: status === "APPROVED" ? (approvedAmount ?? amount) : null,
    },
  });

/** A task given to someone, then moved to `status` on the day it happened. */
async function taskFor(
  env: Env,
  assigneeId: string,
  title: string,
  dueAt: string,
  done?: { on: string } | "CANCELLED",
) {
  const t = await tasks.createTask(env.admin, { title, assigneeId, dueAt }, meta, at("2026-09-20"));
  if (done === "CANCELLED") {
    await tasks.setTaskStatus(env.admin, t.id, { status: "CANCELLED" }, meta, at("2026-09-21"));
  } else if (done) {
    await tasks.setTaskStatus(env.admin, t.id, { status: "DONE" }, meta, at(done.on, "17:00"));
  }
  return t;
}

run("the employee dashboard", () => {
  beforeEach(async () => {
    claimNo = 0;
    await resetDb();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("scores the last 30 days of attendance, tasks and claims, and shows what moved it", async () => {
    const env = await setup();
    // Attendance: on time, late, absent, half day; the Friday off, 31 Aug and full leave never count.
    await mark(env, env.sumon.id, "2026-10-05", "PRESENT");
    await mark(env, env.sumon.id, "2026-10-06", "LATE");
    await mark(env, env.sumon.id, "2026-10-07", "ABSENT");
    await mark(env, env.sumon.id, "2026-10-08", "HALF_DAY");
    await mark(env, env.sumon.id, "2026-10-09", "ABSENT");
    await mark(env, env.sumon.id, "2026-08-31", "ABSENT");
    await mark(env, env.sumon.id, "2026-10-11", "ABSENT");
    const sick = await prisma.leaveType.create({
      data: { companyId: env.company.id, name: "Sick", daysPerYear: 14 },
    });
    await prisma.leaveRequest.create({
      data: {
        companyId: env.company.id,
        employeeId: env.sumon.id,
        leaveTypeId: sick.id,
        startDate: new Date("2026-10-11T00:00:00Z"),
        endDate: new Date("2026-10-11T00:00:00Z"),
        days: 1,
        status: "APPROVED",
      },
    });
    await mark(env, env.rina.id, "2026-10-05", "ABSENT");

    // Tasks: on time, two days late, overdue, done early; due today, cancelled and Rina's don't count.
    await taskFor(env, env.sumon.id, "Send the lab dips", "2026-10-06", { on: "2026-10-06" });
    await taskFor(env, env.sumon.id, "Cut the samples", "2026-10-07", { on: "2026-10-09" });
    await taskFor(env, env.sumon.id, "Visit Gazipur", "2026-10-08");
    await taskFor(env, env.sumon.id, "Book the courier", "2026-10-20", { on: "2026-10-10" });
    await taskFor(env, env.sumon.id, "Count the trims", "2026-10-12");
    await taskFor(env, env.sumon.id, "Old idea", "2026-10-07", "CANCELLED");
    await taskFor(env, env.rina.id, "Rina's task", "2026-10-07");

    // Claims: as sent, cut, rejected; a waiting one doesn't count yet.
    await decidedClaim(env, env.sumon.id, "2026-10-05", "APPROVED", 320);
    await decidedClaim(env, env.sumon.id, "2026-10-06", "APPROVED", 650, 400);
    await decidedClaim(env, env.sumon.id, "2026-10-07", "REJECTED", 180);
    await decidedClaim(env, env.sumon.id, "2026-10-08", "PENDING", 90);

    const mine = await scores.myScore(env.sumonCtx, NOW);
    expect(mine.from).toBe("2026-09-13");
    expect(mine.to).toBe("2026-10-12");
    expect(mine.parts.map((p) => [p.part, p.percent, p.counts.counted])).toEqual([
      ["attendance", 50, 4],
      ["tasks", 63, 4],
      ["claims", 50, 3],
    ]);
    expect(mine.score).toBe(5.4);
    expect(mine.tone).toBe("fair");
    expect(mine.losses.map((l) => l.kind)).toEqual([
      "TASK_LATE",
      "TASK_OVERDUE",
      "HALF_DAY",
      "ABSENT",
      "CLAIM_REJECTED",
      "LATE",
      "CLAIM_CUT",
    ]);
    expect(mine.losses[0]).toMatchObject({ title: "Cut the samples", daysLate: 2 });
    expect(mine.tenure).toMatchObject({
      joined: "2025-01-01",
      years: 1,
      months: 9,
      days: 11,
      text: "1 year, 9 months and 11 days",
      until: null,
      next: { date: "2027-01-01", years: 2, inDays: 81 },
    });

    // HR sees the same; nobody else does.
    const seen = await scores.employeeScore(env.hr, env.sumon.id, NOW);
    expect(seen.score).toBe(mine.score);
    expect(seen.losses).toEqual(mine.losses);
    await expect(scores.employeeScore(env.sumonCtx, env.rina.id, NOW)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // The owner has no employee profile of their own.
    await expect(scores.myScore(env.admin, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Rina: one absent day and one overdue task.
    const rina = await scores.myScore(env.rinaCtx, NOW);
    expect(rina.score).toBe(0);
    expect(rina.tone).toBe("poor");

    // Someone with nothing to count yet has no score.
    const nasrin = await scores.myScore(env.hr, NOW);
    expect(nasrin.score).toBeNull();
    expect(nasrin.tone).toBe("none");

    // A leaver's clock stops on their last working day.
    await prisma.employee.update({
      where: { id: env.rina.id },
      data: { exitDate: new Date("2026-09-30T00:00:00Z"), status: "RESIGNED" },
    });
    const left = await scores.employeeScore(env.hr, env.rina.id, NOW);
    expect(left.tenure).toMatchObject({ months: 8, days: 29, next: null });
    expect(left.tenure.until).toBe(at("2026-10-01", "00:00").toISOString());
  });

  it("keeps a read receipt when the assignee first opens a task, and pushes new tasks", async () => {
    const env = await setup();
    vi.stubEnv("PUSH_PROVIDER", "log");
    const pushed = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const pushesTo = (userId: string) =>
      pushed.mock.calls.filter((c) => String(c[0]).startsWith(`[push:test] to ${userId}:`)).length;

    const t = await tasks.createTask(env.admin, {
      title: "Factory visit at Gazipur",
      assigneeId: env.sumon.id,
      dueAt: "2026-10-14",
    });
    expect(t.seenAt).toBeNull();
    expect(pushesTo(env.users.sumon.id)).toBe(1);
    expect(
      pushed.mock.calls.some((c) => String(c[0]).includes("New task: Factory visit at Gazipur")),
    ).toBe(true);

    // Only the assignee's own opening counts.
    expect(await tasks.markTasksSeen(env.rinaCtx, { taskIds: [t.id] })).toEqual({ seen: 0 });
    expect(await tasks.markTasksSeen(env.admin, { taskIds: [t.id] })).toEqual({ seen: 0 });
    const first = at("2026-10-12", "10:42");
    expect(await tasks.markTasksSeen(env.sumonCtx, { taskIds: [t.id] }, first)).toEqual({
      seen: 1,
    });
    // The first time is kept.
    expect(
      await tasks.markTasksSeen(env.sumonCtx, { taskIds: [t.id] }, at("2026-10-12", "15:00")),
    ).toEqual({ seen: 0 });
    expect((await tasks.getTask(env.admin, t.id)).seenAt).toEqual(first);
    const listed = await plannerScreens.getTasksScreen(env.admin, {});
    expect(listed.items.find((x) => x.id === t.id)!.seenAt).toEqual(first);
    const myRows = await plannerScreens.getMyTasksScreen(env.sumonCtx, {});
    expect(myRows.items[0]!.seenAt).toEqual(first);

    // Changing the wording keeps the receipt; giving it to someone else starts again.
    await tasks.updateTask(env.admin, t.id, { title: "Factory visit at Gazipur (Tuesday)" });
    expect((await tasks.getTask(env.admin, t.id)).seenAt).toEqual(first);
    const moved = await tasks.updateTask(env.admin, t.id, { assigneeId: env.rina.id });
    expect(moved.seenAt).toBeNull();
    expect(pushesTo(env.users.rina.id)).toBe(1);
    expect(await tasks.markTasksSeen(env.sumonCtx, { taskIds: [t.id] })).toEqual({ seen: 0 });
    expect(await tasks.markTasksSeen(env.rinaCtx, { taskIds: [t.id] })).toEqual({ seen: 1 });

    // A task you give yourself is seen at once, and is not pushed to you.
    const owner = await employees.createEmployee(env.admin, {
      name: "Mehadi Hasan",
      joinDate: "2024-01-01",
      salary: 90000,
    });
    await employees.grantPortalAccess(env.admin, owner.id, { userId: env.users.owner.id });
    const own = await tasks.createTask(env.admin, { title: "Call the bank", assigneeId: owner.id });
    expect(own.seenAt).not.toBeNull();
    expect(pushesTo(env.users.owner.id)).toBe(0);
    const ownScreen = await plannerScreens.getTaskScreen(env.admin, own.id);
    expect(ownScreen.mine).toBe(true);
    expect((await plannerScreens.getTaskScreen(env.admin, t.id)).mine).toBe(false);

    // With push off, nothing is pushed (the inbox still has the message).
    vi.unstubAllEnvs();
    pushed.mockClear();
    await tasks.createTask(env.admin, {
      title: "Check the cutting table",
      assigneeId: env.sumon.id,
    });
    expect(pushed).not.toHaveBeenCalled();
    const inbox = await prisma.notificationLog.count({
      where: {
        userId: env.users.sumon.id,
        entityType: "Task",
        subject: { startsWith: "New task:" },
      },
    });
    expect(inbox).toBe(2);
  });

  it("posts notices to every employee and shows HR who has read them", async () => {
    const env = await setup();
    vi.stubEnv("PUSH_PROVIDER", "log");
    const pushed = vi.spyOn(console, "info").mockImplementation(() => undefined);

    // Only HR posts and sees the read list.
    await expect(
      notices.postNotice(env.sumonCtx, { title: "Hello", body: "Hi all" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(notices.listNotices(env.sumonCtx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      notices.postNotice(
        env.hr,
        { title: "Old", body: "Too late", showUntil: "2026-10-11" },
        meta,
        NOW,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    // Jamal is serving his notice: still on staff, so still counted.
    await prisma.employee.update({
      where: { id: env.jamal.id },
      data: { exitDate: new Date("2026-10-31T00:00:00Z"), status: "RESIGNED" },
    });
    const closed = await notices.postNotice(
      env.hr,
      {
        title: "Office closed on Thursday",
        body: "The office is closed for Durga Puja.\nSee you on Sunday.",
      },
      meta,
      NOW,
    );
    // Sumon and Rina are told; Nasrin posted it; Jamal has no login.
    expect(closed).toMatchObject({ told: 2, noLogin: 1 });
    expect(closed.notice).toMatchObject({ state: "UP", pinned: false, postedBy: "hr" });
    const inbox = await prisma.notificationLog.findMany({
      where: { entityType: "Notice", entityId: closed.notice.id },
      select: { userId: true, subject: true },
    });
    expect(inbox.map((n) => n.userId).sort()).toEqual(
      [env.users.rina.id, env.users.sumon.id].sort(),
    );
    expect(inbox[0]!.subject).toBe("Notice: Office closed on Thursday");
    expect(
      pushed.mock.calls.filter((c) => String(c[0]).includes("Notice: Office closed")),
    ).toHaveLength(2);
    expect(recordHref(env.sumonCtx, { type: "Notice", id: closed.notice.id })).toBe(
      `/me/notices#notice-${closed.notice.id}`,
    );
    expect(recordHref(env.admin, { type: "Notice", id: closed.notice.id })).toBe(
      `/me/notices#notice-${closed.notice.id}`,
    );

    // A pinned notice with a last day comes first.
    const bonus = await notices.postNotice(
      env.hr,
      {
        title: "Eid bonus dates",
        body: "Paid with October's salary.",
        pinned: true,
        showUntil: "2026-10-15",
      },
      meta,
      at("2026-10-12", "13:00"),
    );
    const board = await notices.myNotices(env.sumonCtx, NOW);
    expect(board.items.map((n) => n.title)).toEqual([
      "Eid bonus dates",
      "Office closed on Thursday",
    ]);
    expect(board.unread).toBe(2);

    // Reading is recorded once; HR sees who and when.
    const readAt = at("2026-10-12", "14:05");
    expect(
      await notices.markNoticesRead(env.sumonCtx, { noticeIds: [closed.notice.id] }, readAt),
    ).toEqual({ read: 1 });
    expect(await notices.markNoticesRead(env.sumonCtx, { noticeIds: [closed.notice.id] })).toEqual({
      read: 0,
    });
    expect((await notices.myNotices(env.sumonCtx, NOW)).unread).toBe(1);
    const list = await notices.listNotices(env.hr, {}, NOW);
    expect(list.audience).toEqual({ reached: 3, noLogin: 1 });
    expect(list.counts).toEqual({ up: 2, ended: 0 });
    const row = list.items.find((n) => n.id === closed.notice.id)!;
    expect(row.readBy.map((r) => [r.name, r.readAt])).toEqual([
      ["Nasrin Akter", NOW],
      ["Sumon Mia", readAt],
    ]);
    expect(row.notYet.map((p) => p.name)).toEqual(["Rina Begum"]);

    // The last day passes: staff no longer see it; HR finds it under "ended".
    const later = at("2026-10-16");
    expect((await notices.myNotices(env.sumonCtx, later)).items.map((n) => n.id)).toEqual([
      closed.notice.id,
    ]);
    expect(
      (await notices.listNotices(env.hr, { show: "ended" }, later)).items.map((n) => [
        n.id,
        n.state,
      ]),
    ).toEqual([[bonus.notice.id, "ENDED"]]);
    expect(
      await notices.markNoticesRead(env.rinaCtx, { noticeIds: [bonus.notice.id] }, later),
    ).toEqual({
      read: 0,
    });

    // Changing the words marks it changed; pinning alone does not.
    const pinned = await notices.updateNotice(env.hr, closed.notice.id, { pinned: true });
    expect(pinned.editedAt).toBeNull();
    const reworded = await notices.updateNotice(env.hr, closed.notice.id, {
      body: "The office is closed on Thursday and Friday.",
    });
    expect(reworded.editedAt).not.toBeNull();

    // Taking down hides it and keeps who read it; it can be put back.
    await notices.takeDownNotice(env.hr, closed.notice.id, meta);
    expect((await notices.myNotices(env.rinaCtx, later)).items).toEqual([]);
    expect(await notices.markNoticesRead(env.rinaCtx, { noticeIds: [closed.notice.id] })).toEqual({
      read: 0,
    });
    await expect(notices.takeDownNotice(env.hr, closed.notice.id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      notices.updateNotice(env.hr, closed.notice.id, { title: "Changed" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const down = (await notices.listNotices(env.hr, { show: "all" })).items.find(
      (n) => n.id === closed.notice.id,
    )!;
    expect(down.state).toBe("TAKEN_DOWN");
    expect(down.takenDownBy).toBe("hr");
    expect(down.readBy).toHaveLength(2);
    const back = await notices.putBackNotice(env.hr, closed.notice.id, meta);
    expect(back.state).toBe("UP");
    expect((await notices.myNotices(env.rinaCtx)).items.map((n) => n.id)).toContain(
      closed.notice.id,
    );

    // Everything HR did is in the activity log.
    const audit = await prisma.auditLog.findMany({
      where: { entityType: "Notice", entityId: closed.notice.id },
      select: { action: true },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((a) => a.action)).toEqual([
      "CREATE",
      "UPDATE",
      "UPDATE",
      "STATUS_CHANGE",
      "STATUS_CHANGE",
    ]);

    // Another company's notices are out of reach.
    const other = await makeCompany("Other Co");
    const otherUser = await makeUser("staff@other.test");
    await addToCompany(otherUser.id, other.company.id, other.roles.EMPLOYEE);
    const outsider = await contextFor(otherUser.id, other.company.id);
    expect((await notices.myNotices(outsider)).items).toEqual([]);
    expect(await notices.markNoticesRead(outsider, { noticeIds: [closed.notice.id] })).toEqual({
      read: 0,
    });
  });
});
