import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The Planner, inbox and My HR task screens decide what to show and offer from
 * flags the server sends with the data (can.edit, the moves a task may make,
 * whether a reminder waits to be dealt with...). These tests open the screens'
 * data as each built-in role plus an "Office" role that only holds the company
 * settings, then try the changes through the same Server Actions the buttons
 * call: each must work exactly when the screen offers it. Next.js' request
 * helpers are replaced as in screens.test.ts.
 */
const browser = vi.hoisted(() => ({ cookies: new Map<string, string>(), headers: new Headers() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      browser.cookies.has(name) ? { name, value: browser.cookies.get(name)! } : undefined,
    set: (name: string, value: string) => void browser.cookies.set(name, value),
    delete: (name: string) => void browser.cookies.delete(name),
  }),
  headers: async () => browser.headers,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`Redirected to ${url}`), {
      digest: `NEXT_REDIRECT;replace;${url};307;`,
      redirectedTo: url,
    });
  },
  notFound: () => {
    throw Object.assign(new Error("Not found"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  },
  useRouter: () => ({}),
  usePathname: () => "/planner",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import InboxPage from "@/app/(app)/inbox/page";
import MyTasksPage from "@/app/(app)/me/tasks/page";
import AutomaticRemindersPage from "@/app/(app)/planner/automatic/page";
import NotepadPage from "@/app/(app)/planner/notepad/page";
import ComingUpPage from "@/app/(app)/planner/page";
import ReminderPage from "@/app/(app)/planner/reminders/[reminderId]/page";
import RemindersPage from "@/app/(app)/planner/reminders/page";
import TaskPage from "@/app/(app)/planner/tasks/[taskId]/page";
import TasksPage from "@/app/(app)/planner/tasks/page";
import { SectionError } from "@/components/dashboard/section-error";
import { MyHrProblem } from "@/components/hr/no-access";
import {
  NotepadNoAccess,
  PlannerNoAccess,
  RulesNoAccess,
  TasksNoAccess,
} from "@/components/planner/no-access";
import { visiblePlannerTabs } from "@/components/planner/tabs";
import { visibleNavItems } from "@/components/shell/nav-items";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { addDays, localDay } from "@/lib/dates";
import type { ActionResult } from "@/lib/result";
import type { CompanyContext } from "@/modules/auth/context";
import { createSession } from "@/modules/auth/session.service";
import * as employees from "@/modules/hr/employee.service";
import * as projects from "@/modules/production/project.service";
import { createRole } from "@/modules/rbac/role.service";
import { plannerKeys } from "@/modules/reminders/checks";
import { runReminders } from "@/modules/reminders/engine";
import {
  createNoteAction,
  getNotepadScreenAction,
  markNoteAction,
} from "@/server/actions/notepad.actions";
import { getMyTasksScreenAction, setMyTaskStatusAction } from "@/server/actions/portal.actions";
import {
  acknowledgeReminderAction,
  cancelReminderAction,
  createReminderAction,
  createTaskAction,
  deleteReminderAction,
  findPeopleAction,
  findTaskEmployeesAction,
  getAgendaScreenAction,
  getInboxScreenAction,
  getReminderScreenAction,
  getRemindersScreenAction,
  getRulesScreenAction,
  getTaskScreenAction,
  getTasksScreenAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  setTaskStatusAction,
  updateReminderAction,
  updateReminderRuleAction,
  updateTaskAction,
} from "@/server/actions/reminders.actions";
import { requireCompanyPage } from "@/server/pages/guards";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const BUILT_IN = {
  owner: "SUPER_ADMIN",
  production: "PRODUCTION_MANAGER",
  sales: "SALES_EXECUTIVE",
  store: "WAREHOUSE_TEAM",
  accounts: "ACCOUNTS",
  employee: "EMPLOYEE",
} as const;
type Who = keyof typeof BUILT_IN | "office";
const EVERYONE: Who[] = [...(Object.keys(BUILT_IN) as Who[]), "office"];
const TZ = "Asia/Dhaka";
const STATUSES = ["TODO", "IN_PROGRESS", "DONE", "CANCELLED"] as const;

async function signInAs(userId: string, companyId: string) {
  const { token } = await createSession(userId, companyId);
  browser.cookies.set(SESSION_COOKIE, token);
}

/** A refusal must come from the access rules, not from some other failure. */
function expectRuleRefusal(result: ActionResult<unknown>, label: string) {
  if (result.ok) return;
  expect(
    ["FORBIDDEN", "CONFLICT", "VALIDATION", "NOT_FOUND"],
    `${label}: ${result.error.message}`,
  ).toContain(result.error.code);
}

/** The change works exactly when the screen offered it. */
function expectOffered(result: ActionResult<unknown>, offered: boolean, label: string) {
  expect(result.ok, `${label}${result.ok ? "" : `: ${result.error.message}`}`).toBe(offered);
  expectRuleRefusal(result, label);
}

function data<T>(result: ActionResult<T>, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

/** What a page rendered: "no access", "not linked" (My HR), an error, or the page. */
async function rendered(page: Promise<React.ReactElement>): Promise<string> {
  const element = await page;
  if (
    element.type === PlannerNoAccess ||
    element.type === NotepadNoAccess ||
    element.type === TasksNoAccess ||
    element.type === RulesNoAccess
  ) {
    return "no access";
  }
  if (element.type === MyHrProblem) {
    const { error } = element.props as { error: { code: string } };
    if (error.code === "FORBIDDEN") return "no access";
    if (error.code === "NOT_FOUND") return "not linked";
    return "error";
  }
  if (element.type === SectionError) return "error";
  return "page";
}

const page = (allowed: boolean) => (allowed ? "page" : "no access");
const params = <T>(value: T) => Promise.resolve(value);
const noQuery = () => Promise.resolve({});
const today = () => localDay(new Date(), TZ);
const tomorrow = () => addDays(today(), 1);

/**
 * Extas with one person in each built-in role and an "Office" role that only
 * changes the company settings; Sabbir, whose login is the Employee's, and
 * Nasrin, who has no login; a production project.
 */
async function factory() {
  const { company, roles } = await makeCompany("Extas");
  const owner = await makeUser("owner@extas.test");
  await addToCompany(owner.id, company.id, roles.SUPER_ADMIN);
  const ownerCtx = await contextFor(owner.id, company.id);
  const officeRole = await createRole(ownerCtx, {
    name: "Office",
    permissions: ["company.settings"],
  });
  const roleOf: Record<Who, string> = {
    owner: roles.SUPER_ADMIN,
    production: roles.PRODUCTION_MANAGER,
    sales: roles.SALES_EXECUTIVE,
    store: roles.WAREHOUSE_TEAM,
    accounts: roles.ACCOUNTS,
    employee: roles.EMPLOYEE,
    office: officeRole.id,
  };
  const people: Partial<Record<Who, { id: string }>> = { owner };
  for (const who of EVERYONE) {
    if (who === "owner") continue;
    const user = await makeUser(`${who}@extas.test`);
    await addToCompany(user.id, company.id, roleOf[who]);
    people[who] = user;
  }
  const hire = (name: string) =>
    employees.createEmployee(ownerCtx, { name, joinDate: "2025-01-01", salary: 20000 });
  const sabbir = await hire("Sabbir Ahmed");
  const nasrin = await hire("Nasrin Akter");
  await employees.grantPortalAccess(ownerCtx, sabbir.id, { userId: people.employee!.id });
  const project = await projects.createProject(ownerCtx, {
    name: "Basics run",
    factoryName: "Own sewing floor",
    targetDate: addDays(today(), 30),
    targetQuantity: 100,
  });
  return {
    company,
    people: people as Record<Who, { id: string }>,
    owner: ownerCtx,
    sabbir,
    nasrin,
    project,
  };
}

type Factory = Awaited<ReturnType<typeof factory>>;

async function as(env: Factory, who: Who): Promise<CompanyContext> {
  await signInAs(env.people[who].id, env.company.id);
  return requireCompanyPage();
}

run("Planner, inbox and My HR task screens", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("shows each page to the people its actions let in, and nothing to the others", async () => {
    const env = await factory();
    const task = data(
      await (async () => {
        await as(env, "owner");
        return createTaskAction({ title: "Count the trims", assigneeId: env.sabbir.id });
      })(),
      "task",
    );

    for (const who of EVERYONE) {
      const ctx = await as(env, who);
      const k = plannerKeys(ctx);
      const tabs = visiblePlannerTabs(ctx.permissions).map((t) => t.href);
      expect(tabs, who).toEqual([
        ...(k.notepad || k.manage || k.settings ? ["/planner"] : []),
        ...(k.notepad ? ["/planner/notepad"] : []),
        ...(k.manage ? ["/planner/tasks"] : []),
        ...(k.remind ? ["/planner/reminders"] : []),
        ...(k.rules ? ["/planner/automatic"] : []),
      ]);
      const inMenu = visibleNavItems([...ctx.permissions]).some((i) => i.href === "/planner");
      expect(inMenu, who).toBe(tabs.length > 0);

      // What is coming up, the reminders and the inbox are everyone's own.
      expect(await rendered(ComingUpPage({ searchParams: noQuery() })), who).toBe("page");
      expect(await rendered(RemindersPage({ searchParams: noQuery() })), who).toBe("page");
      expect(await rendered(InboxPage({ searchParams: noQuery() })), who).toBe("page");
      expect(await rendered(NotepadPage({ searchParams: noQuery() })), `${who} notepad`).toBe(
        page(k.notepad),
      );
      expect(await rendered(TasksPage({ searchParams: noQuery() })), `${who} tasks`).toBe(
        page(k.manage),
      );
      expect(
        await rendered(TaskPage({ params: params({ taskId: task.id }), searchParams: noQuery() })),
        `${who} task`,
      ).toBe(page(k.manage));
      expect(await rendered(AutomaticRemindersPage()), `${who} automatic`).toBe(page(k.rules));
      expect(await rendered(MyTasksPage({ searchParams: noQuery() })), `${who} my tasks`).toBe(
        !k.self ? "no access" : who === "employee" ? "page" : "not linked",
      );

      const agenda = data(await getAgendaScreenAction(), `${who} agenda`);
      expect(agenda.can, who).toEqual({ remind: k.remind, task: k.manage });
      expectOffered(await getNotepadScreenAction(), k.notepad, `${who} notepad`);
      expectOffered(await getTasksScreenAction(), k.manage, `${who} tasks`);
      expectOffered(await findTaskEmployeesAction(""), k.manage, `${who} staff picker`);
      expectOffered(await findPeopleAction(""), k.rules, `${who} people picker`);
      const reminders = data(await getRemindersScreenAction(), `${who} reminders`);
      expect(reminders.can, who).toEqual({ add: k.remind, everyone: k.manage, others: k.manage });
      expectOffered(await getRemindersScreenAction({ all: true }), k.manage, `${who} everyone's`);
    }
  });

  it("offers each task move that works, and links only to pages the role opens", async () => {
    const env = await factory();
    await as(env, "production");
    const give = async (title: string) =>
      data(
        await createTaskAction({
          title,
          assigneeId: env.sabbir.id,
          projectId: env.project.id,
          dueAt: tomorrow(),
        }),
        title,
      );

    // Management: every move offered works. A finished or cancelled task is only
    // offered "Reopen", though the service would also take it straight elsewhere.
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        const task = await give(`${from} to ${to}`);
        if (from !== "TODO") data(await setTaskStatusAction(task.id, { status: from }), from);
        const screen = data(await getTaskScreenAction(task.id), "screen");
        expect(screen.task.status).toBe(from);
        expect(screen.can.edit, from).toBe(from === "TODO" || from === "IN_PROGRESS");
        const result = await setTaskStatusAction(task.id, { status: to });
        const label = `${from} -> ${to}`;
        if (screen.moves.includes(to) || to === from) {
          expectOffered(result, screen.moves.includes(to), label);
        } else {
          expect(from === "DONE" || from === "CANCELLED", label).toBe(true);
          expectRuleRefusal(result, label);
        }
      }
    }
    const done = await give("Finished work");
    data(await setTaskStatusAction(done.id, { status: "DONE" }), "done");
    const doneScreen = data(await getTaskScreenAction(done.id), "done screen");
    expectOffered(
      await updateTaskAction(done.id, { title: "Changed" }),
      doneScreen.can.edit,
      "change a done task",
    );

    // The links on the task's page open only where the role opens them.
    const task = await give("Factory visit");
    const links = async (who: Who) => {
      await as(env, who);
      return data(await getTaskScreenAction(task.id), `${who} task`).links;
    };
    expect(await links("owner")).toEqual({
      assignee: `/hr/employees/${env.sabbir.id}`,
      project: `/production/projects/${env.project.id}`,
    });
    expect(await links("production")).toEqual({
      assignee: null,
      project: `/production/projects/${env.project.id}`,
    });
    expect(await links("sales")).toEqual({ assignee: null, project: null });

    // The employee: start, finish and reopen their own, never cancel.
    for (const from of ["TODO", "IN_PROGRESS", "DONE", "CANCELLED"] as const) {
      await as(env, "production");
      const mine = await give(`Mine ${from}`);
      if (from !== "TODO") data(await setTaskStatusAction(mine.id, { status: from }), from);
      await as(env, "employee");
      const screen = data(await getMyTasksScreenAction({ show: "all" }), "my tasks");
      const row = screen.items.find((t) => t.id === mine.id)!;
      expect(row, from).toBeDefined();
      for (const to of STATUSES) {
        if (to === from) continue;
        const result = await setMyTaskStatusAction(mine.id, { status: to });
        const label = `employee ${from} -> ${to}`;
        if (row.moves.includes(to) || to === "CANCELLED" || from === "CANCELLED") {
          // Offered moves work; cancelling, or touching a cancelled task, never does.
          expectOffered(result, row.moves.includes(to), label);
        } else {
          // Only "Reopen" is offered on a finished task.
          expect(from, label).toBe("DONE");
          expectRuleRefusal(result, label);
        }
        // Put it back for the next try.
        if (result.ok) {
          await as(env, "production");
          data(await setTaskStatusAction(mine.id, { status: from }), "back");
          await as(env, "employee");
        }
      }
    }
    // The store has My HR but no employee record: nothing to list or change.
    await as(env, "store");
    expect((await getMyTasksScreenAction()).ok).toBe(false);
    expectOffered(
      await setMyTaskStatusAction(task.id, { status: "DONE" }),
      false,
      "store finishes a task",
    );

    // The employee heard about it in the app; the message opens My HR.
    await as(env, "employee");
    const inbox = data(await getInboxScreenAction(), "inbox");
    const given = inbox.items.find((m) => m.link?.type === "Task" && m.link.id === task.id);
    expect(given?.href).toBe("/me/tasks");
  });

  it("offers changing a reminder exactly to the people the service lets change it", async () => {
    const env = await factory();
    const setBySales = async (title: string) => {
      await as(env, "sales");
      return data(
        await createReminderAction({
          title,
          day: tomorrow(),
          time: "10:00",
          userIds: [env.people.employee.id, env.people.store.id],
        }),
        title,
      );
    };

    for (const who of EVERYONE) {
      const reminder = await setBySales(`Call Rahim Traders (${who})`);
      const ctx = await as(env, who);
      const k = plannerKeys(ctx);
      const screen = await getReminderScreenAction(reminder.id);
      const sees = ["sales", "employee", "store"].includes(who) || k.manage;
      expect(screen.ok, `${who} sees`).toBe(sees);
      expect(
        await rendered(
          ReminderPage({ params: params({ reminderId: reminder.id }), searchParams: noQuery() }),
        ).catch((e: { digest?: string }) => (e.digest?.includes("404") ? "not found" : "thrown")),
        who,
      ).toBe(sees ? "page" : "not found");
      const can = screen.ok
        ? screen.data.can
        : { edit: false, cancel: false, delete: false, acknowledge: false, others: false };
      if (screen.ok) {
        expect(can.edit, who).toBe(who === "sales" || k.manage);
        expect(can.acknowledge, `${who} before it goes out`).toBe(false);
      }
      expectOffered(
        await updateReminderAction(reminder.id, { title: `Call Rahim Traders again (${who})` }),
        can.edit,
        `${who} changes`,
      );
      expectOffered(await acknowledgeReminderAction(reminder.id), false, `${who} deals early`);
      expectOffered(await cancelReminderAction(reminder.id), can.cancel, `${who} cancels`);
      expectOffered(await deleteReminderAction(reminder.id), can.delete, `${who} deletes`);
    }

    // Reminding others needs reminders.manage; the notepad only reminds yourself.
    await as(env, "employee");
    expectOffered(
      await createReminderAction({
        title: "Check the cutting room",
        day: tomorrow(),
        time: "09:00",
        userIds: [env.people.store.id],
      }),
      false,
      "employee reminds the store",
    );
    await as(env, "office");
    expectOffered(
      await createReminderAction({ title: "Pay the rent", day: tomorrow() }),
      false,
      "office without the notepad",
    );
  });

  it("asks for a reminder to be dealt with once it has gone out, from its page and the inbox", async () => {
    const env = await factory();
    await as(env, "employee");
    const reminder = data(
      await createReminderAction({
        title: "Send the fabric samples",
        day: tomorrow(),
        time: "10:00",
      }),
      "reminder",
    );
    expect(data(await getReminderScreenAction(reminder.id), "before").can.acknowledge).toBe(false);

    await runReminders(new Date(`${tomorrow()}T10:00:00+06:00`), { companyId: env.company.id });
    const screen = data(await getReminderScreenAction(reminder.id), "after");
    expect(screen.reminder.status).toBe("SENT");
    expect(screen.can).toMatchObject({ acknowledge: true, edit: false, cancel: false });
    expectOffered(
      await updateReminderAction(reminder.id, { title: "Too late" }),
      screen.can.edit,
      "change after it went out",
    );
    expectOffered(await cancelReminderAction(reminder.id), screen.can.cancel, "cancel after");

    const inbox = data(await getInboxScreenAction(), "inbox");
    const message = inbox.items.find((m) => m.reminderId === reminder.id)!;
    expect(message).toMatchObject({ read: false, dealtWith: false });
    expect(message.href).toBe(`/planner/reminders/${reminder.id}`);
    expect(inbox.unread).toBeGreaterThan(0);

    data(await acknowledgeReminderAction(reminder.id), "dealt with");
    const after = data(await getInboxScreenAction(), "inbox after");
    expect(after.items.find((m) => m.id === message.id)).toMatchObject({
      read: true,
      dealtWith: true,
    });
    expect(data(await getReminderScreenAction(reminder.id), "dealt").can.acknowledge).toBe(false);

    // Someone else's message is not theirs to mark.
    await as(env, "store");
    expectOffered(await markNotificationReadAction(message.id), false, "store marks it read");
    await as(env, "employee");
    data(await markAllNotificationsReadAction(), "mark all");
    expect(data(await getInboxScreenAction({ unread: true }), "unread").items).toEqual([]);
  });

  it("lets the owner change the automatic reminders and managers read them", async () => {
    const env = await factory();
    for (const who of EVERYONE) {
      const ctx = await as(env, who);
      const k = plannerKeys(ctx);
      const screen = await getRulesScreenAction();
      expectOffered(screen, k.rules, `${who} reads`);
      const canEdit = screen.ok && screen.data.can.edit;
      expect(canEdit, who).toBe(k.settings);
      expectOffered(
        await updateReminderRuleAction("TASK_DUE", { sendTime: "08:30" }),
        canEdit,
        `${who} changes`,
      );
    }

    // Extra people can include staff with no login; the screen says so.
    await as(env, "office");
    const people = data(await findPeopleAction("Nasrin"), "people");
    expect(people).toEqual([
      expect.objectContaining({ kind: "employee", personId: env.nasrin.id }),
    ]);
    data(
      await updateReminderRuleAction("PRODUCTION_DEADLINE", { employeeIds: [env.nasrin.id] }),
      "add Nasrin",
    );
    const rules = data(await getRulesScreenAction(), "rules").rules;
    expect(rules.find((r) => r.type === "PRODUCTION_DEADLINE")!.people).toEqual([
      { kind: "employee", id: env.nasrin.id, name: "Nasrin Akter", note: "no login yet" },
    ]);
  });

  it("keeps each person's notepad their own", async () => {
    const env = await factory();
    await as(env, "store");
    const routine = data(
      await createNoteAction({ tab: "DAILY_ROUTINE", content: "Count the trims" }),
      "routine",
    );
    data(await markNoteAction(routine.id, { done: true }), "tick");
    const plan = data(
      await createNoteAction({
        tab: "NEXT_3_DAYS",
        content: "Gazipur visit",
        planDate: tomorrow(),
      }),
      "plan",
    );
    expect(plan.planDate).toBe(tomorrow());
    const screen = data(await getNotepadScreenAction(), "routine screen");
    expect(screen).toMatchObject({ tab: "DAILY_ROUTINE", done: 1 });
    const plans = data(await getNotepadScreenAction({ tab: "NEXT_3_DAYS" }), "plan screen");
    if (plans.tab !== "NEXT_3_DAYS") throw new Error("Wrong tab");
    expect(plans.days.map((d) => d.date)).toEqual([today(), tomorrow(), addDays(today(), 2)]);
    expect(plans.days[1]!.items.map((n) => n.content)).toEqual(["Gazipur visit"]);

    await as(env, "sales");
    const theirs = data(await getNotepadScreenAction(), "sales notepad");
    if (theirs.tab !== "DAILY_ROUTINE") throw new Error("Wrong tab");
    expect(theirs.items).toEqual([]);
    expectOffered(await markNoteAction(routine.id, { done: false }), false, "sales ticks it");
  });
});
