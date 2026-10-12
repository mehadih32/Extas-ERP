import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

/*
 * The terms of employment: HR writes and publishes versions; staff linked to a
 * login must read and agree before anything else in the app works (pages send
 * them to /terms, everything else answers TERMS_REQUIRED); each agreement keeps
 * its evidence, and the signed PDF is made by the background queue. Next.js'
 * request helpers are replaced as in hr-screens.test.ts.
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
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { REQUESTED_PATH_HEADER } from "@/lib/routes";
import { createSession } from "@/modules/auth/session.service";
import * as files from "@/modules/files/file.service";
import * as employees from "@/modules/hr/employee.service";
import * as screens from "@/modules/hr/screens.service";
import { STARTER_TERMS } from "@/modules/hr/terms";
import * as terms from "@/modules/hr/terms.service";
import * as vault from "@/modules/hr/vault.service";
import { enqueueJob, purgeOldJobs, requeueStaleJobs } from "@/modules/jobs/queue";
import { runDueJobs } from "@/modules/jobs/worker";
import { createRole } from "@/modules/rbac/role.service";
import { recordHref } from "@/modules/reminders/links";
import { requireCompanyPage, requireTermsPage } from "@/server/pages/guards";

import { png } from "../fixtures/images";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const member = async (roleId: string, who: string) => {
    const user = await makeUser(`${who}@extras.test`);
    await addToCompany(user.id, company.id, roleId);
    return user;
  };
  const owner = await member(roles.SUPER_ADMIN, "owner");
  const admin = await contextFor(owner.id, company.id);
  const hrRole = await createRole(admin, {
    name: "HR Manager",
    permissions: ["hr.view", "hr.manage", "portal.self"],
  });
  const viewerRole = await createRole(admin, { name: "HR Viewer", permissions: ["hr.view"] });
  const hrUser = await member(hrRole.id, "hr");
  const viewerUser = await member(viewerRole.id, "viewer");
  const staffUser = await member(roles.EMPLOYEE, "sumon");
  const salesUser = await member(roles.SALES_EXECUTIVE, "rina");
  const hire = (name: string, extra: Record<string, unknown> = {}) =>
    employees.createEmployee(admin, { name, joinDate: "2025-01-01", salary: 20000, ...extra });
  const sumon = await hire("Sumon Mia", { phone: "01711-000000", nid: "1990123456789" });
  await employees.grantPortalAccess(admin, sumon.id, { userId: staffUser.id });
  const nasrin = await hire("Nasrin Akter");
  await employees.grantPortalAccess(admin, nasrin.id, { userId: hrUser.id });
  const rina = await hire("Rina Begum", { designation: "Sales executive" });
  await employees.grantPortalAccess(admin, rina.id, { userId: salesUser.id });
  const noLogin = await hire("Kalam Sheikh");
  return {
    company,
    users: { owner, hr: hrUser, viewer: viewerUser, staff: staffUser, sales: salesUser },
    admin,
    hr: await contextFor(hrUser.id, company.id),
    viewer: await contextFor(viewerUser.id, company.id),
    staff: await contextFor(staffUser.id, company.id),
    sales: await contextFor(salesUser.id, company.id),
    sumon,
    nasrin,
    rina,
    noLogin,
  };
}
type Env = Awaited<ReturnType<typeof setup>>;

async function signInAs(userId: string, companyId: string, path = "/sales/orders") {
  const { token } = await createSession(userId, companyId);
  browser.cookies.set(SESSION_COOKIE, token);
  browser.headers = new Headers({
    [REQUESTED_PATH_HEADER]: path,
    "x-forwarded-for": "203.0.113.7",
    "user-agent": "Mozilla/5.0 (Linux; Android 14) Chrome/130",
  });
}

/** Where the pages send this person: null when they open normally. */
async function landsOn(env: Env, userId: string, path = "/sales/orders") {
  await signInAs(userId, env.company.id, path);
  try {
    await requireCompanyPage();
    return null;
  } catch (error) {
    return (error as { redirectedTo?: string }).redirectedTo ?? String(error);
  }
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

const signature = () =>
  `data:image/png;base64,${png({ width: 300, height: 100 }).toString("base64")}`;

async function publishFirst(env: Env) {
  await terms.startTermsDraft(env.hr);
  return terms.publishTerms(env.hr, {});
}

const meta = { ipAddress: "203.0.113.7", userAgent: "Mozilla/5.0 (Linux; Android 14)" };

run("the terms of employment", () => {
  let uploads: string;

  beforeEach(async () => {
    await resetDb();
    await prisma.backgroundJob.deleteMany();
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-terms-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(uploads, { recursive: true, force: true });
  });

  it("asks nobody anything until HR publishes the first version", async () => {
    const env = await setup();
    expect(await landsOn(env, env.users.staff.id)).toBeNull();
    expect(await terms.getTermsGate(env.staff)).toBeNull();
    const screen = await terms.getTermsScreen(env.viewer);
    expect(screen.published).toBeNull();
    expect(screen.draft).toBeNull();
    expect(screen.staff.rows.every((r) => r.state === "NONE")).toBe(true);
    expect((await screens.getOverviewScreen(env.hr)).vault?.termsToAgree).toBeNull();

    // The first draft is the starter text, in Bengali and English.
    const draft = await terms.startTermsDraft(env.hr);
    expect(draft.title).toBe(STARTER_TERMS.title);
    expect(draft.sections.map((s) => s.title)).toHaveLength(4);
    expect(draft.sections[0]!.title).toContain("Confidentiality");
    await expectAppError(terms.startTermsDraft(env.hr), "CONFLICT");
    // Still nobody is asked: a draft is not published.
    expect(await landsOn(env, env.users.staff.id)).toBeNull();
    // HR Viewers read the terms but do not write them; only HR managers see the draft.
    await expectAppError(terms.saveTermsDraft(env.viewer, STARTER_TERMS), "FORBIDDEN");
    await expectAppError(terms.publishTerms(env.viewer, {}), "FORBIDDEN");
    expect((await terms.getTermsScreen(env.viewer)).draft).toBeNull();
    expect((await terms.getTermsScreen(env.hr)).draft?.id).toBe(draft.id);
  });

  it("checks the draft, and discards it without touching published versions", async () => {
    const env = await setup();
    const error = await terms
      .saveTermsDraft(env.hr, { title: " ", sections: [{ title: "A", body: "" }] })
      .catch((e: unknown) => e);
    expect(
      (error as { issues: Array<{ path: unknown[] }> }).issues.map((i) => i.path.join(".")),
    ).toEqual(["title", "sections.0.body"]);
    const saved = await terms.saveTermsDraft(env.hr, {
      title: "  Terms  ",
      intro: "First line.\n\n\n  Second   line.  ",
      sections: [{ title: "Rule", body: "One.\r\n\r\nTwo." }],
    });
    expect(saved).toMatchObject({
      title: "Terms",
      intro: "First line.\n\nSecond line.",
      sections: [{ title: "Rule", body: "One.\n\nTwo." }],
      version: null,
    });
    await terms.discardTermsDraft(env.hr);
    expect((await terms.getTermsScreen(env.hr)).draft).toBeNull();
    await expectAppError(terms.discardTermsDraft(env.hr), "NOT_FOUND");
    await expectAppError(terms.publishTerms(env.hr, {}), "NOT_FOUND");

    await publishFirst(env);
    await terms.startTermsDraft(env.hr);
    // A draft that reads the same as the version in force is not a new version.
    await expectAppError(terms.publishTerms(env.hr, {}), "VALIDATION");
    await terms.discardTermsDraft(env.hr);
    expect((await terms.getTermsScreen(env.hr)).published?.version).toBe(1);
  });

  it("sends staff with a login to the terms from every page until they agree", async () => {
    const env = await setup();
    const published = await publishFirst(env);
    expect(published).toMatchObject({ version: 1, askEveryone: true, toAgree: 3 });
    expect(published.textHash).toMatch(/^[0-9a-f]{64}$/);

    // Staff linked to a login, HR included, land on the terms; the owner (no employee record) does not.
    expect(await landsOn(env, env.users.staff.id)).toBe("/terms?next=%2Fsales%2Forders");
    expect(await landsOn(env, env.users.sales.id, "/")).toBe("/terms");
    expect(await landsOn(env, env.users.hr.id)).toMatch(/^\/terms/);
    expect(await landsOn(env, env.users.owner.id)).toBeNull();
    expect(await landsOn(env, env.users.viewer.id)).toBeNull();
    // Everything else answers TERMS_REQUIRED; the terms screen itself opens.
    await signInAs(env.users.staff.id, env.company.id);
    const { requireCompany, requirePermission } = await import("@/modules/auth/context");
    await expectAppError(requireCompany(), "TERMS_REQUIRED");
    await expectAppError(requirePermission("portal.self"), "TERMS_REQUIRED");
    expect((await requireTermsPage()).user.id).toBe(env.users.staff.id);

    // They are told in the app, and the message opens the terms.
    const message = await prisma.notificationLog.findFirstOrThrow({
      where: { userId: env.users.staff.id, entityType: "Terms" },
    });
    expect(message.subject).toBe("Terms of employment, version 1");
    expect(recordHref(env.staff, { type: "Terms", id: message.entityId })).toBe("/terms");

    const gate = await terms.getTermsGate(env.staff);
    expect(gate).toMatchObject({
      due: true,
      version: { version: 1 },
      employee: { name: "Sumon Mia" },
      lastAgreed: null,
      code: { available: false },
    });

    const screen = await terms.getTermsScreen(env.hr);
    const state = Object.fromEntries(screen.staff.rows.map((r) => [r.name, r.state]));
    expect(state).toEqual({
      "Sumon Mia": "TO_AGREE",
      "Nasrin Akter": "TO_AGREE",
      "Rina Begum": "TO_AGREE",
      "Kalam Sheikh": "NO_LOGIN",
    });
    expect(screen.staff).toMatchObject({ agreed: 0, toAgree: 3, noLogin: 1 });
    expect((await screens.getOverviewScreen(env.hr)).vault?.termsToAgree).toBe(3);
  });

  it("records a drawn signature with its evidence, lifts the gate and makes the signed PDF", async () => {
    const env = await setup();
    const v1 = await publishFirst(env);

    await expectAppError(
      terms.agreeToTerms(
        env.staff,
        { versionId: v1.id, method: "SIGNATURE", signature: "data:image/png;base64,AAAA" },
        meta,
      ),
      "VALIDATION",
    );
    await expectAppError(
      terms.agreeToTerms(
        env.staff,
        { versionId: "old", method: "SIGNATURE", signature: signature() },
        meta,
      ),
      "CONFLICT",
    );
    const agreed = await terms.agreeToTerms(
      env.staff,
      { versionId: v1.id, method: "SIGNATURE", signature: signature() },
      meta,
    );
    expect(agreed).toMatchObject({ version: 1, already: false });
    const row = await prisma.termsAcceptance.findUniqueOrThrow({ where: { id: agreed.id } });
    expect(row).toMatchObject({
      method: "SIGNATURE",
      nameAtSigning: "Sumon Mia",
      codeAtSigning: env.sumon.code,
      nidAtSigning: "1990123456789",
      ipAddress: "203.0.113.7",
      userAgent: meta.userAgent,
      textHash: v1.textHash,
      documentId: null,
    });
    expect(Buffer.from(row.signature!).subarray(1, 4).toString()).toBe("PNG");
    // Agreeing again changes nothing.
    expect(
      await terms.agreeToTerms(
        env.staff,
        { versionId: v1.id, method: "SIGNATURE", signature: signature() },
        meta,
      ),
    ).toMatchObject({ id: agreed.id, already: true });
    expect(await landsOn(env, env.users.staff.id)).toBeNull();
    expect(await landsOn(env, env.users.sales.id)).toMatch(/^\/terms/);

    // The PDF waits in the queue, then the worker makes it.
    const before = await terms.getTermsScreen(env.hr);
    expect(before.staff.rows.find((r) => r.name === "Sumon Mia")).toMatchObject({
      state: "AGREED",
      last: { version: 1, method: "SIGNATURE", pdf: "MAKING", fileId: null },
    });
    expect(await runDueJobs()).toBe(1);
    const made = await prisma.termsAcceptance.findUniqueOrThrow({
      where: { id: agreed.id },
      include: { document: { include: { file: true } } },
    });
    expect(made.document).toMatchObject({
      kind: "TERMS",
      title: "Signed terms of employment, version 1",
      addedById: null,
    });
    const bytes = await readFile(path.join(uploads, made.document!.file.storagePath));
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    // Locked against editing.
    expect(bytes.includes(Buffer.from("/Encrypt"))).toBe(true);
    expect(made.document!.file.fileName).toBe(
      `Extras - Terms v1 - ${env.sumon.code} Sumon Mia.pdf`,
    );
    // Running the job again (a retry after a crash) makes nothing new.
    await enqueueJob(prisma, {
      kind: "terms.pdf",
      companyId: env.company.id,
      payload: { acceptanceId: agreed.id },
    });
    expect(await runDueJobs()).toBe(1);
    expect(await prisma.employeeDocument.count({ where: { kind: "TERMS" } })).toBe(1);

    // HR and the employee open it; it stays in the papers for good.
    const after = await terms.getTermsScreen(env.hr);
    expect(after.staff.rows.find((r) => r.name === "Sumon Mia")?.last).toMatchObject({
      pdf: "READY",
      fileId: made.document!.fileId,
    });
    await expect(files.getFileForDownload(env.staff, made.document!.fileId)).resolves.toBeTruthy();
    await expect(files.getFileForDownload(env.hr, made.document!.fileId)).resolves.toBeTruthy();
    await expectAppError(files.getFileForDownload(env.sales, made.document!.fileId), "FORBIDDEN");
    const mine = await vault.getMyVault(env.staff);
    expect(mine.documents).toMatchObject([{ kind: "TERMS", canRemove: false }]);
    await expectAppError(vault.removeMyDocument(env.staff, made.document!.id), "FORBIDDEN");
    await expectAppError(vault.removeEmployeeDocument(env.hr, made.document!.id), "FORBIDDEN");
    // Nobody uploads a "signed terms" paper by hand: only the app makes them.
    await expect(
      vault.addEmployeeDocument(
        env.hr,
        env.sumon.id,
        { kind: "TERMS" },
        {
          fileName: "x.png",
          bytes: png({ width: 10, height: 10 }),
        },
      ),
    ).rejects.toBeInstanceOf(ZodError);
    const inbox = await prisma.notificationLog.findMany({
      where: { userId: env.users.staff.id, entityType: "MyDetails" },
    });
    expect(inbox.map((m) => m.subject)).toEqual(["Your signed copy of the terms"]);
    const audit = await prisma.auditLog.findMany({
      where: { entityType: "Employee", entityId: env.sumon.id },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((a) => a.summary)).toEqual(
      expect.arrayContaining([
        `${env.sumon.code} Sumon Mia agreed to the terms of employment, version 1 (signed by hand)`,
        `Made the signed copy of the terms of employment, version 1, for ${env.sumon.code} Sumon Mia`,
      ]),
    );
  });

  it("asks everyone again, or only staff who never agreed, as HR chooses", async () => {
    const env = await setup();
    const v1 = await publishFirst(env);
    await terms.agreeToTerms(
      env.staff,
      { versionId: v1.id, method: "SIGNATURE", signature: signature() },
      meta,
    );

    // A wording fix: those who agreed carry on, the others are still asked.
    await terms.saveTermsDraft(env.hr, {
      ...STARTER_TERMS,
      sections: [...STARTER_TERMS.sections, { title: "5. Uniform", body: "Wear the uniform." }],
    });
    const v2 = await terms.publishTerms(env.hr, { askEveryone: false });
    expect(v2).toMatchObject({ version: 2, askEveryone: false, toAgree: 2 });
    expect(await landsOn(env, env.users.staff.id)).toBeNull();
    expect(await landsOn(env, env.users.sales.id)).toMatch(/^\/terms/);
    // Rina now agrees to version 2.
    await terms.agreeToTerms(
      env.sales,
      { versionId: v2.id, method: "SIGNATURE", signature: signature() },
      meta,
    );
    await expectAppError(
      terms.agreeToTerms(
        env.staff,
        { versionId: v2.id, method: "SIGNATURE", signature: signature() },
        meta,
      ),
      "CONFLICT",
    );

    // A real change: everyone agrees again, and is told why.
    await terms.saveTermsDraft(env.hr, { ...STARTER_TERMS, title: "Terms, 2027" });
    const v3 = await terms.publishTerms(env.hr, { askEveryone: true });
    expect(v3).toMatchObject({ version: 3, toAgree: 3 });
    expect(await landsOn(env, env.users.staff.id)).toMatch(/^\/terms/);
    expect(await terms.getTermsGate(env.staff)).toMatchObject({
      due: true,
      version: { version: 3, title: "Terms, 2027" },
      lastAgreed: { version: 1, method: "SIGNATURE" },
    });
    const screen = await terms.getTermsScreen(env.hr, { version: "1" });
    expect(screen.earlier.map((e) => e.version)).toEqual([2, 1]);
    expect(screen.viewing).toMatchObject({ version: 1, title: STARTER_TERMS.title });
  });

  it("agrees by SMS code once SMS is connected, with the code kept secret", async () => {
    const env = await setup();
    const v1 = await publishFirst(env);
    expect((await terms.getTermsGate(env.staff))!.code.available).toBe(false);
    await expectAppError(terms.sendTermsCode(env.staff), "UNAVAILABLE");

    vi.stubEnv("SMS_PROVIDER", "log");
    const said: string[] = [];
    vi.spyOn(console, "info").mockImplementation((text: unknown) => void said.push(String(text)));
    expect((await terms.getTermsGate(env.staff))!.code).toMatchObject({
      available: true,
      phone: "01711-•••000",
    });
    // Nasrin has no mobile number on file: she signs by hand.
    expect((await terms.getTermsGate(env.hr))!.code).toMatchObject({ available: false });
    await expectAppError(terms.sendTermsCode(env.hr), "VALIDATION");

    expect(await terms.sendTermsCode(env.staff)).toMatchObject({
      sentTo: "01711-•••000",
      minutes: 10,
    });
    await expectAppError(terms.sendTermsCode(env.staff), "RATE_LIMITED");
    const code = /(\d{6}) is your code/.exec(said.join("\n"))?.[1];
    expect(code).toMatch(/^\d{6}$/);
    const sms = await prisma.notificationLog.findFirstOrThrow({ where: { channel: "SMS" } });
    expect(sms.body).toContain("••••••");
    expect(sms.body).not.toContain(code!);
    expect(sms.recipient).toBe("01711000000");

    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, "0");
    const refused = await expectAppError(
      terms.agreeToTerms(env.staff, { versionId: v1.id, method: "SMS_CODE", code: wrong }, meta),
      "VALIDATION",
    );
    expect(refused.details).toEqual({
      code: ["That code is not right. Check the SMS and try again."],
    });
    const agreed = await terms.agreeToTerms(
      env.staff,
      { versionId: v1.id, method: "SMS_CODE", code: code! },
      meta,
    );
    expect(
      await prisma.termsAcceptance.findUniqueOrThrow({ where: { id: agreed.id } }),
    ).toMatchObject({
      method: "SMS_CODE",
      phone: "01711000000",
      signature: null,
    });
    expect(await landsOn(env, env.users.staff.id)).toBeNull();
    // The code is used up, after one wrong try.
    const left = await prisma.oneTimeCode.findFirstOrThrow({
      where: { userId: env.users.staff.id },
    });
    expect(left.usedAt).not.toBeNull();
    expect(left.attempts).toBe(1);
  });

  it("ends a code after five wrong tries or ten minutes", async () => {
    const env = await setup();
    const v1 = await publishFirst(env);
    vi.stubEnv("SMS_PROVIDER", "log");
    const said: string[] = [];
    vi.spyOn(console, "info").mockImplementation((text: unknown) => void said.push(String(text)));
    const agreeWith = (code: string) =>
      terms.agreeToTerms(env.staff, { versionId: v1.id, method: "SMS_CODE", code }, meta);

    await expectAppError(agreeWith("123456"), "VALIDATION");
    await terms.sendTermsCode(env.staff);
    const code = /(\d{6}) is your code/.exec(said.join("\n"))![1]!;
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, "0");
    for (let i = 0; i < 5; i++) await expectAppError(agreeWith(wrong), "VALIDATION");
    const ended = await expectAppError(agreeWith(code), "VALIDATION");
    expect(ended.details).toEqual({ code: ["Too many wrong tries. Ask for a new code."] });

    // A new code a minute later works, until it is ten minutes old.
    await prisma.oneTimeCode.updateMany({
      where: { userId: env.users.staff.id },
      data: { createdAt: new Date(Date.now() - 2 * 60_000) },
    });
    said.length = 0;
    await terms.sendTermsCode(env.staff);
    const fresh = /(\d{6}) is your code/.exec(said.join("\n"))![1]!;
    await prisma.oneTimeCode.updateMany({
      where: { userId: env.users.staff.id, usedAt: null, attempts: 0 },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await expectAppError(agreeWith(fresh), "VALIDATION");
    expect(expired.details).toEqual({ code: ["This code has expired. Ask for a new one."] });
    expect(await prisma.termsAcceptance.count()).toBe(0);
  });

  it("keeps a failed PDF visible for HR to make again", async () => {
    const env = await setup();
    const v1 = await publishFirst(env);
    const agreed = await terms.agreeToTerms(
      env.staff,
      { versionId: v1.id, method: "SIGNATURE", signature: signature() },
      meta,
    );
    const job = await prisma.backgroundJob.findFirstOrThrow({ where: { kind: "terms.pdf" } });
    await prisma.backgroundJob.update({ where: { id: job.id }, data: { maxAttempts: 2 } });
    // The storage cannot be written (its folder sits under a plain file): each
    // try fails, the second for good.
    await writeFile(path.join(uploads, "not-a-folder"), "x");
    vi.stubEnv("UPLOAD_DIR", path.join(uploads, "not-a-folder", "uploads"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await runDueJobs()).toBe(1);
    const retry = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(retry).toMatchObject({ status: "QUEUED", attempts: 1 });
    expect(retry.runAfter.getTime()).toBeGreaterThan(Date.now() + 20_000);
    expect(await runDueJobs()).toBe(0);
    const later = () => new Date(Date.now() + 60_000);
    expect(await runDueJobs(20, later)).toBe(1);
    expect(await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "FAILED",
      attempts: 2,
    });
    const screen = await terms.getTermsScreen(env.hr);
    expect(screen.staff.rows.find((r) => r.name === "Sumon Mia")?.last?.pdf).toBe("FAILED");

    // HR asks again once the storage works.
    vi.stubEnv("UPLOAD_DIR", uploads);
    await expectAppError(terms.remakeTermsPdf(env.viewer, agreed.id), "FORBIDDEN");
    expect(await terms.remakeTermsPdf(env.hr, agreed.id)).toMatchObject({ pdf: "MAKING" });
    expect(await runDueJobs()).toBe(1);
    expect(
      (await terms.getTermsScreen(env.hr)).staff.rows.find((r) => r.name === "Sumon Mia")?.last
        ?.pdf,
    ).toBe("READY");
    await expectAppError(terms.remakeTermsPdf(env.hr, agreed.id), "CONFLICT");
  });
});

run("the background job queue", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.backgroundJob.deleteMany();
  });

  it("puts work a crashed worker left behind back in the queue, and clears old jobs", async () => {
    const { company } = await makeCompany("Extras");
    const job = await enqueueJob(prisma, {
      kind: "terms.pdf",
      companyId: company.id,
      payload: { acceptanceId: "gone" },
    });
    const hourAgo = new Date(Date.now() - 60 * 60_000);
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: { status: "RUNNING", lockedAt: hourAgo, lockedBy: "old-worker" },
    });
    expect(await requeueStaleJobs()).toBe(1);
    // An agreement that no longer exists: the job finishes with nothing to do.
    expect(await runDueJobs()).toBe(1);
    const done = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done).toMatchObject({ status: "SUCCEEDED", lockedBy: null });
    expect(await purgeOldJobs()).toBe(0);
    expect(await purgeOldJobs(new Date(Date.now() + 31 * 24 * 60 * 60_000))).toBe(1);
  });

  it("never runs a job twice at once", async () => {
    const { company } = await makeCompany("Extras");
    for (let i = 0; i < 4; i++) {
      await enqueueJob(prisma, {
        kind: "terms.pdf",
        companyId: company.id,
        payload: { acceptanceId: `x${i}` },
      });
    }
    const ran = await Promise.all([runDueJobs(), runDueJobs(), runDueJobs()]);
    expect(ran.reduce((a, b) => a + b, 0)).toBe(4);
    const rows = await prisma.backgroundJob.findMany();
    expect(rows.every((r) => r.status === "SUCCEEDED" && r.attempts === 1)).toBe(true);
  });
});
