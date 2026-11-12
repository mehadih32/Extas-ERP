import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Approvals on the bot (Release 5): what waits for a person's approval comes
 * to the linked approver with Approve and Reject; a press calls the ERP's own
 * service as that person, with their permission read at the press (before
 * anything else is said); bookings and payrolls ask for the PIN; an expense
 * claim is approved only in the ERP (Reject works on the bot); a stale button
 * says who decided, and a booking's quantities and value are part of what
 * makes a button stale; another store's item is never
 * touched; the person can turn it off; the AI switch does not matter.
 */

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { POST as telegramWebhook } from "@/app/api/bot/telegram/webhook/route";
import { addDays, localDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { notifyApprovers, setApprovalSetting } from "@/modules/ai/bot/approvals";
import { saveTelegram, startLink, telegramSecret } from "@/modules/ai/bot/bot.service";
import { type BotCall, standInForBotApi } from "@/modules/ai/bot/channel";
import { setAiSwitch, setPin } from "@/modules/ai/settings.service";
import type { CompanyContext } from "@/modules/auth/context";
import * as expenses from "@/modules/expenses/expense.service";
import { createEmployee } from "@/modules/hr/employee.service";
import * as leave from "@/modules/hr/leave.service";
import { listLeaveTypes } from "@/modules/hr/settings.service";
import * as materials from "@/modules/materials/material.service";
import * as parties from "@/modules/parties/party.service";
import { runDueJobs } from "@/modules/jobs/worker";
import { createRole } from "@/modules/rbac/role.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const TOKEN = "123456789:AAH_test-token-abcdefghijklmnopqrstuv";
const OWNER_CHAT = 555001;
const HR_CHAT = 555002;

type Sent = { method: string; json: Record<string, unknown> };

/** Telegram, as a stand-in that records every call. */
function botApi() {
  const calls: Sent[] = [];
  let next = 100;
  standInForBotApi(async (call: BotCall) => {
    const tg = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/.exec(call.url);
    if (!tg) throw new Error(`Unexpected call to ${call.url}`);
    calls.push({ method: tg[2]!, json: (call.json ?? {}) as Record<string, unknown> });
    if (tg[2] === "getMe") {
      return {
        status: 200,
        body: { ok: true, result: { id: 123456789, username: "extas_ai_bot", first_name: "X" } },
      };
    }
    if (tg[2] === "sendMessage") {
      return { status: 200, body: { ok: true, result: { message_id: (next += 1) } } };
    }
    return { status: 200, body: { ok: true, result: true } };
  });
  const sent = (chat: number) =>
    calls.filter((c) => c.method === "sendMessage" && String(c.json.chat_id) === String(chat));
  return {
    calls,
    said: (chat: number) => sent(chat).map((c) => String(c.json.text)),
    /** The buttons under the last message to a chat that had buttons. */
    buttons: (chat: number) => {
      const last = sent(chat)
        .filter((c) => c.json.reply_markup)
        .at(-1);
      const markup = last?.json.reply_markup as
        { inline_keyboard?: Array<Array<{ text: string; callback_data: string }>> } | undefined;
      return (markup?.inline_keyboard ?? []).flat();
    },
  };
}

let updateId = 5000;
const typed = (chat: number, text: string) => ({
  update_id: (updateId += 1),
  message: {
    message_id: updateId,
    chat: { id: chat, type: "private" },
    from: { id: chat, first_name: "Mehadi" },
    text,
  },
});
const press = (chat: number, data: string) => ({
  update_id: (updateId += 1),
  callback_query: {
    id: `cb${updateId}`,
    from: { id: chat, first_name: "Mehadi" },
    data,
    message: { message_id: 777, chat: { id: chat, type: "private" } },
  },
});

async function telegram(update: unknown) {
  const response = await telegramWebhook(
    new Request("https://erp.test/api/bot/telegram/webhook", {
      method: "POST",
      headers: {
        "x-telegram-bot-api-secret-token": telegramSecret(TOKEN),
        "content-type": "application/json",
      },
      body: JSON.stringify(update),
    }),
  );
  await runDueJobs();
  return response.status;
}

async function setup(name = "Extas") {
  const { company, roles } = await makeCompany(name);
  const join = async (roleId: string, who: string) => {
    const user = await makeUser(`${who}@${name.toLowerCase()}.test`);
    await addToCompany(user.id, company.id, roleId);
    return contextFor(user.id, company.id);
  };
  const owner = await join(roles.SUPER_ADMIN, "owner");
  const staffRole = await createRole(owner, {
    name: "Staff",
    permissions: ["dashboard.view", "expenses.create"],
  });
  const staff = await join(staffRole.id, "staff");
  await expenses.ensureGeneralExpenseHeads(company.id);
  const head = await prisma.expenseHead.findFirstOrThrow({
    where: { companyId: company.id, name: "Office Supplies" },
  });
  const employee = await createEmployee(owner, {
    name: "Rahim Uddin",
    joinDate: "2025-01-01",
    salary: 30000,
  });
  const casual = (await listLeaveTypes(owner)).find((t) => t.name === "Casual Leave")!;
  return { company, roles, owner, staff, join, head, employee, casual };
}

type Env = Awaited<ReturnType<typeof setup>>;

/** A working day (not Friday) some days ahead. */
function aheadDay(days: number) {
  let d = addDays(localDay(new Date(), "Asia/Dhaka"), days);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() === 5) d = addDays(d, 1);
  return d;
}

