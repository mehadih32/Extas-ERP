import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import * as files from "@/modules/files/file.service";
import * as employees from "@/modules/hr/employee.service";
import * as screens from "@/modules/hr/screens.service";
import * as vault from "@/modules/hr/vault.service";
import { createRole } from "@/modules/rbac/role.service";
import { recordHref } from "@/modules/reminders/links";

import { png } from "../fixtures/images";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/*
 * The employee data vault: what a complete record holds, the papers kept with
 * it, and pay detail changes that wait for HR. A salary must never be
 * redirected by whoever holds a login: the employee asks, someone else in HR
 * approves, and HR cannot change or approve their own.
 */

async function setup(name = "Extras") {
  const { company, roles } = await makeCompany(name);
  const member = async (roleId: string, who: string) => {
    const user = await makeUser(`${who}@${company.slug}.test`);
    await addToCompany(user.id, company.id, roleId);
    return { user, ctx: await contextFor(user.id, company.id) };
  };
  const admin = await member(roles.SUPER_ADMIN, "admin");
  const hrRole = await createRole(admin.ctx, {
    name: "HR Manager",
    permissions: ["hr.view", "hr.manage", "portal.self"],
  });
  const viewerRole = await createRole(admin.ctx, { name: "HR Viewer", permissions: ["hr.view"] });
  const hr = await member(hrRole.id, "hr");
  const hr2 = await member(hrRole.id, "hr2");
  const viewer = await member(viewerRole.id, "viewer");
  const staff = await member(roles.EMPLOYEE, "sumon");
  const other = await member(roles.EMPLOYEE, "rina");
  const hire = (person: string, extra: Record<string, unknown> = {}) =>
    employees.createEmployee(admin.ctx, {
      name: person,
      joinDate: "2025-01-01",
      salary: 20000,
      ...extra,
    });
  const sumon = await hire("Sumon Mia");
  await employees.grantPortalAccess(admin.ctx, sumon.id, { userId: staff.user.id });
  const nasrin = await hire("Nasrin Akter", {
    salaryMethod: "BKASH",
    walletNumber: "01811000000",
  });
  await employees.grantPortalAccess(admin.ctx, nasrin.id, { userId: hr.user.id });
  const rina = await hire("Rina Begum");
  await employees.grantPortalAccess(admin.ctx, rina.id, { userId: other.user.id });
  return {
    company,
    admin: admin.ctx,
    hr: await contextFor(hr.user.id, company.id),
    hr2: hr2.ctx,
    hrUser: hr.user,
    hr2User: hr2.user,
    adminUser: admin.user,
    viewer: viewer.ctx,
    staff: await contextFor(staff.user.id, company.id),
    staffUser: staff.user,
    other: await contextFor(other.user.id, company.id),
    sumon,
    nasrin,
    rina,
  };
}

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

const photo = () => ({ fileName: "nid front.png", bytes: png({ width: 40, height: 30 }) });

const inbox = (userId: string) =>
  prisma.notificationLog.findMany({
    where: { userId, channel: "IN_APP" },
    orderBy: { createdAt: "asc" },
  });

