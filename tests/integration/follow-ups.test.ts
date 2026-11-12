import { beforeEach, describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";
import { formatDay } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import * as catalog from "@/modules/inventory/catalog.service";
import * as styles from "@/modules/inventory/style.service";
import * as parties from "@/modules/parties/party.service";
import { runReminders } from "@/modules/reminders/engine";
import * as followUps from "@/modules/reminders/follow-up.service";
import * as quotations from "@/modules/sales/quotation.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** 10:00 in Dhaka on a day ("2026-11-20"), after the 09:00 send time. */
const at = (day: string) => new Date(`${day}T04:00:00Z`);

const ROLES = ["SALES_EXECUTIVE", "WAREHOUSE_TEAM", "ACCOUNTS", "EMPLOYEE"] as const;

async function setup(name: string) {
  const { company, roles } = await makeCompany(name);
  // The owner: the platform owner, as on a real server (the one an alarm reaches on the bot).
  const ownerUser = await makeUser(`owner@${company.slug}.test`, { isSuperAdmin: true });
  await addToCompany(ownerUser.id, company.id, roles.SUPER_ADMIN);
  const owner = await contextFor(ownerUser.id, company.id);
  const as = {} as Record<(typeof ROLES)[number], CompanyContext>;
  for (const role of ROLES) {
    const user = await makeUser(`${role.toLowerCase()}@${company.slug}.test`);
    await addToCompany(user.id, company.id, roles[role]);
    as[role] = await contextFor(user.id, company.id);
  }
  const tops = await catalog.createCategory(owner, { name: "Tops" });
  const brand = await catalog.createBrand(owner, { name: `${name} Men` });
  const polo = await styles.createStyle(owner, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    brandId: brand.id,
    wholesalePrice: 900,
  });
  const buyer = (await parties.createParty(owner, { kind: "BUYER", name: "Rahim Traders" })).party;
  const quote = (validUntil: string) =>
    quotations.createQuotation(owner, {
      partyId: buyer.id,
      validUntil,
      items: [
        {
          categoryId: tops.id,
          styleId: polo.id,
          description: "Pique polo",
          sizeBreakdown: { S: 10 },
          unitPrice: 650,
        },
      ],
    });
  let n = 0;
  /** An unpaid invoice of 10,000 due on a day (made straight in the database). */
  const invoice = async (dueDay: string | null, status: "UNPAID" | "PAID" = "UNPAID") => {
    n += 1;
    const order = await prisma.salesOrder.create({
      data: {
        companyId: company.id,
        number: `SO-${name}-${n}`,
        channel: "WHOLESALE",
        partyId: buyer.id,
        total: 10000,
        dueAmount: status === "PAID" ? 0 : 10000,
      },
    });
    return prisma.invoice.create({
      data: {
        companyId: company.id,
        number: `INV-${name}-${n}`,
        orderId: order.id,
        partyId: buyer.id,
        total: 10000,
        paidAmount: status === "PAID" ? 10000 : 0,
        dueAmount: status === "PAID" ? 0 : 10000,
        status,
        dueDate: dueDay ? new Date(`${dueDay}T00:00:00+06:00`) : null,
      },
    });
  };
  return { company, owner, as, buyer, quote, invoice };
}

type Env = Awaited<ReturnType<typeof setup>>;

/** The inbox messages a person has, subjects only. */
const inbox = async (ctx: CompanyContext) =>
  (
    await prisma.notificationLog.findMany({
      where: { userId: ctx.user.id, companyId: ctx.company.id, channel: "IN_APP" },
      orderBy: { createdAt: "asc" },
      select: { subject: true },
    })
  ).map((m) => m.subject);

const reminderKeys = async (env: Env) =>
  (
    await prisma.reminder.findMany({
      where: { companyId: env.company.id },
      orderBy: { createdAt: "asc" },
      select: { sourceKey: true },
    })
  ).map((r) => r.sourceKey);

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

