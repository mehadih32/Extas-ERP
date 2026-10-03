import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import * as compliance from "@/modules/compliance/compliance.service";
import { getFileForDownload, uploadRoot } from "@/modules/files/file.service";
import { runReminders } from "@/modules/reminders/engine";
import * as inbox from "@/modules/reminders/notification.service";
import * as reminders from "@/modules/reminders/reminder.service";

import { png } from "../fixtures/images";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const TZ = "Asia/Dhaka";

/** A calendar day `n` days from today in company time, e.g. "2026-10-12". */
function dayFromToday(n: number) {
  const d = new Date(`${localDay(new Date(), TZ)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A Dhaka wall-clock time `n` days from today, as an instant. */
const at = (n: number, time = "10:00") => new Date(`${dayFromToday(n)}T${time}:00+06:00`);

/** A company with its owner (Super Admin), Accounts (can see licences) and a Sales Executive. */
async function setup(name = "Extras") {
  const { company, roles } = await makeCompany(name);
  const member = async (role: keyof typeof roles, who: string) => {
    const user = await makeUser(`${who}@${company.slug}.test`);
    await addToCompany(user.id, company.id, roles[role]);
    return { user, ctx: await contextFor(user.id, company.id) };
  };
  return {
    company,
    admin: await member("SUPER_ADMIN", "admin"),
    accounts: await member("ACCOUNTS", "accounts"),
    sales: await member("SALES_EXECUTIVE", "sales"),
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

const tradeLicence = (env: Env, expiresIn: number, extra: Record<string, unknown> = {}) =>
  compliance.createCompliance(
    env.admin.ctx,
    {
      type: "TRADE_LICENSE",
      number: "TRAD/DNCC/123",
      issuingAuthority: "Dhaka North City Corporation",
      expiryDate: dayFromToday(expiresIn),
      ...extra,
    },
    undefined,
    at(0),
  );

const alertsFor = (complianceDocumentId: string) =>
  prisma.reminder.findMany({ where: { complianceDocumentId }, orderBy: { remindAt: "asc" } });

run("licences and registrations", () => {
  let uploads: string;

  beforeEach(async () => {
    await resetDb();
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-compliance-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(uploads, { recursive: true, force: true });
  });

  it("keeps each record with where it stands, the numbers in force and what is missing", async () => {
    const env = await setup();
    const licence = await tradeLicence(env, 20, { issueDate: dayFromToday(-345) });
    expect(licence).toMatchObject({
      title: "Trade licence",
      typeLabel: "Trade licence",
      status: "EXPIRING",
      daysLeft: 20,
      alertDaysBefore: 30,
      renewFrom: dayFromToday(-10),
      scan: null,
      previous: null,
      renewal: null,
    });
    const bin = await compliance.createCompliance(env.admin.ctx, {
      type: "VAT_BIN",
      number: "000123456-0101",
    });
    expect(bin).toMatchObject({
      title: "VAT registration (BIN)",
      status: "NO_EXPIRY",
      daysLeft: null,
      renewFrom: null,
    });
    const fire = await compliance.createCompliance(
      env.admin.ctx,
      {
        type: "FIRE_LICENSE",
        title: "Fire licence (Gazipur factory)",
        expiryDate: dayFromToday(-3),
      },
      undefined,
      at(0),
    );
    expect(fire).toMatchObject({ title: "Fire licence (Gazipur factory)", status: "EXPIRED" });
    await expect(
      compliance.createCompliance(env.admin.ctx, {
        type: "TIN",
        issueDate: dayFromToday(0),
        expiryDate: dayFromToday(-1),
      }),
    ).rejects.toThrow(ZodError);

    const summary = await compliance.complianceSummary(env.accounts.ctx, at(0));
    expect(summary.counts).toEqual({ total: 3, valid: 0, expiring: 1, expired: 1, noExpiry: 1 });
    expect(summary.needsRenewal.map((d) => d.id)).toEqual([fire.id, licence.id]);
    expect(summary.missing).toEqual([{ type: "TIN", label: "Tax ID (TIN)" }]);
    expect(summary.numbers).toEqual({
      tradeLicense: "TRAD/DNCC/123",
      bin: "000123456-0101",
      tin: null,
      irc: null,
      erc: null,
    });

    const ids = async (query: Record<string, unknown>) =>
      (await compliance.listCompliance(env.accounts.ctx, query, at(0))).items.map((d) => d.id);
    expect(await ids({})).toEqual([fire.id, licence.id, bin.id]);
    expect(await ids({ status: "EXPIRED" })).toEqual([fire.id]);
    expect(await ids({ search: "dncc" })).toEqual([licence.id]);
    expect(await ids({ type: "VAT_BIN" })).toEqual([bin.id]);

    // A shorter renewal window: valid again until its alerts start.
    expect(
      await compliance.updateCompliance(
        env.admin.ctx,
        licence.id,
        { alertDaysBefore: 15 },
        undefined,
        at(0),
      ),
    ).toMatchObject({ status: "VALID", renewFrom: dayFromToday(5) });
    await expectAppError(
      compliance.updateCompliance(env.admin.ctx, licence.id, { expiryDate: dayFromToday(-400) }),
      "VALIDATION",
    );
    const audit = await prisma.auditLog.findMany({
      where: { entityType: "ComplianceDocument", entityId: licence.id },
      orderBy: { createdAt: "asc" },
    });
    expect(audit[0]!.summary).toMatch(/^Added Trade licence TRAD\/DNCC\/123 \(expires /);
    expect(audit[1]!.summary).toBe("Edited Trade licence TRAD/DNCC/123: alertDaysBefore");

    // Another company sees none of it.
    const other = await setup("Other Co");
    await expectAppError(compliance.getCompliance(other.admin.ctx, licence.id), "NOT_FOUND");
    expect((await compliance.complianceSummary(other.admin.ctx)).counts.total).toBe(0);
  });

  it("renews a licence, keeps the old term as history and settles its alerts", async () => {
    const env = await setup();
    const licence = await tradeLicence(env, 10);
    // Ten days to go: the renewal window opened 20 days ago, so the 15-day alert goes out now.
    expect((await runReminders(at(0, "09:00"), { companyId: env.company.id })).automatic).toBe(1);
    expect(await alertsFor(licence.id)).toMatchObject([
      { sourceKey: `COMPLIANCE_EXPIRY:${licence.id}:${dayFromToday(10)}:d15`, status: "SENT" },
    ]);
    expect((await inbox.listNotifications(env.accounts.ctx)).items).toMatchObject([
      { subject: "Renewal due: Trade licence TRAD/DNCC/123" },
    ]);

    const renewed = await compliance.renewCompliance(
      env.admin.ctx,
      licence.id,
      { expiryDate: dayFromToday(375), issueDate: dayFromToday(10), number: "TRAD/DNCC/456" },
      undefined,
      at(1),
    );
    expect(renewed).toMatchObject({
      type: "TRADE_LICENSE",
      number: "TRAD/DNCC/456",
      issuingAuthority: "Dhaka North City Corporation",
      status: "VALID",
      previous: { id: licence.id, number: "TRAD/DNCC/123", expiryDate: dayFromToday(10) },
    });
    expect(await compliance.getCompliance(env.accounts.ctx, licence.id, at(1))).toMatchObject({
      status: "SUPERSEDED",
      renewal: { id: renewed.id },
    });
    expect(
      (await compliance.getCompliance(env.accounts.ctx, renewed.id, at(1))).history.map(
        (h) => h.id,
      ),
    ).toEqual([licence.id]);
    // Its alerts count as dealt with, and the old term raises no more.
    expect(await alertsFor(licence.id)).toMatchObject([
      { status: "ACKNOWLEDGED", acknowledgedById: env.admin.user.id, acknowledgedAt: at(1) },
    ]);
    expect((await runReminders(at(5, "09:00"), { companyId: env.company.id })).automatic).toBe(0);
    const ids = async (query: Record<string, unknown>) =>
      (await compliance.listCompliance(env.admin.ctx, query, at(1))).items.map((d) => d.id);
    expect(await ids({})).toEqual([renewed.id]);
    expect(await ids({ history: "true" })).toEqual([licence.id, renewed.id]);
    expect((await compliance.complianceNumbers(env.company.id)).tradeLicense).toBe("TRAD/DNCC/456");

    await expectAppError(
      compliance.renewCompliance(env.admin.ctx, licence.id, { expiryDate: dayFromToday(800) }),
      "CONFLICT",
    );
    await expectAppError(
      compliance.renewCompliance(env.admin.ctx, renewed.id, { expiryDate: dayFromToday(300) }),
      "VALIDATION",
    );
    await expectAppError(compliance.deleteCompliance(env.admin.ctx, licence.id), "CONFLICT");

    // The renewal was entered by mistake: deleting it puts the old term back in force.
    await compliance.deleteCompliance(env.admin.ctx, renewed.id);
    expect(await compliance.getCompliance(env.admin.ctx, licence.id, at(1))).toMatchObject({
      status: "EXPIRING",
      renewal: null,
    });
    expect((await compliance.complianceNumbers(env.company.id)).tradeLicense).toBe("TRAD/DNCC/123");
  });

  it("archives a record, ending its alerts, and restores it", async () => {
    const env = await setup();
    const fire = await compliance.createCompliance(
      env.admin.ctx,
      { type: "FIRE_LICENSE", number: "FSCD-77", expiryDate: dayFromToday(5) },
      undefined,
      at(0),
    );
    expect((await runReminders(at(0, "09:00"), { companyId: env.company.id })).automatic).toBe(1);
    const sent = (await alertsFor(fire.id))[0]!;
    // Anyone it went to can mark it dealt with.
    expect(
      await reminders.acknowledgeReminder(env.accounts.ctx, sent.id, undefined, at(0, "10:00")),
    ).toMatchObject({ status: "ACKNOWLEDGED", acknowledgedBy: { id: env.accounts.user.id } });
    expect(await inbox.unreadCount(env.accounts.ctx)).toEqual({ unread: 0 });

    const archived = await compliance.archiveCompliance(env.admin.ctx, fire.id, undefined, at(0));
    expect(archived.status).toBe("ARCHIVED");
    expect((await runReminders(at(4, "09:00"), { companyId: env.company.id })).automatic).toBe(0);
    expect(
      (await compliance.listCompliance(env.admin.ctx, {}, at(0))).items.map((d) => d.id),
    ).toEqual([]);
    expect(
      (await compliance.listCompliance(env.admin.ctx, { status: "ARCHIVED" }, at(0))).items.map(
        (d) => d.id,
      ),
    ).toEqual([fire.id]);
    await expectAppError(compliance.archiveCompliance(env.admin.ctx, fire.id), "CONFLICT");
    await expectAppError(
      compliance.renewCompliance(env.admin.ctx, fire.id, { expiryDate: dayFromToday(400) }),
      "CONFLICT",
    );

    expect(
      (await compliance.restoreCompliance(env.admin.ctx, fire.id, undefined, at(0))).status,
    ).toBe("EXPIRING");
    await expectAppError(compliance.restoreCompliance(env.admin.ctx, fire.id), "CONFLICT");
    // Back under the alerts: the day-before step is next.
    expect((await runReminders(at(4, "09:00"), { companyId: env.company.id })).automatic).toBe(1);
    expect((await alertsFor(fire.id)).map((r) => r.sourceKey!.split(":").at(-1))).toEqual([
      "d7",
      "d1",
    ]);
  });

  it("keeps a scan of each record for the people who may see it", async () => {
    const env = await setup();
    const tin = await compliance.createCompliance(env.admin.ctx, {
      type: "TIN",
      number: "123456789012",
    });
    const photo = png({ width: 40, height: 30 });
    const first = await compliance.attachScan(env.admin.ctx, tin.id, {
      fileName: "TIN certificate.png",
      bytes: photo,
    });
    expect(first.scan).toMatchObject({
      fileName: "TIN certificate.png",
      mimeType: "image/png",
      sizeBytes: photo.length,
    });
    expect(await compliance.getScan(env.accounts.ctx, tin.id)).toEqual({
      fileName: "TIN certificate.png",
      mimeType: "image/png",
      bytes: photo,
    });
    const firstFile = await prisma.fileAsset.findUniqueOrThrow({ where: { id: first.scan!.id } });
    expect(firstFile.storagePath.startsWith(`${env.company.id}/compliance/`)).toBe(true);

    // A new scan replaces the old one, file and all.
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");
    const second = await compliance.attachScan(env.admin.ctx, tin.id, {
      fileName: "tin.pdf",
      bytes: pdf,
    });
    expect(second.scan).toMatchObject({ mimeType: "application/pdf" });
    expect(await prisma.fileAsset.count({ where: { id: first.scan!.id } })).toBe(0);
    await expect(access(path.join(uploadRoot(), firstFile.storagePath))).rejects.toThrow();

    // Opening it through the files link follows the licence permissions.
    expect((await getFileForDownload(env.accounts.ctx, second.scan!.id)).asset.mimeType).toBe(
      "application/pdf",
    );
    await expectAppError(getFileForDownload(env.sales.ctx, second.scan!.id), "FORBIDDEN");

    await expectAppError(
      compliance.attachScan(env.admin.ctx, tin.id, {
        fileName: "notes.txt",
        bytes: Buffer.from("hello"),
      }),
      "VALIDATION",
    );
    await expectAppError(
      compliance.attachScan(env.admin.ctx, tin.id, {
        fileName: "empty.png",
        bytes: Buffer.alloc(0),
      }),
      "VALIDATION",
    );

    expect((await compliance.removeScan(env.admin.ctx, tin.id)).scan).toBeNull();
    await expectAppError(compliance.getScan(env.admin.ctx, tin.id), "NOT_FOUND");
    await expectAppError(compliance.removeScan(env.admin.ctx, tin.id), "NOT_FOUND");

    // Deleting a record deletes its scan too.
    const again = await compliance.attachScan(env.admin.ctx, tin.id, {
      fileName: "tin.png",
      bytes: photo,
    });
    const file = await prisma.fileAsset.findUniqueOrThrow({ where: { id: again.scan!.id } });
    expect(await compliance.deleteCompliance(env.admin.ctx, tin.id)).toEqual({
      id: tin.id,
      deleted: true,
    });
    expect(await prisma.fileAsset.count({ where: { id: file.id } })).toBe(0);
    await expect(access(path.join(uploadRoot(), file.storagePath))).rejects.toThrow();
    await expectAppError(compliance.getCompliance(env.admin.ctx, tin.id), "NOT_FOUND");
  });
});