run("the employee data vault", () => {
  let uploads: string;

  beforeEach(async () => {
    await resetDb();
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-vault-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(uploads, { recursive: true, force: true });
  });

  it("shows HR what each record misses, in the list, the filter and the Overview", async () => {
    const env = await setup();
    const sumon = await vault.getEmployeeVault(env.hr, env.sumon.id);
    expect(sumon.gaps).toEqual(["NID", "BLOOD_GROUP", "REFERENCE"]);
    const nasrin = await vault.getEmployeeVault(env.hr, env.nasrin.id);
    expect(nasrin.gaps).toEqual(["NID", "BLOOD_GROUP", "REFERENCE"]);

    // A bank transfer without the account is missing its pay details.
    await employees.updateEmployee(env.admin, env.rina.id, {
      nid: "1234567890",
      bloodGroup: "B+",
      referenceName: "Karim Uddin",
      referencePhone: "01911000000",
      salaryMethod: "BANK_TRANSFER",
      bankName: "City Bank",
    });
    expect((await vault.getEmployeeVault(env.hr, env.rina.id)).gaps).toEqual(["PAY_DETAILS"]);
    await employees.updateEmployee(env.admin, env.rina.id, { bankAccountNumber: "123-456-789" });
    expect((await vault.getEmployeeVault(env.hr, env.rina.id)).gaps).toEqual([]);

    const list = await screens.listEmployeeRows(env.viewer, { incomplete: true });
    expect(list.items.map((e) => e.name).sort()).toEqual(["Nasrin Akter", "Sumon Mia"]);
    const all = await screens.listEmployeeRows(env.viewer, {});
    expect(all.items.find((e) => e.name === "Rina Begum")!.vaultGaps).toEqual([]);

    const overview = await screens.getOverviewScreen(env.hr);
    expect(overview.vault).toMatchObject({ incomplete: 2, payRequests: [] });
    // People who only see the staff list get no vault.
    expect((await screens.getOverviewScreen(env.viewer)).vault).toBeNull();
    expect((await screens.getEmployeeScreen(env.viewer, env.sumon.id)).vault).toBeNull();
    await expectAppError(vault.getEmployeeVault(env.viewer, env.sumon.id), "FORBIDDEN");
  });

  it("lets employees fill in who they are once, and keep contacts and a reference up to date", async () => {
    const env = await setup();
    const saved = await vault.updateMyDetails(env.staff, {
      nid: "1990 1234 5678 9",
      dateOfBirth: "1995-04-12",
      bloodGroup: "O+",
      referenceName: "Abdul Karim",
      referencePhone: "01711-222333",
      referenceRelation: "Former employer",
      emergencyContact: "Mother, 01711000111",
    });
    expect(saved.changed).toEqual([
      "national ID",
      "blood group",
      "date of birth",
      "emergency contact",
      "reference name",
      "reference phone",
      "reference relation",
    ]);
    expect(saved.details).toMatchObject({
      nid: "1990123456789",
      dateOfBirth: "1995-04-12",
      bloodGroup: "O+",
      referenceName: "Abdul Karim",
    });
    expect(saved.locked).toEqual({ nid: true, dateOfBirth: true, bloodGroup: true });
    expect(saved.gaps).toEqual([]);

    // Once on file, HR changes them.
    for (const change of [
      { nid: "9876543210" },
      { bloodGroup: "A+" },
      { dateOfBirth: "1990-01-01" },
    ]) {
      await expectAppError(vault.updateMyDetails(env.staff, change), "FORBIDDEN");
    }
    // Sending the same values again changes nothing.
    expect(
      (await vault.updateMyDetails(env.staff, { nid: "1990123456789", bloodGroup: "O+" })).changed,
    ).toEqual([]);
    // Contacts and the reference stay theirs to change, and to clear.
    const again = await vault.updateMyDetails(env.staff, {
      referencePhone: "01711-444555",
      emergencyContact: "",
    });
    expect(again.changed).toEqual(["emergency contact", "reference phone"]);
    expect(again.details.emergencyContact).toBeNull();

    await expect(vault.updateMyDetails(env.staff, { nid: "12345" })).rejects.toThrow();
    await expect(vault.updateMyDetails(env.staff, { referencePhone: "call me" })).rejects.toThrow();
    // Only their own record; HR sees the change on the profile and in the activity log.
    expect((await vault.getMyVault(env.other)).details.nid).toBeNull();
    const profile = await screens.getEmployeeScreen(env.hr, env.sumon.id);
    expect(profile.employee).toMatchObject({
      referenceName: "Abdul Karim",
      referencePhone: "01711-444555",
      vaultGaps: [],
    });
    const log = await prisma.auditLog.findMany({
      where: { entityId: env.sumon.id, summary: { contains: "updated their own details" } },
    });
    expect(log).toHaveLength(2);
    // No login linked: nothing to fill.
    await expectAppError(vault.getMyVault(env.viewer), "NOT_FOUND");
  });

  it("keeps a new bank account or wallet waiting until someone in HR approves it", async () => {
    const env = await setup();
    const asked = await vault.requestPayDetailsChange(env.staff, {
      salaryMethod: "BKASH",
      walletNumber: "+880 1711-000000",
      note: "I have no bank account",
    });
    expect(asked).toMatchObject({
      status: "PENDING",
      changesText: "bKash 01711000000",
      previousText: "Cash",
      note: "I have no bank account",
    });
    // Nothing changes until HR decides.
    const before = await prisma.employee.findUniqueOrThrow({ where: { id: env.sumon.id } });
    expect(before).toMatchObject({ salaryMethod: "CASH", walletNumber: null });

    // Both HR managers and the Super Admin are told; the employee is not.
    for (const user of [env.hrUser, env.hr2User, env.adminUser]) {
      const [message] = await inbox(user.id);
      expect(message).toMatchObject({
        subject: "Pay details change to approve",
        entityType: "Employee",
        entityId: env.sumon.id,
      });
      expect(message!.body).toContain("bKash 01711000000 instead of Cash");
    }
    expect(await inbox(env.staffUser.id)).toEqual([]);

    // A newer ask replaces the one waiting; the same details are refused.
    const newer = await vault.requestPayDetailsChange(env.staff, {
      salaryMethod: "BANK_TRANSFER",
      bankName: "Dutch-Bangla Bank",
      bankBranch: "Mirpur",
      bankAccountNumber: "123 456 7890",
    });
    expect(newer.changesText).toBe("Bank transfer: Dutch-Bangla Bank, Mirpur, 123 456 7890");
    expect(
      await prisma.payDetailsRequest.findUniqueOrThrow({ where: { id: asked.id } }),
    ).toMatchObject({ status: "WITHDRAWN" });
    await expectAppError(
      vault.requestPayDetailsChange(env.staff, { salaryMethod: "CASH" }),
      "VALIDATION",
    );
    await expect(
      vault.requestPayDetailsChange(env.staff, { salaryMethod: "BKASH", walletNumber: "12345" }),
    ).rejects.toThrow();
    await expect(
      vault.requestPayDetailsChange(env.staff, { salaryMethod: "CHEQUE", bankName: "City Bank" }),
    ).rejects.toThrow();

    const waiting = await vault.listPayRequests(env.hr);
    expect(waiting.map((r) => [r.employee.name, r.status])).toEqual([["Sumon Mia", "PENDING"]]);
    expect((await screens.getOverviewScreen(env.hr)).vault!.payRequests).toHaveLength(1);
    const panel = await vault.getEmployeeVault(env.hr, env.sumon.id);
    expect(panel.pendingRequest?.id).toBe(newer.id);
    expect(panel.can.decide).toBe(true);

    // HR approves: the salary goes to the new account.
    const approved = await vault.approvePayRequest(env.hr, newer.id);
    expect(approved).toMatchObject({ status: "APPROVED", decidedBy: { id: env.hrUser.id } });
    const after = await prisma.employee.findUniqueOrThrow({ where: { id: env.sumon.id } });
    expect(after).toMatchObject({
      salaryMethod: "BANK_TRANSFER",
      bankName: "Dutch-Bangla Bank",
      bankBranch: "Mirpur",
      bankAccountNumber: "123 456 7890",
      walletNumber: null,
    });
    const [told] = await inbox(env.staffUser.id);
    expect(told).toMatchObject({
      subject: "Your pay details were changed",
      entityType: "MyDetails",
      entityId: env.sumon.id,
    });
    expect(recordHref(env.staff, { type: told!.entityType!, id: told!.entityId })).toBe(
      "/me/profile",
    );
    // Decided once.
    await expectAppError(vault.approvePayRequest(env.hr2, newer.id), "CONFLICT");
    await expectAppError(
      vault.rejectPayRequest(env.hr2, newer.id, { reason: "Changed mind" }),
      "CONFLICT",
    );
    await expectAppError(vault.withdrawMyPayRequest(env.staff, newer.id), "CONFLICT");

    const mine = await vault.getMyVault(env.staff);
    expect(mine.pay.text).toBe("Bank transfer: Dutch-Bangla Bank, Mirpur, 123 456 7890");
    expect(mine.payRequest).toMatchObject({ id: newer.id, status: "APPROVED" });
    const audit = await prisma.auditLog.findMany({
      where: { entityId: env.sumon.id, summary: { contains: "pay details" } },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((a) => a.summary)).toEqual([
      expect.stringContaining("Approved EMP-0001 Sumon Mia's pay details: Cash → Bank transfer"),
    ]);
  });

  it("turns a change down with a reason, and lets the employee withdraw one", async () => {
    const env = await setup();
    const asked = await vault.requestPayDetailsChange(env.staff, {
      salaryMethod: "NAGAD",
      walletNumber: "01611000000",
    });
    await expect(vault.rejectPayRequest(env.hr, asked.id, { reason: "no" })).rejects.toThrow();
    const rejected = await vault.rejectPayRequest(env.hr, asked.id, {
      reason: "This number is in someone else's name.",
    });
    expect(rejected).toMatchObject({
      status: "REJECTED",
      decisionNote: "This number is in someone else's name.",
    });
    expect(await prisma.employee.findUniqueOrThrow({ where: { id: env.sumon.id } })).toMatchObject({
      salaryMethod: "CASH",
      walletNumber: null,
    });
    const [told] = await inbox(env.staffUser.id);
    expect(told).toMatchObject({ subject: "Your pay details change was not approved" });
    expect(told!.body).toContain("someone else's name");
    expect((await vault.getMyVault(env.staff)).payRequest).toMatchObject({ status: "REJECTED" });

    const again = await vault.requestPayDetailsChange(env.staff, {
      salaryMethod: "NAGAD",
      walletNumber: "01611999999",
    });
    // Only their own.
    await expectAppError(vault.withdrawMyPayRequest(env.other, again.id), "NOT_FOUND");
    expect(await vault.withdrawMyPayRequest(env.staff, again.id)).toMatchObject({
      status: "WITHDRAWN",
    });
    await expectAppError(vault.approvePayRequest(env.hr, again.id), "CONFLICT");
    expect(await vault.listPayRequests(env.hr)).toEqual([]);
    // A withdrawn ask is not shown back as "the last one HR decided".
    expect((await vault.getMyVault(env.staff)).payRequest).toMatchObject({ id: rejected.id });
  });

  it("never lets HR redirect their own salary: someone else approves or changes it", async () => {
    const env = await setup();
    // Nasrin (the HR manager) asks for her own change.
    const own = await vault.requestPayDetailsChange(env.hr, {
      salaryMethod: "BKASH",
      walletNumber: "01811999999",
    });
    // She is not told about her own request; the other HR manager is.
    expect(await inbox(env.hrUser.id)).toEqual([]);
    expect(await inbox(env.hr2User.id)).toHaveLength(1);
    const panel = await vault.getEmployeeVault(env.hr, env.nasrin.id);
    expect(panel.can.decide).toBe(false);
    expect(panel.notes.decide).toMatch(/Someone else must approve/);
    await expectAppError(vault.approvePayRequest(env.hr, own.id), "FORBIDDEN");
    await expectAppError(
      vault.rejectPayRequest(env.hr, own.id, { reason: "Not needed now" }),
      "FORBIDDEN",
    );
    // Nor on the edit form, while the rest of her details stay hers to edit.
    await expectAppError(
      employees.updateEmployee(env.hr, env.nasrin.id, { walletNumber: "01811999999" }),
      "FORBIDDEN",
    );
    await employees.updateEmployee(env.hr, env.nasrin.id, {
      phone: "01811000001",
      salaryMethod: "BKASH",
      walletNumber: "01811000000",
    });
    expect((await screens.getEmployeeForm(env.hr, env.nasrin.id)).can.changePay).toBe(false);
    expect((await screens.getEmployeeForm(env.hr, env.sumon.id)).can.changePay).toBe(true);
    expect((await screens.getEmployeeForm(env.admin, env.nasrin.id)).can.changePay).toBe(true);

    // Another HR manager approves it.
    await vault.approvePayRequest(env.hr2, own.id);
    expect(await prisma.employee.findUniqueOrThrow({ where: { id: env.nasrin.id } })).toMatchObject(
      { walletNumber: "01811999999" },
    );
    // HR still changes other people's pay details directly, and the Super Admin anyone's.
    await employees.updateEmployee(env.hr, env.sumon.id, {
      salaryMethod: "ROCKET",
      walletNumber: "01511000000",
    });
    await employees.updateEmployee(env.admin, env.nasrin.id, { walletNumber: "01811888888" });
    // Employees cannot decide on anything.
    const ask = await vault.requestPayDetailsChange(env.staff, { salaryMethod: "CASH" });
    await expectAppError(vault.approvePayRequest(env.staff, ask.id), "FORBIDDEN");
    await expectAppError(vault.listPayRequests(env.viewer), "FORBIDDEN");
  });

  it("keeps papers that open only to HR and the employee, and removes them with their file", async () => {
    const env = await setup();
    const nid = await vault.addMyDocument(env.staff, { kind: "NID", title: "NID front" }, photo());
    expect(nid).toMatchObject({ kind: "NID", title: "NID front", mimeType: "image/png" });
    const letter = await vault.addEmployeeDocument(
      env.hr,
      env.sumon.id,
      { kind: "CONTRACT" },
      { fileName: "appointment.png", bytes: png({ width: 20, height: 20 }) },
    );
    // An appointment letter comes from HR.
    await expectAppError(
      vault.addMyDocument(env.staff, { kind: "CONTRACT" }, photo()),
      "FORBIDDEN",
    );
    await expectAppError(
      vault.addEmployeeDocument(env.viewer, env.sumon.id, { kind: "NID" }, photo()),
      "FORBIDDEN",
    );

    const mine = await vault.getMyVault(env.staff);
    expect(mine.documents.map((d) => [d.kind, d.canRemove])).toEqual([
      ["CONTRACT", false],
      ["NID", true],
    ]);
    expect((await vault.getEmployeeVault(env.hr, env.sumon.id)).documents).toHaveLength(2);

    // Who opens the files.
    const opens = async (ctx: typeof env.hr, fileId: string) =>
      files.getFileForDownload(ctx, fileId).then(
        () => true,
        () => false,
      );
    expect(await opens(env.hr, nid.fileId)).toBe(true);
    expect(await opens(env.admin, nid.fileId)).toBe(true);
    expect(await opens(env.staff, letter.fileId)).toBe(true);
    expect(await opens(env.viewer, nid.fileId)).toBe(false);
    expect(await opens(env.other, nid.fileId)).toBe(false);

    // The employee removes only what they added; HR removes anything.
    await expectAppError(vault.removeMyDocument(env.staff, letter.id), "FORBIDDEN");
    await expectAppError(vault.removeMyDocument(env.other, nid.id), "FORBIDDEN");
    await vault.removeMyDocument(env.staff, nid.id);
    await vault.removeEmployeeDocument(env.hr, letter.id);
    expect(await prisma.employeeDocument.count()).toBe(0);
    expect(
      await prisma.fileAsset.count({ where: { id: { in: [nid.fileId, letter.fileId] } } }),
    ).toBe(0);
    const summaries = (
      await prisma.auditLog.findMany({
        where: { entityId: env.sumon.id, summary: { contains: "vault" } },
        orderBy: { createdAt: "asc" },
      })
    ).map((a) => a.summary);
    expect(summaries).toHaveLength(4);
    expect(summaries[0]).toContain('Sumon Mia added nid paper "NID front"');

    // A file that is not a photo or PDF is refused, and nothing is kept.
    await expectAppError(
      vault.addMyDocument(
        env.staff,
        { kind: "OTHER" },
        { fileName: "a.txt", bytes: Buffer.from("hello") },
      ),
      "VALIDATION",
    );
    expect(await prisma.employeeDocument.count()).toBe(0);
  });

  it("keeps each company's vault to itself", async () => {
    const env = await setup();
    const far = await setup("Other");
    const asked = await vault.requestPayDetailsChange(env.staff, {
      salaryMethod: "BKASH",
      walletNumber: "01711000000",
    });
    const paper = await vault.addMyDocument(env.staff, { kind: "PHOTO" }, photo());
    await expectAppError(vault.approvePayRequest(far.hr, asked.id), "NOT_FOUND");
    await expectAppError(vault.removeEmployeeDocument(far.hr, paper.id), "NOT_FOUND");
    await expectAppError(vault.getEmployeeVault(far.hr, env.sumon.id), "NOT_FOUND");
    expect(await vault.listPayRequests(far.hr)).toEqual([]);
    expect(await inbox(far.hrUser.id)).toEqual([]);
  });
});