run("follow-up reminders without the AI", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("reminds about a quotation ending, then once that it expired, never twice", async () => {
    const env = await setup("Extras");
    // The AI is off (the default): the reminders still go.
    expect(await prisma.aiSettings.count({ where: { enabled: true } })).toBe(0);
    const q = await env.quote("2026-11-23");
    await runReminders(at("2026-11-20"), { companyId: env.company.id });
    const subject = `Quotation ends: Quotation ${q.number} for Rahim Traders`;
    expect(await inbox(env.as.SALES_EXECUTIVE)).toEqual([subject]);
    expect(await inbox(env.owner)).toEqual([subject]);
    // The store and Accounts do not make quotations.
    expect(await inbox(env.as.WAREHOUSE_TEAM)).toEqual([]);
    // The clock runs again (every minute): nothing new.
    await runReminders(at("2026-11-20"), { companyId: env.company.id });
    await runReminders(new Date("2026-11-20T10:00:00Z"), { companyId: env.company.id });
    expect(await inbox(env.as.SALES_EXECUTIVE)).toHaveLength(1);
    // Its last day, then the day after: expired.
    await runReminders(at("2026-11-23"), { companyId: env.company.id });
    await runReminders(at("2026-11-24"), { companyId: env.company.id });
    await runReminders(at("2026-11-25"), { companyId: env.company.id });
    expect(await inbox(env.as.SALES_EXECUTIVE)).toEqual([
      subject,
      subject,
      `Quotation expired: Quotation ${q.number} for Rahim Traders`,
    ]);
    expect(await reminderKeys(env)).toEqual([
      `QUOTATION_EXPIRY:${q.id}:2026-11-23:d3`,
      `QUOTATION_EXPIRY:${q.id}:2026-11-23:d0`,
      `QUOTATION_EXPIRY:${q.id}:2026-11-23:late0`,
    ]);
    // An accepted quotation is not followed up.
    const accepted = await env.quote("2026-11-26");
    await prisma.quotation.update({ where: { id: accepted.id }, data: { status: "ACCEPTED" } });
    await runReminders(at("2026-11-26"), { companyId: env.company.id });
    expect((await reminderKeys(env)).some((k) => k?.includes(accepted.id))).toBe(false);
  });

  it("reminds about an invoice's due date and when it is overdue, until it is paid", async () => {
    const env = await setup("Extras");
    const unpaid = await env.invoice("2026-11-20");
    const paid = await env.invoice("2026-11-20", "PAID");
    await runReminders(at("2026-11-20"), { companyId: env.company.id });
    const subject = `Payment due: Invoice ${unpaid.number} for Rahim Traders`;
    expect(await inbox(env.as.ACCOUNTS)).toEqual([subject]);
    expect(await inbox(env.as.SALES_EXECUTIVE)).toEqual([subject]);
    expect(await inbox(env.owner)).toEqual([subject]);
    const body = await prisma.notificationLog.findFirstOrThrow({
      where: { userId: env.as.ACCOUNTS.user.id },
    });
    expect(body.body).toContain("10,000.00 BDT still due");
    expect(body.entityType).toBe("Invoice");
    // Overdue: again after the rule's 3 days, once.
    await runReminders(at("2026-11-21"), { companyId: env.company.id });
    await runReminders(at("2026-11-21"), { companyId: env.company.id });
    expect(await inbox(env.as.ACCOUNTS)).toHaveLength(2);
    await runReminders(at("2026-11-23"), { companyId: env.company.id });
    expect(await inbox(env.as.ACCOUNTS)).toHaveLength(2);
    await runReminders(at("2026-11-24"), { companyId: env.company.id });
    expect(await inbox(env.as.ACCOUNTS)).toHaveLength(3);
    expect((await reminderKeys(env)).some((k) => k?.includes(paid.id))).toBe(false);
    // Paid in full: no more.
    await prisma.invoice.update({
      where: { id: unpaid.id },
      data: { status: "PAID", paidAmount: 10000, dueAmount: 0 },
    });
    await runReminders(at("2026-11-27"), { companyId: env.company.id });
    expect(await inbox(env.as.ACCOUNTS)).toHaveLength(3);
  });

  it("reminds on the day the buyer promised to pay, to whoever wrote it down and the owner", async () => {
    const env = await setup("Extras");
    const inv = await env.invoice(null);
    const seller = env.as.SALES_EXECUTIVE;
    // People who neither sell, edit invoices nor take money cannot write it down.
    await expectAppError(
      followUps.setPromisedPayment(env.as.WAREHOUSE_TEAM, inv.id, { promisedPayOn: "2026-11-22" }),
      "FORBIDDEN",
    );
    await followUps.setPromisedPayment(seller, inv.id, {
      promisedPayOn: "2026-11-22",
      note: "Said on the phone",
    });
    const saved = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(saved.promisedPayOn?.toISOString().slice(0, 10)).toBe("2026-11-22");
    expect(saved.promiseNote).toBe("Said on the phone");
    // No money moved.
    expect(saved.paidAmount.toString()).toBe("0");
    await runReminders(at("2026-11-21"), { companyId: env.company.id });
    expect(await inbox(seller)).toEqual([]);
    await runReminders(at("2026-11-22"), { companyId: env.company.id });
    await runReminders(at("2026-11-22"), { companyId: env.company.id });
    const subject = `Promised payment: Invoice ${inv.number} for Rahim Traders`;
    expect(await inbox(seller)).toEqual([subject]);
    expect(await inbox(env.owner)).toEqual([subject]);
    // Cleared: nothing more.
    await followUps.setPromisedPayment(seller, inv.id, { promisedPayOn: null });
    await runReminders(at("2026-11-24"), { companyId: env.company.id });
    expect(await inbox(seller)).toHaveLength(1);
  });

  it("reminds about a Follow up on date set by hand; Done stops it and Snooze moves it", async () => {
    const env = await setup("Extras");
    const seller = env.as.SALES_EXECUTIVE;
    const now = at("2026-11-18");
    // Not on a past day; and only by people who see that record.
    await expectAppError(
      followUps.createFollowUp(
        seller,
        { partyId: env.buyer.id, dueOn: "2026-11-17" },
        undefined,
        now,
      ),
      "VALIDATION",
    );
    await expectAppError(
      followUps.createFollowUp(
        env.as.WAREHOUSE_TEAM,
        { partyId: env.buyer.id, dueOn: "2026-11-20" },
        undefined,
        now,
      ),
      "FORBIDDEN",
    );
    const first = await followUps.createFollowUp(
      seller,
      { partyId: env.buyer.id, dueOn: "2026-11-20", note: "Ask about the sample approval" },
      undefined,
      now,
    );
    const second = await followUps.createFollowUp(
      seller,
      { partyId: env.buyer.id, dueOn: "2026-11-20", note: "Send the new price list" },
      undefined,
      now,
    );
    expect(
      (await followUps.listFollowUps(seller, { partyId: env.buyer.id }, now)).items,
    ).toHaveLength(2);

    // Snooze the second to the 23rd; the first fires on the 20th.
    await followUps.snoozeFollowUp(
      seller,
      { mark: { target: "followUp", id: second.id }, until: "2026-11-23" },
      undefined,
      at("2026-11-19"),
    );
    await runReminders(at("2026-11-20"), { companyId: env.company.id });
    await runReminders(at("2026-11-20"), { companyId: env.company.id });
    expect(await inbox(seller)).toEqual(["Follow up: Rahim Traders"]);
    expect(await inbox(env.owner)).toEqual(["Follow up: Rahim Traders"]);
    // Others who did not set it are not told.
    expect(await inbox(env.as.ACCOUNTS)).toEqual([]);

    // Home shows the first (due today) with its note; the snoozed one waits.
    const card = await followUps.todaysFollowUps(seller, at("2026-11-20"));
    expect(card.items.map((i) => [i.kind, i.title, i.detail, i.href])).toEqual([
      [
        "FOLLOW_UP",
        "Rahim Traders",
        "Ask about the sample approval",
        `/parties/buyers/${env.buyer.id}`,
      ],
    ]);

    // Done: off the card, and no overdue reminder later.
    await followUps.markFollowUpDone(seller, card.items[0]!.mark, undefined, at("2026-11-20"));
    expect((await followUps.todaysFollowUps(seller, at("2026-11-21"))).items).toEqual([]);
    await runReminders(at("2026-11-22"), { companyId: env.company.id });
    expect(await inbox(seller)).toHaveLength(1);

    // The snoozed one comes back on its new day.
    await runReminders(at("2026-11-23"), { companyId: env.company.id });
    expect(await inbox(seller)).toEqual(["Follow up: Rahim Traders", "Follow up: Rahim Traders"]);
    expect(
      (await followUps.todaysFollowUps(seller, at("2026-11-23"))).items.map((i) => i.detail),
    ).toEqual(["Send the new price list"]);
    expect(first.id).not.toBe(second.id);
  });

  it("shows Today's follow-ups by permission and company, and Done or Snooze on a quotation's date", async () => {
    const env = await setup("Extras");
    const other = await setup("Other House");
    const q = await env.quote("2026-11-20");
    await followUps.createFollowUp(
      env.as.SALES_EXECUTIVE,
      { partyId: env.buyer.id, dueOn: "2026-11-20" },
      undefined,
      at("2026-11-19"),
    );
    const day = at("2026-11-20");
    const kinds = async (ctx: CompanyContext) =>
      (await followUps.todaysFollowUps(ctx, day)).items.map((i) => i.kind).sort();

    expect(await kinds(env.as.SALES_EXECUTIVE)).toEqual(["FOLLOW_UP", "QUOTATION_EXPIRY"]);
    // The store sees sales but not buyers' profiles: no follow-up on a buyer.
    expect(await kinds(env.as.WAREHOUSE_TEAM)).toEqual(["QUOTATION_EXPIRY"]);
    // An employee sees none.
    expect(await kinds(env.as.EMPLOYEE)).toEqual([]);
    expect(followUps.seesFollowUps(env.as.EMPLOYEE)).toBe(false);
    // Another company sees nothing of this one.
    expect(await kinds(other.owner)).toEqual([]);
    await expectAppError(
      followUps.markFollowUpDone(other.owner, {
        target: "date",
        kind: "QUOTATION_EXPIRY",
        recordId: q.id,
        day: "2026-11-20",
      }),
      "NOT_FOUND",
    );
    const theirFollowUp = (await followUps.todaysFollowUps(env.as.SALES_EXECUTIVE, day)).items.find(
      (i) => i.kind === "FOLLOW_UP",
    )!;
    await expectAppError(followUps.markFollowUpDone(other.owner, theirFollowUp.mark), "NOT_FOUND");

    // Snooze the quotation's date to the 22nd: gone today, back then, and its reminder too.
    const quoteItem = (await followUps.todaysFollowUps(env.owner, day)).items.find(
      (i) => i.kind === "QUOTATION_EXPIRY",
    )!;
    expect(quoteItem.href).toBe(`/sales/quotations/${q.id}`);
    await expectAppError(
      followUps.snoozeFollowUp(
        env.owner,
        { mark: quoteItem.mark, until: "2026-11-20" },
        undefined,
        day,
      ),
      "VALIDATION",
    );
    await followUps.snoozeFollowUp(
      env.owner,
      { mark: quoteItem.mark, until: "2026-11-22" },
      undefined,
      day,
    );
    expect(await kinds(env.owner)).toEqual(["FOLLOW_UP"]);
    // Its reminder waits for the new day (not "3 days before" it), then comes once,
    // telling the quotation's own end date.
    const quoteKeys = async () =>
      (await reminderKeys(env)).filter((k) => k?.startsWith("QUOTATION_EXPIRY"));
    await runReminders(at("2026-11-21"), { companyId: env.company.id });
    expect(await quoteKeys()).toEqual([]);
    await runReminders(at("2026-11-22"), { companyId: env.company.id });
    await runReminders(at("2026-11-22"), { companyId: env.company.id });
    expect(await quoteKeys()).toEqual([`QUOTATION_EXPIRY:${q.id}:2026-11-22:d0`]);
    const told = await prisma.notificationLog.findFirstOrThrow({
      where: { userId: env.owner.user.id, subject: { startsWith: "Quotation expired" } },
    });
    expect(told.body).toContain(`Its validity ended on ${formatDay("2026-11-20")}`);
    expect(
      (await followUps.todaysFollowUps(env.owner, at("2026-11-22"))).items
        .filter((i) => i.kind === "QUOTATION_EXPIRY")
        .map((i) => [i.dueOn, i.daysLeft]),
    ).toEqual([["2026-11-20", -2]]);
    // Done on it from the 22nd: it stays off for good.
    const back = (await followUps.todaysFollowUps(env.owner, at("2026-11-22"))).items.find(
      (i) => i.kind === "QUOTATION_EXPIRY",
    )!;
    await followUps.markFollowUpDone(env.owner, back.mark, undefined, at("2026-11-22"));
    expect(
      (await followUps.todaysFollowUps(env.owner, at("2026-11-25"))).items.map((i) => i.kind),
    ).not.toContain("QUOTATION_EXPIRY");
    await runReminders(at("2026-11-25"), { companyId: env.company.id });
    expect(await quoteKeys()).toHaveLength(1);
  });

  it("tells the owner's linked bot about the follow-ups, AI on or off", async () => {
    const env = await setup("Extras");
    await prisma.aiBotLink.create({
      data: {
        companyId: env.company.id,
        channel: "TELEGRAM",
        botKey: `bot-${env.company.id}`,
        tokenSealed: "sealed",
        webhookKey: `hook-${env.company.id}`,
        ownerId: env.owner.user.id,
        chatId: "555001",
        linkedAt: new Date(),
      },
    });
    await env.invoice("2026-11-20");
    await runReminders(at("2026-11-20"), { companyId: env.company.id });
    const jobs = await prisma.backgroundJob.findMany({
      where: { companyId: env.company.id, kind: "ai.bot.push" },
    });
    expect(jobs).toHaveLength(1);
    expect(JSON.stringify(jobs[0]!.payload)).toContain("Follow-ups for today (1)");
    expect(jobs[0]!.payload).toMatchObject({ kind: "text", alarm: true });
    // Run again: nothing new fired, nothing new on the bot.
    await runReminders(at("2026-11-20"), { companyId: env.company.id });
    expect(
      await prisma.backgroundJob.count({
        where: { companyId: env.company.id, kind: "ai.bot.push" },
      }),
    ).toBe(1);
  });
});
