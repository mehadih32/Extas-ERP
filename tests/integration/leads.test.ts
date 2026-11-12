import { beforeEach, describe, expect, it } from "vitest";

import { addDays, localDay, startOfDayInZone } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { setPin } from "@/modules/ai/settings.service";
import * as leads from "@/modules/leads/lead.service";
import { runReminders } from "@/modules/reminders/engine";
import { recordHref } from "@/modules/reminders/links";
import { createQuotation } from "@/modules/sales/quotation.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const PIN = "2468";

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

/** Extas with the owner (PIN set) and two sales executives; a second company for the tenant lock. */
async function setup() {
  const { company, roles } = await makeCompany("Extas");
  const member = async (role: keyof typeof roles, who: string, companyId = company.id) => {
    const user = await makeUser(`${who}@${company.slug}.test`);
    await addToCompany(
      user.id,
      companyId,
      role === "SUPER_ADMIN" ? roles.SUPER_ADMIN : roles[role],
    );
    return { user, ctx: await contextFor(user.id, companyId) };
  };
  const owner = await member("SUPER_ADMIN", "owner");
  const rahim = await member("SALES_EXECUTIVE", "rahim");
  const karim = await member("SALES_EXECUTIVE", "karim");
  await setPin(owner.ctx, { pin: PIN });
  const other = await makeCompany("Other House");
  const outsiderUser = await makeUser(`boss@${other.company.slug}.test`);
  await addToCompany(outsiderUser.id, other.company.id, other.roles.SUPER_ADMIN);
  const outsider = { user: outsiderUser, ctx: await contextFor(outsiderUser.id, other.company.id) };
  return { company, owner, rahim, karim, outsider };
}

type Env = Awaited<ReturnType<typeof setup>>;
const today = (env: Env) => localDay(new Date(), env.company.timezone);

const nordic = {
  name: "Nordic Wear AB",
  website: "https://www.nordicwear.se/about",
  country: "Sweden",
  category: "BRAND" as const,
  products: ["Polo"],
  piecesPerStyle: 3000,
  targetPrice: 4.5,
  expectedValue: 120000,
  paymentTerms: "LC" as const,
  contact: {
    name: "Anna Berg",
    jobTitle: "Sourcing manager",
    email: "Anna@nordicwear.se",
    phone: "+46 70 123 4567",
    isDecisionMaker: true,
  },
};