async function linkTo(ctx: CompanyContext, chat: number) {
  const { code } = await startLink(ctx, "TELEGRAM");
  expect(await telegram(typed(chat, `/start ${code}`))).toBe(200);
}

const askLeave = (env: Env, days = 20) =>
  leave.createLeave(env.owner, {
    employeeId: env.employee.id,
    leaveTypeId: env.casual.id,
    startDate: aheadDay(days),
    reason: "Family event",
  });

run("Approvals on the bot", () => {
  let env: Env;
  beforeEach(async () => {
    vi.stubEnv("APP_URL", "https://erp.test");
    vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-0123456789");
    vi.stubEnv("AI_API_KEY", "");
    await resetDb();
    env = await setup();
  });
  afterEach(() => {
    standInForBotApi(null);
    vi.unstubAllEnvs();
  });

  it("brings a leave request with Approve and Reject, and approves it through the ERP's own service, with AI off", async () => {
    const api = botApi();
    await saveTelegram(env.owner, { token: TOKEN });
    await linkTo(env.owner, OWNER_CHAT);
    // The AI is off (the default): approvals still come, they are the system's own messages.
    const request = await askLeave(env);
    await runDueJobs();
    expect(api.said(OWNER_CHAT).at(-1)).toMatch(/^Waiting for your approval: Leave: Rahim Uddin/);
    const [approve, reject] = api.buttons(OWNER_CHAT);
    expect(approve).toMatchObject({
      text: "Approve",
      callback_data: expect.stringMatching(/^ok:l:/),
    });
    expect(reject).toMatchObject({
      text: "Reject",
      callback_data: expect.stringMatching(/^no:l:/),
    });

    await telegram(press(OWNER_CHAT, approve!.callback_data));
    expect(api.said(OWNER_CHAT).at(-1)).toBe("Approved: the leave is on the calendar.");
    const row = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row).toMatchObject({ status: "APPROVED", approvedById: env.owner.user.id });
    // The ERP's own activity log keeps it, in the person's name.
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: request.id,
          userId: env.owner.user.id,
          summary: { startsWith: "Approved" },
        },
      }),
    ).toBe(1);

    // Pressed again (or decided in the ERP): it says who decided, and does nothing.
    await telegram(press(OWNER_CHAT, approve!.callback_data));
    expect(api.said(OWNER_CHAT).at(-1)).toBe(
      `Already decided by ${env.owner.user.name}: Leave: Rahim Uddin. Nothing was done.`,
    );
  });

  it("rejects with the reason the person writes next, and stops on বাতিল", async () => {
    const api = botApi();
    await saveTelegram(env.owner, { token: TOKEN });
    await linkTo(env.owner, OWNER_CHAT);
    await setPin(env.owner, { pin: "2468" });
    const request = await askLeave(env);
    await runDueJobs();
    const [, reject] = api.buttons(OWNER_CHAT);

    await telegram(press(OWNER_CHAT, reject!.callback_data));
    expect(api.said(OWNER_CHAT).at(-1)).toBe(
      'Write why you reject Leave: Rahim Uddin. (Write "বাতিল" to stop.)',
    );
    await telegram(typed(OWNER_CHAT, "বাতিল"));
    expect(api.said(OWNER_CHAT).at(-1)).toBe("Stopped: nothing changed.");
    expect(
      (await prisma.leaveRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
    ).toBe("PENDING");

    await telegram(press(OWNER_CHAT, reject!.callback_data));
    // The reason is words, never taken for a PIN.
    await telegram(typed(OWNER_CHAT, "Shipment week, everyone is needed"));
    expect(api.said(OWNER_CHAT).at(-1)).toBe(
      "Rejected: the leave request is turned down with your reason.",
    );
    expect(
      await prisma.leaveRequest.findUniqueOrThrow({ where: { id: request.id } }),
    ).toMatchObject({ status: "REJECTED", decisionNote: "Shipment week, everyone is needed" });
    expect(await prisma.aiPinTry.count()).toBe(0);
  });

  it("offers only Reject for an expense claim: it is approved in the ERP, where the account is picked", async () => {
    const api = botApi();
    await saveTelegram(env.owner, { token: TOKEN });
    await linkTo(env.owner, OWNER_CHAT);
    await setPin(env.owner, { pin: "2468" });
    const claim = await expenses.createExpense(env.staff, {
      headId: env.head.id,
      amount: 300,
      paymentType: "CASH_BANK",
      description: "Printer paper",
    });
    await runDueJobs();
    const text = api.said(OWNER_CHAT).at(-1)!;
    expect(text).toMatch(new RegExp(`^Waiting for your approval: Expense claim ${claim.number}`));
    expect(text).toContain("Approve in the ERP: https://erp.test/accounts/expenses");
    expect(text).not.toContain("PIN");
    const buttons = api.buttons(OWNER_CHAT);
    expect(buttons.map((b) => b.text)).toEqual(["Reject"]);

    // An Approve button made by hand does nothing and asks for no PIN.
    await telegram(press(OWNER_CHAT, buttons[0]!.callback_data.replace(/^no:/, "ok:")));
    expect(api.said(OWNER_CHAT).at(-1)).toBe(
      `Approve Expense claim ${claim.number} in the ERP, where you pick the “Paid from” account: https://erp.test/accounts/expenses. Nothing was done here.`,
    );
    expect(
      (await prisma.expense.findUniqueOrThrow({ where: { id: claim.id } })).journalEntryId,
    ).toBeNull();
    expect(await prisma.journalEntry.count()).toBe(0);

    // Reject works here, with the reason written next.
    await telegram(press(OWNER_CHAT, buttons[0]!.callback_data));
    await telegram(typed(OWNER_CHAT, "Paper was bought last week"));
    expect(api.said(OWNER_CHAT).at(-1)).toBe(
      `Rejected: claim ${claim.number} is turned down with your reason.`,
    );
    expect(await prisma.journalEntry.count()).toBe(0);
  });

  it("shows a booking's total quantity and value, and a changed quantity makes the old button stale", async () => {
    const api = botApi();
    await saveTelegram(env.owner, { token: TOKEN });
    await linkTo(env.owner, OWNER_CHAT);
    const mill = (
      await parties.createParty(env.owner, { kind: "SUPPLIER", name: "Narayanganj Fabrics" })
    ).party;
    const jersey = await materials.createMaterial(env.owner, {
      name: "Single Jersey 180 GSM",
      kind: "FABRIC",
      unit: "KG",
      supplierId: mill.id,
    });
    const order = await prisma.purchaseOrder.create({
      data: {
        companyId: env.company.id,
        number: "PO-BOT-1",
        supplierId: mill.id,
        orderDate: new Date(),
        lines: {
          create: [{ rawMaterialId: jersey.id, quantity: 1200, unitPrice: 4.5, amount: 5400 }],
        },
      },
      include: { lines: true },
    });
    const booking = await prisma.booking.create({
      data: {
        companyId: env.company.id,
        orderId: order.id,
        source: "SUPPLIER_PO",
        category: "KNITWEAR",
        terms: "Delivery within 30 days",
      },
    });
    await notifyApprovers(env.company.id, "booking", booking.id);
    await runDueJobs();
    const text = api.said(OWNER_CHAT).at(-1)!;
    expect(text).toMatch(/^Waiting for your approval: Booking/);
    expect(text).toContain("Total quantity: 1,200 kg");
    expect(text).toMatch(/Total value: [A-Z]{3} 5,400\.00/);
    const [approve] = api.buttons(OWNER_CHAT);
    expect(approve!.callback_data).toMatch(/^ok:b:/);

    // The quantity and price change after the message: its button no longer approves.
    await prisma.purchaseOrderLine.update({
      where: { id: order.lines[0]!.id },
      data: { quantity: 1500, amount: 6750 },
    });
    await telegram(press(OWNER_CHAT, approve!.callback_data));
    const said = api.said(OWNER_CHAT);
    expect(said.at(-2)).toMatch(/changed after that message showed it, so nothing was done/);
    expect(said.at(-1)).toContain("Total quantity: 1,500 kg");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).stage).toBe(
      "DRAFT",
    );
  });

  it("re-checks the person's permission at the press, and sends nothing to someone who cannot approve", async () => {
    const api = botApi();
    const hrRole = await createRole(env.owner, {
      name: "HR lead",
      permissions: ["dashboard.view", "ai.manage", "hr.view", "hr.manage"],
    });
    const hr = await env.join(hrRole.id, "hr");
    await saveTelegram(env.owner, { token: TOKEN });
    await linkTo(hr, HR_CHAT);

    // An expense claim is Accounts': HR gets nothing.
    await expenses.createExpense(env.staff, {
      headId: env.head.id,
      amount: 120,
      paymentType: "CASH_BANK",
    });
    await runDueJobs();
    expect(api.said(HR_CHAT).filter((t) => t.startsWith("Waiting"))).toEqual([]);

    const request = await askLeave(env);
    await runDueJobs();
    const [approve] = api.buttons(HR_CHAT);
    expect(approve!.callback_data).toMatch(/^ok:l:/);

    // The owner takes hr.manage away before the press.
    const permission = await prisma.permission.findUniqueOrThrow({ where: { key: "hr.manage" } });
    await prisma.rolePermission.deleteMany({
      where: { roleId: hrRole.id, permissionId: permission.id },
    });
    await telegram(press(HR_CHAT, approve!.callback_data));
    expect(api.said(HR_CHAT).at(-1)).toBe(
      "Not done: you may no longer approve a leave request. Ask the owner in the ERP.",
    );
    expect(
      (await prisma.leaveRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
    ).toBe("PENDING");

    // Decided in the ERP afterwards: someone without the permission still learns nothing more.
    await leave.approveLeave(env.owner, request.id, {});
    await telegram(press(HR_CHAT, approve!.callback_data));
    expect(api.said(HR_CHAT).at(-1)).toBe(
      "Not done: you may no longer approve a leave request. Ask the owner in the ERP.",
    );
    expect(api.said(HR_CHAT).some((t) => t.startsWith("Already decided"))).toBe(false);
  });

  it("shows a changed item again instead of approving what the message showed", async () => {
    const api = botApi();
    await saveTelegram(env.owner, { token: TOKEN });
    await linkTo(env.owner, OWNER_CHAT);
    const request = await askLeave(env);
    await runDueJobs();
    const [approve] = api.buttons(OWNER_CHAT);
    await prisma.leaveRequest.update({ where: { id: request.id }, data: { reason: "Wedding" } });
    await telegram(press(OWNER_CHAT, approve!.callback_data));
    const said = api.said(OWNER_CHAT);
    expect(said.at(-2)).toBe(
      "Leave: Rahim Uddin changed after that message showed it, so nothing was done. Here it is as it is now:",
    );
    expect(said.at(-1)).toContain("Reason: Wedding");
    expect(
      (await prisma.leaveRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
    ).toBe("PENDING");
  });

  it("never touches another store's item from a button, and respects the person's own switch", async () => {
    const api = botApi();
    await saveTelegram(env.owner, { token: TOKEN });
    await linkTo(env.owner, OWNER_CHAT);
    const other = await setup("Other");
    const theirs = await askLeave(other);
    await runDueJobs();
    // Their approvers are not linked here: nothing came to this chat.
    expect(api.said(OWNER_CHAT).filter((t) => t.startsWith("Waiting"))).toEqual([]);

    const mine = await askLeave(env);
    await runDueJobs();
    const [approve] = api.buttons(OWNER_CHAT);
    // The same button with the other store's request in it.
    const forged = approve!.callback_data.replace(mine.id, theirs.id);
    await telegram(press(OWNER_CHAT, forged));
    expect(api.calls.filter((c) => c.method === "answerCallbackQuery").at(-1)?.json.text).toBe(
      "This is not there any more.",
    );
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe(
      "PENDING",
    );

    // Turned off: nothing more comes (it still waits in the ERP).
    await setApprovalSetting(env.owner, { sendApprovals: false });
    const before = api.said(OWNER_CHAT).length;
    await askLeave(env, 30);
    await runDueJobs();
    expect(api.said(OWNER_CHAT)).toHaveLength(before);

    // On again, with the AI on or off alike.
    await setApprovalSetting(env.owner, { sendApprovals: true });
    await setAiSwitch(env.owner, true);
    await askLeave(env, 40);
    await runDueJobs();
    expect(api.said(OWNER_CHAT).at(-1)).toMatch(/^Waiting for your approval: Leave/);
  });
});
