import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  housekeepingTick,
  runHousekeeping,
  stopHousekeepingScheduler,
} from "@/modules/housekeeping/scheduler";
import * as parties from "@/modules/parties/party.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

async function setup(companyName: string) {
  const { company, roles } = await makeCompany(companyName);
  const user = await makeUser(`admin@${company.slug}.test`);
  await addToCompany(user.id, company.id, roles.SUPER_ADMIN);
  const ctx = await contextFor(user.id, company.id);
  return { company, user, ctx };
}

const statusOf = async (id: string) =>
  (await prisma.party.findUniqueOrThrow({ where: { id } })).status;

run("nightly housekeeping", () => {
  beforeEach(async () => {
    stopHousekeepingScheduler();
    await resetDb();
  });
  afterEach(stopHousekeepingScheduler);

  it("marks idle buyers dormant in every company, closes settled accounts and removes expired sign-ins", async () => {
    const extras = await setup("Extras");
    const fabric = await setup("Fabric Apparel");
    const buyer = async (env: typeof extras, name: string, kind = "BUYER") =>
      (await parties.createParty(env.ctx, { kind, name })).party;
    const idle = await buyer(extras, "Idle Traders");
    const busy = await buyer(extras, "Busy Traders");
    const settled = await buyer(extras, "Settled Shop");
    const quiet = await buyer(fabric, "Quiet Fashion");
    const mill = await buyer(fabric, "Old Mill", "SUPPLIER");
    await prisma.party.updateMany({
      where: { id: { in: [idle.id, quiet.id, mill.id] } },
      data: { createdAt: new Date("2024-01-01T00:00:00Z") },
    });
    // An account being closed, with nothing left owed.
    await prisma.party.update({ where: { id: settled.id }, data: { status: "SETTLING" } });
    // Fabric Apparel's admin signed in long ago; that sign-in has expired.
    await prisma.session.updateMany({
      where: { userId: fabric.user.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    expect(await runHousekeeping()).toEqual({
      companies: 2,
      markedDormant: 2,
      closed: 1,
      sessionsRemoved: 1,
    });
    expect(await statusOf(idle.id)).toBe("DORMANT");
    expect(await statusOf(quiet.id)).toBe("DORMANT");
    expect(await statusOf(busy.id)).toBe("ACTIVE");
    expect(await statusOf(mill.id)).toBe("ACTIVE");
    expect(await statusOf(settled.id)).toBe("CLOSED");
    expect(await prisma.session.count({ where: { userId: fabric.user.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: extras.user.id } })).toBe(1);

    // Each company's audit log shows what the night changed, made by no one.
    const logged = await prisma.auditLog.findMany({
      where: { action: "STATUS_CHANGE", entityType: "Party" },
      select: { companyId: true, userId: true, summary: true, after: true },
    });
    expect(logged).toHaveLength(2);
    expect(logged.find((l) => l.companyId === extras.company.id)).toEqual({
      companyId: extras.company.id,
      userId: null,
      summary: "Nightly status refresh: 1 buyer(s) marked dormant, 1 settled account(s) closed",
      after: { dormant: [idle.code], closed: [settled.code] },
    });
    expect(logged.find((l) => l.companyId === fabric.company.id)).toMatchObject({
      userId: null,
      summary: "Nightly status refresh: 1 buyer(s) marked dormant, 0 settled account(s) closed",
    });

    // Running again changes nothing and logs nothing.
    expect(await runHousekeeping()).toEqual({
      companies: 2,
      markedDormant: 0,
      closed: 0,
      sessionsRemoved: 0,
    });
    expect(await prisma.auditLog.count({ where: { action: "STATUS_CHANGE" } })).toBe(2);
  });

  it("runs once a night at 03:30 Bangladesh time, and once after the server starts", async () => {
    await setup("Extras");
    // 03:31 on 5 October in Dhaka (UTC+6): the 03:30 run is due.
    expect(await housekeepingTick(new Date("2026-10-04T21:31:00Z"))).toMatchObject({
      companies: 1,
    });
    // Later that day and at 03:29 the next night, nothing is due.
    expect(await housekeepingTick(new Date("2026-10-05T10:00:00Z"))).toBeNull();
    expect(await housekeepingTick(new Date("2026-10-05T21:29:00Z"))).toBeNull();
    // 03:30 on 6 October.
    expect(await housekeepingTick(new Date("2026-10-05T21:30:00Z"))).toMatchObject({
      companies: 1,
    });
    expect(await housekeepingTick(new Date("2026-10-05T21:45:00Z"))).toBeNull();

    // A restarted server runs it once straight away, in case the night was missed.
    stopHousekeepingScheduler();
    expect(await housekeepingTick(new Date("2026-10-05T23:00:00Z"))).toMatchObject({
      companies: 1,
    });
    expect(await housekeepingTick(new Date("2026-10-05T23:01:00Z"))).toBeNull();
  });
});