run("Leads (Sales > Leads, phase 1)", () => {
  let env: Env;
  beforeEach(async () => {
    await resetDb();
    env = await setup();
  });

  it("adds a lead with its contact, number, next step and first history line", async () => {
    const added = await leads.addLead(env.rahim.ctx, nordic);
    expect(added.number).toBe("LD-0001");
    const lead = await leads.getLead(env.rahim.ctx, added.id);
    expect(lead.owner?.id).toBe(env.rahim.user.id);
    expect(lead.contacts).toHaveLength(1);
    expect(lead.contacts[0]!.email).toBe("anna@nordicwear.se");
    expect(lead.contacts[0]!.isPrimary).toBe(true);
    // No next step given: the settings' 7 days from today.
    expect(lead.nextActionOn).toBe(addDays(today(env), 7));
    expect(lead.activities.map((a) => a.summary)).toEqual(["Lead added"]);
    // The check card: polo (no product focus set yet: yellow), LC from Sweden (green), decider known.
    expect(lead.check.map((c) => c.key)).toEqual([
      "products",
      "quantity",
      "price",
      "risk",
      "decider",
    ]);
    expect(lead.check.find((c) => c.key === "decider")!.colour).toBe("green");
    // Sources are made for each company the first time.
    expect(await prisma.leadSource.count({ where: { companyId: env.company.id } })).toBeGreaterThan(
      3,
    );
  });

  it("warns of duplicates against leads and buyers, and blocks the same lead twice", async () => {
    await leads.addLead(env.rahim.ctx, nordic);
    // Same website: the same lead, blocked (open the existing one).
    const same = await expectAppError(
      leads.addLead(env.karim.ctx, { name: "NW Sweden", website: "nordicwear.se" }),
      "CONFLICT",
    );
    // Karim may not open Rahim's lead: the warning never names it.
    expect(same.message).toContain("a lead already followed by someone else");
    expect(same.message).not.toContain("LD-0001");
    expect(same.message).not.toContain("Nordic Wear AB");
    const hidden = await leads.checkLeadDuplicates(env.karim.ctx, {
      name: "NW",
      website: "nordicwear.se",
    });
    expect(hidden.matches[0]).toMatchObject({ id: "", hidden: true });
    // The owner sees every lead: named, with its link.
    const named = await leads.checkLeadDuplicates(env.owner.ctx, {
      name: "NW",
      website: "nordicwear.se",
    });
    expect(named.matches[0]!.label).toContain("LD-0001");
    expect(named.matches[0]!.hidden).toBe(false);
    // Same email, another spelling of the name: blocked too.
    await expectAppError(
      leads.addLead(env.karim.ctx, {
        name: "Nordic",
        contact: { name: "A. Berg", email: "anna@NORDICWEAR.se" },
      }),
      "CONFLICT",
    );
    // A similar name in the same country: a warning, saved after "Save anyway".
    await expectAppError(
      leads.addLead(env.karim.ctx, { name: "Nordic Wear", country: "Sweden" }),
      "CONFLICT",
    );
    const anyway = await leads.addLead(env.karim.ctx, {
      name: "Nordic Wear",
      country: "Sweden",
      confirmDuplicate: true,
    });
    expect(anyway.number).toBe("LD-0002");

    // An existing buyer with the same phone is found too.
    const buyer = await prisma.party.create({
      data: {
        companyId: env.company.id,
        code: "BUY-0001",
        kind: "BUYER",
        buyerType: "WHOLESALE",
        name: "Baltic Basics",
        phone: "+49 30 555 0101",
      },
    });
    const check = await leads.checkLeadDuplicates(env.karim.ctx, {
      name: "Baltic Basics GmbH",
      phone: "0049 30 555 0101",
    });
    expect(check.matches.map((m) => [m.kind, m.id])).toContainEqual(["BUYER", buyer.id]);
    expect(check.matches[0]!.why).toContain("same phone");
    // Free-mail domains never match two companies.
    expect(
      (
        await leads.checkLeadDuplicates(env.karim.ctx, {
          name: "Totally Different",
          email: "someone@gmail.com",
        })
      ).matches,
    ).toEqual([]);
  });

  it("keeps the history append-only: lines are only added, a correction is a new note", async () => {
    const { id } = await leads.addLead(env.rahim.ctx, nordic);
    await leads.logLeadActivity(env.rahim.ctx, id, { kind: "CALL", summary: "Called Anna" });
    await leads.logLeadActivity(env.rahim.ctx, id, {
      kind: "NOTE",
      summary: "Correction: the call was about polos, not tees",
    });
    const lead = await leads.getLead(env.rahim.ctx, id);
    // The first contact moved it on from New.
    expect(lead.stage).toBe("CONTACTED");
    expect(lead.activities.map((a) => a.kind)).toEqual(
      expect.arrayContaining(["NOTE", "CALL", "STAGE"]),
    );
    expect(lead.activities).toHaveLength(4);
    // The module has no way to change or remove a history line.
    const exported = Object.keys(leads);
    expect(exported.filter((k) => /^(edit|update|delete|remove)(Lead)?Activit/i.test(k))).toEqual(
      [],
    );
    // A future day is refused.
    await expectAppError(
      leads.logLeadActivity(env.rahim.ctx, id, {
        kind: "MEETING",
        summary: "Will meet",
        occurredOn: addDays(today(env), 2),
      }),
      "VALIDATION",
    );
    // Lost needs a reason; the stage change is a history line.
    await expectAppError(leads.changeLeadStage(env.rahim.ctx, id, { stage: "LOST" }), "VALIDATION");
    await leads.changeLeadStage(env.rahim.ctx, id, { stage: "LOST", reason: "Price" });
    const lost = await leads.getLead(env.rahim.ctx, id);
    expect(lost.stage).toBe("LOST");
    expect(lost.lostReason).toBe("Price");
    expect(lost.activities[0]!.summary).toContain("Lost: Price");
  });

  it("shows staff their own and unassigned leads only; the owner sees all and alone exports", async () => {
    const mine = await leads.addLead(env.rahim.ctx, nordic);
    const nobodys = await leads.addLead(env.rahim.ctx, {
      name: "Atlas Uniforms",
      country: "UAE",
      ownerUserId: null,
    });
    const karims = await leads.addLead(env.karim.ctx, {
      name: "Pacific Promo",
      country: "Australia",
    });

    const rahimList = await leads.listLeads(env.rahim.ctx);
    expect(rahimList.rows.map((r) => r.id).sort()).toEqual([mine.id, nobodys.id].sort());
    await expectAppError(leads.getLead(env.rahim.ctx, karims.id), "NOT_FOUND");
    await expectAppError(
      leads.logLeadActivity(env.rahim.ctx, karims.id, { kind: "NOTE", summary: "Peek" }),
      "NOT_FOUND",
    );
    expect((await leads.listLeads(env.owner.ctx)).rows).toHaveLength(3);

    // Staff cannot give leads to others; the owner can.
    await expectAppError(
      leads.addLead(env.rahim.ctx, { name: "Some Co", ownerUserId: env.karim.user.id }),
      "FORBIDDEN",
    );
    await expectAppError(
      leads.assignLead(env.rahim.ctx, mine.id, { ownerUserId: env.karim.user.id }),
      "FORBIDDEN",
    );
    await leads.assignLead(env.owner.ctx, mine.id, { ownerUserId: env.karim.user.id });
    await expectAppError(leads.getLead(env.rahim.ctx, mine.id), "NOT_FOUND");
    // Only the owner downloads the list, and it is logged.
    await expectAppError(leads.exportLeads(env.karim.ctx), "FORBIDDEN");
    const file = await leads.exportLeads(env.owner.ctx);
    const text = file.bytes.toString("utf8");
    expect(text).toContain("LD-0001");
    expect(text).toContain("anna@nordicwear.se");
    expect(
      await prisma.auditLog.count({ where: { companyId: env.company.id, action: "EXPORT" } }),
    ).toBe(1);
    // The follow-ups card for Rahim: only his visible leads.
    const card = await leads.leadFollowUps(
      env.rahim.ctx,
      startOfDayInZone(addDays(today(env), 8), env.company.timezone),
    );
    expect(card!.items.map((i) => i.id)).toEqual([nobodys.id]);
  });

  it("makes a buyer once, keeps the history, and moves the lead to Quoted at its first quotation", async () => {
    const { id } = await leads.addLead(env.rahim.ctx, nordic);
    const made = await leads.makeBuyer(env.rahim.ctx, id);
    expect(made.created).toBe(true);
    const party = await prisma.party.findUniqueOrThrow({ where: { id: made.partyId } });
    expect(party.name).toBe("Nordic Wear AB");
    expect(party.email).toBe("anna@nordicwear.se");
    expect(party.tradePayment).toBe("LC");
    // Again: the same buyer, not a second one.
    const again = await leads.makeBuyer(env.rahim.ctx, id);
    // Two clicks at once on another lead: one buyer, the other click stops.
    const second = await leads.addLead(env.rahim.ctx, {
      name: "Baltic Basics",
      country: "Germany",
      confirmDuplicate: true,
    });
    const both = await Promise.allSettled([
      leads.makeBuyer(env.rahim.ctx, second.id),
      leads.makeBuyer(env.rahim.ctx, second.id),
    ]);
    expect(both.filter((r) => r.status === "fulfilled" && r.value.created)).toHaveLength(1);
    expect(
      await prisma.party.count({ where: { companyId: env.company.id, name: "Baltic Basics" } }),
    ).toBe(1);
    expect(again).toMatchObject({ partyId: made.partyId, created: false });
    expect(await prisma.party.count({ where: { companyId: env.company.id } })).toBe(2);

    // Buyer 360's "Came from lead" block carries the history.
    const block = await leads.leadOfBuyer(env.rahim.ctx, made.partyId);
    expect(block!.number).toBe("LD-0001");
    expect(block!.history.some((h) => h.kind === "CONVERT")).toBe(true);

    // The first quotation moves it to Quoted.
    await createQuotation(env.rahim.ctx, {
      partyId: made.partyId,
      items: [{ description: "Polo sample price", quantity: 100, unitPrice: 4.6 }],
    });
    const lead = await leads.getLead(env.rahim.ctx, id);
    expect(lead.stage).toBe("QUOTED");
    expect(lead.activities.some((a) => a.summary.startsWith("Quotation"))).toBe(true);

    // A person without adding buyers cannot make one.
    const viewer = await makeUser(`viewer@${env.company.slug}.test`);
    const role = await prisma.role.create({
      data: { companyId: env.company.id, name: "Lead keeper" },
    });
    const keys = ["leads.view", "leads.manage", "leads.convert"];
    for (const key of keys) {
      const p = await prisma.permission.findUniqueOrThrow({ where: { key } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: p.id } });
    }
    await addToCompany(viewer.id, env.company.id, role.id);
    const viewerCtx = await contextFor(viewer.id, env.company.id);
    const other = await leads.addLead(viewerCtx, { name: "Lone Star Tees", country: "USA" });
    await expectAppError(leads.makeBuyer(viewerCtx, other.id), "FORBIDDEN");
  });

  it("keeps erased people and the 'Do not contact' list off for good, with the PIN", async () => {
    const { id } = await leads.addLead(env.rahim.ctx, nordic);
    const lead = await leads.getLead(env.rahim.ctx, id);
    const contactId = lead.contacts[0]!.id;
    // Only leads.erase (the owner) erases, and only with the PIN.
    await expectAppError(
      leads.eraseLeadContact(env.rahim.ctx, id, contactId, { pin: PIN }),
      "FORBIDDEN",
    );
    await expectAppError(leads.eraseLeadContact(env.owner.ctx, id, contactId, {}), "VALIDATION");
    await expectAppError(
      leads.eraseLeadContact(env.owner.ctx, id, contactId, { pin: "1111" }),
      "VALIDATION",
    );
    await leads.eraseLeadContact(env.owner.ctx, id, contactId, { pin: PIN });
    const row = await prisma.leadContact.findUniqueOrThrow({ where: { id: contactId } });
    expect(row).toMatchObject({
      name: "Erased contact",
      email: null,
      phone: null,
      whatsapp: null,
      jobTitle: null,
      doNotContact: true,
    });
    expect(row.erasedAt).not.toBeNull();
    // Only hashes and hints are kept; never the address itself.
    const list = await prisma.leadSuppression.findMany({ where: { companyId: env.company.id } });
    expect(list.map((s) => s.kind).sort()).toEqual(["EMAIL", "PHONE"]);
    expect(JSON.stringify(list)).not.toContain("anna@nordicwear.se");
    // The audit log names no one.
    const logs = await prisma.auditLog.findMany({ where: { companyId: env.company.id } });
    expect(JSON.stringify(logs)).not.toContain("Anna");
    // The lead and its history stay.
    const after = await leads.getLead(env.owner.ctx, id);
    expect(after.activities.some((a) => a.kind === "ERASE")).toBe(true);

    // Added again later: the record is kept, but the person is on "Do not contact".
    const back = await leads.addLeadContact(env.rahim.ctx, id, {
      name: "Anna B",
      email: "anna@nordicwear.se",
    });
    expect(back.suppressed).toBe(true);
    await expectAppError(
      leads.logMessageSent(env.rahim.ctx, id, { channel: "EMAIL", contactId: back.id }),
      "CONFLICT",
    );
    // An entry added by hand covers a whole domain.
    const other = await leads.addLead(env.rahim.ctx, {
      name: "Fjord Kids",
      contact: { name: "Ola", email: "ola@fjordkids.no" },
    });
    await leads.addSuppression(env.rahim.ctx, { kind: "DOMAIN", value: "fjordkids.no" });
    const fjord = await leads.getLead(env.rahim.ctx, other.id);
    expect(fjord.contacts[0]!.doNotContact).toBe(true);
    expect((await leads.listSuppressions(env.rahim.ctx)).map((s) => s.hint)).toContain(
      "fjordkids.no",
    );
    // No money or stock moved anywhere.
    expect(await prisma.journalEntry.count({ where: { companyId: env.company.id } })).toBe(0);
  });

  it("tells the lead's owner in the inbox when its next step comes, with AI off", async () => {
    const { id } = await leads.addLead(env.rahim.ctx, {
      ...nordic,
      nextActionOn: addDays(today(env), 1),
      nextActionKind: "CALL",
    });
    const tz = env.company.timezone;
    const at = (days: number) =>
      new Date(startOfDayInZone(addDays(today(env), days), tz).getTime() + 10 * 3600_000);
    expect((await runReminders(at(0), { companyId: env.company.id })).automatic).toBe(1);
    // Once per step.
    expect((await runReminders(at(0), { companyId: env.company.id })).automatic).toBe(0);
    const inbox = await prisma.notificationLog.findMany({
      where: { companyId: env.company.id, channel: "IN_APP" },
    });
    expect(inbox.map((n) => n.userId)).toEqual([env.rahim.user.id]);
    expect(inbox[0]!.subject).toContain("Lead follow-up: LD-0001");
    expect(inbox[0]!.entityType).toBe("Lead");
    expect(recordHref(env.rahim.ctx, { type: "Lead", id })).toBe(`/sales/leads/${id}`);
    // A lost lead is not chased.
    await leads.changeLeadStage(env.rahim.ctx, id, { stage: "LOST", reason: "No reply" });
    expect((await runReminders(at(1), { companyId: env.company.id })).automatic).toBe(0);
  });

  it("reminds on a Nurture lead's look-again day: inbox, Home card and the due filter", async () => {
    const { id } = await leads.addLead(env.rahim.ctx, {
      ...nordic,
      nextActionOn: addDays(today(env), 30),
    });
    await leads.changeLeadStage(env.rahim.ctx, id, {
      stage: "NURTURE",
      lookAgainOn: addDays(today(env), 2),
    });
    const tz = env.company.timezone;
    const at = (days: number) =>
      new Date(startOfDayInZone(addDays(today(env), days), tz).getTime() + 10 * 3600_000);
    expect((await runReminders(at(2), { companyId: env.company.id })).automatic).toBe(1);
    const inbox = await prisma.notificationLog.findMany({
      where: { companyId: env.company.id, channel: "IN_APP", entityId: id },
    });
    expect(inbox.map((n) => n.userId)).toEqual([env.rahim.user.id]);
    // On and after that day it is on Home's card and in "Due" like an open lead.
    const later = at(3);
    const card = await leads.leadFollowUps(env.rahim.ctx, later);
    expect(card?.items.map((r) => r.id)).toContain(id);
    await prisma.lead.update({
      where: { id },
      data: { nextActionOn: new Date(`${addDays(today(env), -1)}T00:00:00.000Z`) },
    });
    const due = await leads.listLeads(env.rahim.ctx, { due: true });
    expect(due.rows.map((r) => r.id)).toContain(id);
    expect(due.rows.find((r) => r.id === id)!.late).toBe(true);
  });

  it("locks every lead to its company", async () => {
    const { id } = await leads.addLead(env.rahim.ctx, nordic);
    await expectAppError(leads.getLead(env.outsider.ctx, id), "NOT_FOUND");
    await expectAppError(
      leads.logLeadActivity(env.outsider.ctx, id, { kind: "NOTE", summary: "Hello" }),
      "NOT_FOUND",
    );
    await expectAppError(leads.makeBuyer(env.outsider.ctx, id), "NOT_FOUND");
    expect((await leads.listLeads(env.outsider.ctx)).rows).toEqual([]);
    // Another company's source or person cannot be used.
    const theirSource = await prisma.leadSource.findFirstOrThrow({
      where: { companyId: env.company.id },
    });
    await expectAppError(
      leads.addLead(env.outsider.ctx, { name: "Sneaky", sourceId: theirSource.id }),
      "VALIDATION",
    );
    await expectAppError(
      leads.addLead(env.outsider.ctx, { name: "Sneaky Two", ownerUserId: env.rahim.user.id }),
      "VALIDATION",
    );
    // The same address in two companies is two different hashes.
    await leads.addSuppression(env.rahim.ctx, { kind: "EMAIL", value: "x@brand.com" });
    expect(await leads.isSuppressed(env.outsider.ctx.company.id, { email: "x@brand.com" })).toBe(
      false,
    );
    // A lead links only its own company's buyer.
    const theirs = await prisma.party.create({
      data: {
        companyId: env.outsider.ctx.company.id,
        code: "BUY-0001",
        kind: "BUYER",
        name: "Not yours",
      },
    });
    await expectAppError(leads.makeBuyer(env.owner.ctx, id, { partyId: theirs.id }), "NOT_FOUND");
  });
});
