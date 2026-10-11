import type { Employee, Prisma, TermsVersion } from "@prisma/client";
import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

import type { Db } from "@/lib/db-types";
import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { ImageCheckError, inspectPng } from "@/lib/images";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { assertCanManageHr } from "@/modules/hr/access";
import { agreeToTermsSchema, publishTermsSchema, termsDraftSchema } from "@/modules/hr/schemas";
import {
  maskedPhone,
  sectionsOf,
  STARTER_TERMS,
  TERMS_STAFF_STATUSES,
  termsDue,
  type TermsText,
  tidyTerms,
} from "@/modules/hr/terms";
import { pushSender, pushToUsers } from "@/modules/integrations/push";
import { bdMobile, sendSms, smsGateway } from "@/modules/integrations/sms";
import { enqueueJob, retryJob } from "@/modules/jobs/queue";
import { kickJobWorker } from "@/modules/jobs/worker";
import { sendInApp } from "@/modules/reminders/notification.service";

/*
 * The terms of employment.
 *   HR (hr.manage)    edits a draft (the starter text, or the last version) and
 *                     publishes it as version 1, 2, 3... A published version
 *                     never changes. Publishing either asks everyone to agree
 *                     again, or only staff who have not agreed to any version.
 *   HR (any HR key)   sees the versions and who has agreed.
 *   Staff             (current employees linked to a login) see the terms full
 *                     screen before anything else in the app (the gate in
 *                     auth/context.ts), read to the end, and agree with a
 *                     signature drawn on the screen, or with a code sent by SMS
 *                     once SMS is connected (integrations/sms.ts).
 * Each agreement keeps who agreed, when, from which IP address and device, the
 * name and NID at that moment and the fingerprint of the text read; the signed
 * PDF is made by the background queue (terms-pdf.ts) and kept in the person's
 * papers.
 */

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 30_000 };

/** How long an SMS code works, the wait before another, and the most per hour. */
export const CODE_RULES = { minutes: 10, resendSeconds: 60, perHour: 5, tries: 5 } as const;
/** A drawn signature: a PNG no bigger than this. */
const SIGNATURE_MAX_BYTES = 500_000;
const SIGNATURE_LIMITS = { maxSide: 3000, maxPixels: 4_000_000 };

/** SHA-256 of the text exactly as staff read it, printed on each signed copy. */
export function termsTextHash(text: TermsText): string {
  const tidy = tidyTerms(text);
  return createHash("sha256")
    .update(
      JSON.stringify([tidy.title, tidy.intro, tidy.sections.map((s) => [s.title, s.body])]),
      "utf8",
    )
    .digest("hex");
}

export function textOfVersion(v: Pick<TermsVersion, "title" | "intro" | "sections">): TermsText {
  return { title: v.title, intro: v.intro, sections: sectionsOf(v.sections) };
}

const versionInclude = {
  publishedBy: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.TermsVersionInclude;

type VersionRow = Prisma.TermsVersionGetPayload<{ include: typeof versionInclude }>;

function presentVersion(v: VersionRow, timezone: string) {
  return {
    id: v.id,
    version: v.version,
    ...textOfVersion(v),
    askEveryone: v.askEveryone,
    textHash: v.textHash,
    publishedAt: v.publishedAt,
    publishedOn: v.publishedAt ? localDay(v.publishedAt, timezone) : null,
    publishedBy: v.publishedBy,
    createdBy: v.createdBy,
    updatedAt: v.updatedAt,
  };
}

export type PresentedTermsVersion = ReturnType<typeof presentVersion>;

/** The latest published version, or null before the first. */
async function latestPublished(db: Db, companyId: string) {
  return db.termsVersion.findFirst({
    where: { companyId, publishedAt: { not: null } },
    include: versionInclude,
    orderBy: { version: "desc" },
  });
}

async function draftOf(db: Db, companyId: string) {
  return db.termsVersion.findFirst({
    where: { companyId, version: null },
    include: versionInclude,
  });
}

const isCurrent = (e: Pick<Employee, "status">) =>
  (TERMS_STAFF_STATUSES as readonly string[]).includes(e.status);

// =============================================================================
// HR: versions and who has agreed
// =============================================================================

export type TermsStaffState = "AGREED" | "TO_AGREE" | "NO_LOGIN" | "NONE";
export type TermsPdfState = "READY" | "MAKING" | "FAILED";

/**
 * The terms screen for HR: the published version, the draft, earlier versions
 * (one of them in full when asked for) and every current employee with where
 * they stand.
 */
export async function getTermsScreen(ctx: CompanyContext, query: { version?: unknown } = {}) {
  if (!ctx.can("hr.view") && !ctx.can("hr.manage") && !ctx.can("hr.payroll")) {
    throw new AppError("FORBIDDEN", "You do not have permission to see the terms of employment.");
  }
  const tz = ctx.company.timezone;
  const [versions, draft, company] = await Promise.all([
    ctx.db.termsVersion.findMany({
      where: { publishedAt: { not: null } },
      include: versionInclude,
      orderBy: { version: "desc" },
    }),
    ctx.can("hr.manage") ? draftOf(prisma, ctx.company.id) : null,
    prisma.company.findUnique({
      where: { id: ctx.company.id },
      select: { termsRequiredSince: true },
    }),
  ]);
  const requiredSince = company?.termsRequiredSince ?? null;
  const published = versions[0] ?? null;
  const asked = Number(query.version);
  const viewing =
    Number.isInteger(asked) && asked > 0
      ? (versions.find((v) => v.version === asked) ?? null)
      : null;

  const employees = await ctx.db.employee.findMany({
    where: { status: { in: [...TERMS_STAFF_STATUSES] } },
    select: {
      id: true,
      code: true,
      name: true,
      designation: true,
      userId: true,
      termsAgreedAt: true,
      termsAgreed: {
        orderBy: { signedAt: "desc" },
        take: 1,
        select: {
          id: true,
          signedAt: true,
          method: true,
          version: { select: { version: true } },
          document: { select: { fileId: true } },
        },
      },
    },
    orderBy: [{ name: "asc" }, { code: "asc" }],
  });

  // Signed copies still being made, or that failed: the jobs that make them.
  const waiting = employees.flatMap((e) => e.termsAgreed.filter((a) => !a.document));
  const jobs = waiting.length
    ? await ctx.db.backgroundJob.findMany({
        where: {
          kind: "terms.pdf",
          createdAt: {
            gte: new Date(Math.min(...waiting.map((a) => a.signedAt.getTime())) - 60_000),
          },
        },
        select: { id: true, status: true, payload: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const jobFor = new Map<string, (typeof jobs)[number]>();
  for (const job of jobs) {
    const acceptanceId = (job.payload as { acceptanceId?: unknown }).acceptanceId;
    if (typeof acceptanceId === "string") jobFor.set(acceptanceId, job);
  }

  const rows = employees.map((e) => {
    const last = e.termsAgreed[0] ?? null;
    const state: TermsStaffState = !published
      ? "NONE"
      : !e.userId
        ? "NO_LOGIN"
        : termsDue(requiredSince, e.termsAgreedAt)
          ? "TO_AGREE"
          : "AGREED";
    const pdf: TermsPdfState | null = !last
      ? null
      : last.document
        ? "READY"
        : jobFor.get(last.id)?.status === "FAILED"
          ? "FAILED"
          : "MAKING";
    return {
      id: e.id,
      code: e.code,
      name: e.name,
      designation: e.designation,
      state,
      last: last
        ? {
            id: last.id,
            version: last.version.version,
            signedOn: localDay(last.signedAt, tz),
            method: last.method,
            fileId: last.document?.fileId ?? null,
            pdf,
          }
        : null,
    };
  });
  const order: Record<TermsStaffState, number> = { TO_AGREE: 0, AGREED: 1, NO_LOGIN: 2, NONE: 3 };
  rows.sort((a, b) => order[a.state] - order[b.state]);

  return {
    published: published ? presentVersion(published, tz) : null,
    earlier: versions.slice(1).map((v) => ({
      id: v.id,
      version: v.version!,
      title: v.title,
      publishedOn: localDay(v.publishedAt!, tz),
      publishedBy: v.publishedBy,
      askEveryone: v.askEveryone,
    })),
    viewing: viewing && viewing.id !== published?.id ? presentVersion(viewing, tz) : null,
    draft: draft ? presentVersion(draft, tz) : null,
    staff: {
      rows,
      agreed: rows.filter((r) => r.state === "AGREED").length,
      toAgree: rows.filter((r) => r.state === "TO_AGREE").length,
      noLogin: rows.filter((r) => r.state === "NO_LOGIN").length,
    },
    can: { edit: ctx.can("hr.manage") },
  };
}

export type TermsScreen = Awaited<ReturnType<typeof getTermsScreen>>;

/** How many current staff with a login still have to agree (the HR overview's count). */
export async function staffToAgreeCount(ctx: CompanyContext): Promise<number | null> {
  const company = await prisma.company.findUnique({
    where: { id: ctx.company.id },
    select: { termsRequiredSince: true },
  });
  const since = company?.termsRequiredSince;
  if (!since) return null;
  return ctx.db.employee.count({
    where: {
      status: { in: [...TERMS_STAFF_STATUSES] },
      userId: { not: null },
      OR: [{ termsAgreedAt: null }, { termsAgreedAt: { lt: since } }],
    },
  });
}

/** Opens a draft: the last published text, or the starter text before the first version. */
export async function startTermsDraft(ctx: CompanyContext, meta?: RequestMeta) {
  assertCanManageHr(ctx, "Only HR can write the terms of employment.");
  const draft = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "Company", ctx.company.id);
    if (await draftOf(tx, ctx.company.id)) {
      throw new AppError("CONFLICT", "A draft is already open. Change it, or discard it first.");
    }
    const latest = await latestPublished(tx, ctx.company.id);
    const text = latest ? textOfVersion(latest) : STARTER_TERMS;
    const created = await tx.termsVersion.create({
      data: {
        companyId: ctx.company.id,
        title: text.title,
        intro: text.intro,
        sections: text.sections,
        createdById: ctx.user.id,
      },
      include: versionInclude,
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "TermsVersion",
        entityId: created.id,
        summary: latest
          ? `Started a new draft of the terms of employment from version ${latest.version}`
          : "Started the first draft of the terms of employment",
      },
      tx,
    );
    return created;
  }, TX_OPTIONS);
  return presentVersion(draft, ctx.company.timezone);
}

/** Saves the draft (opening one when there is none). */
export async function saveTermsDraft(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageHr(ctx, "Only HR can write the terms of employment.");
  const input = tidyTerms(termsDraftSchema.parse(raw) as TermsText);
  const saved = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "Company", ctx.company.id);
    const draft = await draftOf(tx, ctx.company.id);
    const data = { title: input.title, intro: input.intro, sections: input.sections };
    const row = draft
      ? await tx.termsVersion.update({ where: { id: draft.id }, data, include: versionInclude })
      : await tx.termsVersion.create({
          data: { ...data, companyId: ctx.company.id, createdById: ctx.user.id },
          include: versionInclude,
        });
    await auditInCompany(
      ctx,
      meta,
      {
        action: draft ? "UPDATE" : "CREATE",
        entityType: "TermsVersion",
        entityId: row.id,
        summary: `Saved the draft of the terms of employment (${input.sections.length} sections)`,
      },
      tx,
    );
    return row;
  }, TX_OPTIONS);
  return presentVersion(saved, ctx.company.timezone);
}

/** Throws the draft away (published versions stay). */
export async function discardTermsDraft(ctx: CompanyContext, meta?: RequestMeta) {
  assertCanManageHr(ctx, "Only HR can write the terms of employment.");
  return prisma.$transaction(async (tx) => {
    await lockRow(tx, "Company", ctx.company.id);
    const draft = await draftOf(tx, ctx.company.id);
    if (!draft) throw new AppError("NOT_FOUND", "There is no draft to discard.");
    await tx.termsVersion.delete({ where: { id: draft.id } });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "DELETE",
        entityType: "TermsVersion",
        entityId: draft.id,
        summary: "Discarded the draft of the terms of employment",
      },
      tx,
    );
    return { id: draft.id };
  }, TX_OPTIONS);
}

/**
 * Publishes the draft as the next version. The first version, and any version
 * published with askEveryone, must be agreed to by every current employee with
 * a login before they work in the app again; otherwise only staff who never
 * agreed are asked. Those who must agree are told in the app.
 */
export async function publishTerms(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageHr(ctx, "Only HR can publish the terms of employment.");
  const input = publishTermsSchema.parse(raw ?? {});
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "Company", ctx.company.id);
    const draft = await draftOf(tx, ctx.company.id);
    if (!draft) throw new AppError("NOT_FOUND", "There is no draft to publish. Start one first.");
    const text = tidyTerms(textOfVersion(draft));
    const checked = termsDraftSchema.safeParse(text);
    if (!checked.success) {
      throw new AppError("VALIDATION", "Finish the draft before publishing it.");
    }
    const latest = await latestPublished(tx, ctx.company.id);
    const textHash = termsTextHash(text);
    if (latest && latest.textHash === textHash) {
      throw new AppError(
        "VALIDATION",
        `The draft reads the same as version ${latest.version}. Change something first, or discard it.`,
      );
    }
    const version = (latest?.version ?? 0) + 1;
    const askEveryone = !latest || input.askEveryone;
    const published = await tx.termsVersion.update({
      where: { id: draft.id },
      data: {
        version,
        title: text.title,
        intro: text.intro,
        sections: text.sections,
        askEveryone,
        textHash,
        publishedAt: now,
        publishedById: ctx.user.id,
      },
      include: versionInclude,
    });
    const company = await tx.company.findUniqueOrThrow({
      where: { id: ctx.company.id },
      select: { termsRequiredSince: true },
    });
    const since = askEveryone ? now : (company.termsRequiredSince ?? now);
    if (since !== company.termsRequiredSince) {
      await tx.company.update({
        where: { id: ctx.company.id },
        data: { termsRequiredSince: since },
      });
    }
    const toAgree = await tx.employee.findMany({
      where: {
        companyId: ctx.company.id,
        status: { in: [...TERMS_STAFF_STATUSES] },
        userId: { not: null },
        OR: [{ termsAgreedAt: null }, { termsAgreedAt: { lt: since } }],
      },
      select: { id: true, userId: true },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "TermsVersion",
        entityId: published.id,
        summary: `Published the terms of employment, version ${version} (${
          askEveryone ? "everyone agrees again" : "only staff who never agreed are asked"
        }); ${toAgree.length} to agree`,
      },
      tx,
    );
    const recipients = toAgree.map((e) => ({ userId: e.userId!, employeeId: e.id }));
    await sendInApp(tx, ctx.company.id, recipients, {
      subject: `Terms of employment, version ${version}`,
      body: "Please read the terms of employment and agree to them. The app shows them the next time you open it.",
      entityType: "Terms",
      entityId: published.id,
    });
    return { published, recipients };
  }, TX_OPTIONS);

  await pushToUsers(
    result.recipients.map((r) => r.userId),
    {
      title: `Terms of employment, version ${result.published.version}`,
      body: "Please read and agree to them in the app.",
      url: "/terms",
    },
    pushSender(),
  );
  return {
    ...presentVersion(result.published, ctx.company.timezone),
    toAgree: result.recipients.length,
  };
}

/** Asks again for a signed copy that failed (or is missing). */
export async function remakeTermsPdf(
  ctx: CompanyContext,
  acceptanceId: string,
  meta?: RequestMeta,
) {
  assertCanManageHr(ctx, "Only HR can do this.");
  const acceptance = await ctx.db.termsAcceptance.findFirst({
    where: { id: acceptanceId },
    include: { employee: { select: { id: true, code: true, name: true } } },
  });
  if (!acceptance) throw new AppError("NOT_FOUND", "Agreement not found.");
  if (acceptance.documentId) {
    throw new AppError("CONFLICT", "The signed copy is already made.");
  }
  const jobs = await ctx.db.backgroundJob.findMany({
    where: {
      kind: "terms.pdf",
      createdAt: { gte: new Date(acceptance.signedAt.getTime() - 60_000) },
    },
    select: { id: true, status: true, payload: true },
  });
  const mine = jobs.filter(
    (j) => (j.payload as { acceptanceId?: unknown }).acceptanceId === acceptance.id,
  );
  if (!mine.some((j) => j.status === "QUEUED" || j.status === "RUNNING")) {
    const failed = mine.find((j) => j.status === "FAILED");
    if (failed) await retryJob(prisma, failed.id);
    else {
      await enqueueJob(prisma, {
        kind: "terms.pdf",
        companyId: ctx.company.id,
        payload: { acceptanceId: acceptance.id },
      });
    }
    await auditInCompany(ctx, meta, {
      action: "UPDATE",
      entityType: "Employee",
      entityId: acceptance.employee.id,
      summary: `Asked again for ${acceptance.employee.code} ${acceptance.employee.name}'s signed copy of the terms`,
    });
  }
  kickJobWorker();
  return { id: acceptance.id, pdf: "MAKING" as TermsPdfState };
}

// =============================================================================
// Staff: the terms screen (/terms)
// =============================================================================

async function myEmployee(ctx: CompanyContext) {
  return ctx.db.employee.findFirst({ where: { userId: ctx.user.id } });
}

/** Whether this employee must agree now (the same rule as the gate). */
async function mustAgree(ctx: CompanyContext, employee: Employee | null) {
  if (!employee || !isCurrent(employee)) return false;
  const company = await prisma.company.findUnique({
    where: { id: ctx.company.id },
    select: { termsRequiredSince: true },
  });
  return termsDue(company?.termsRequiredSince ?? null, employee.termsAgreedAt);
}

/**
 * The terms screen: the version to read and agree to (due), or the version in
 * force with when the person agreed (not due), or nothing before the first.
 */
export async function getTermsGate(ctx: CompanyContext) {
  const employee = await myEmployee(ctx);
  const latest = await latestPublished(prisma, ctx.company.id);
  if (!latest) return null;
  const due = await mustAgree(ctx, employee);
  const lastAgreed = employee
    ? await ctx.db.termsAcceptance.findFirst({
        where: { employeeId: employee.id },
        include: { version: { select: { version: true } } },
        orderBy: { signedAt: "desc" },
      })
    : null;
  const phone = employee?.phone ? bdMobile(employee.phone) : null;
  const sms = smsGateway() !== null;
  return {
    due,
    version: presentVersion(latest, ctx.company.timezone),
    employee: employee ? { name: employee.name, code: employee.code } : null,
    lastAgreed: lastAgreed
      ? {
          version: lastAgreed.version.version,
          signedOn: localDay(lastAgreed.signedAt, ctx.company.timezone),
          method: lastAgreed.method,
        }
      : null,
    /** Agreeing by SMS code: possible when SMS is on and a mobile number is on file. */
    code: {
      available: sms && phone !== null,
      phone: phone ? maskedPhone(phone) : null,
      note: !sms ? null : phone ? null : "No mobile number is on your record for a code.",
      ...CODE_RULES,
    },
  };
}

export type TermsGate = NonNullable<Awaited<ReturnType<typeof getTermsGate>>>;

const codeHash = (id: string, code: string) =>
  createHash("sha256").update(`${id}:${code}`).digest();

/** Sends a 6-digit code to the employee's mobile, to agree with instead of signing. */
export async function sendTermsCode(ctx: CompanyContext) {
  const employee = await myEmployee(ctx);
  if (!(await mustAgree(ctx, employee)) || !employee) {
    throw new AppError("CONFLICT", "You have already agreed to the terms.");
  }
  const latest = await latestPublished(prisma, ctx.company.id);
  if (!latest) throw new AppError("NOT_FOUND", "There are no terms to agree to.");
  const gateway = smsGateway();
  if (!gateway) {
    throw new AppError("UNAVAILABLE", "SMS codes are not switched on. Sign by hand instead.");
  }
  const phone = employee.phone ? bdMobile(employee.phone) : null;
  if (!phone) {
    throw new AppError(
      "VALIDATION",
      "There is no mobile number on your record for a code. Sign by hand instead, or ask HR to add your number.",
    );
  }
  const purpose = `terms:${latest.id}`;
  const now = new Date();
  const recent = await ctx.db.oneTimeCode.findMany({
    where: {
      userId: ctx.user.id,
      purpose,
      createdAt: { gte: new Date(now.getTime() - 60 * 60_000) },
    },
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  if (
    recent[0] &&
    now.getTime() - recent[0].createdAt.getTime() < CODE_RULES.resendSeconds * 1000
  ) {
    throw new AppError("RATE_LIMITED", "A code was just sent. Wait a minute before asking again.");
  }
  if (recent.length >= CODE_RULES.perHour) {
    throw new AppError(
      "RATE_LIMITED",
      "Too many codes in the last hour. Sign by hand instead, or try again later.",
    );
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const id = randomUUID();
  await ctx.db.oneTimeCode.create({
    data: {
      id,
      companyId: ctx.company.id,
      userId: ctx.user.id,
      purpose,
      codeHash: codeHash(id, code).toString("hex"),
      sentTo: phone,
      expiresAt: new Date(now.getTime() + CODE_RULES.minutes * 60_000),
    },
  });
  const words = (shown: string) =>
    `Extas ERP: ${shown} is your code to agree to the terms of employment. It works for ${CODE_RULES.minutes} minutes. Do not share it.`;
  const sent = await sendSms(
    prisma,
    ctx.company.id,
    {
      to: phone,
      text: words(code),
      keep: words("••••••"),
      employeeId: employee.id,
      userId: ctx.user.id,
    },
    gateway,
  );
  if (!sent.ok) {
    await ctx.db.oneTimeCode.update({ where: { id }, data: { usedAt: now } });
    throw new AppError(
      "UNAVAILABLE",
      "The SMS could not be sent. Try again in a minute, or sign by hand instead.",
    );
  }
  return {
    sentTo: maskedPhone(phone),
    minutes: CODE_RULES.minutes,
    resendSeconds: CODE_RULES.resendSeconds,
  };
}

/** Checks the SMS code; a wrong one counts against the code's tries. Returns the code's id. */
async function checkCode(ctx: CompanyContext, purpose: string, code: string): Promise<string> {
  const row = await ctx.db.oneTimeCode.findFirst({
    where: { userId: ctx.user.id, purpose, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  const wrong = (message: string) => new AppError("VALIDATION", message, { code: [message] });
  if (!row) throw wrong("Ask for a code first.");
  if (row.expiresAt.getTime() <= Date.now())
    throw wrong("This code has expired. Ask for a new one.");
  if (row.attempts >= CODE_RULES.tries) throw wrong("Too many wrong tries. Ask for a new code.");
  const expected = Buffer.from(row.codeHash, "hex");
  const given = codeHash(row.id, code);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    await ctx.db.oneTimeCode.update({
      where: { id: row.id },
      data: { attempts: { increment: 1 } },
    });
    throw wrong("That code is not right. Check the SMS and try again.");
  }
  return row.id;
}

/** A signature drawn on the screen, as PNG bytes, checked so the PDF writer can trust it. */
function signatureBytes(dataUrl: string): Buffer {
  const fail = () =>
    new AppError("VALIDATION", "The signature could not be read. Clear it and sign again.", {
      signature: ["The signature could not be read. Clear it and sign again."],
    });
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl.trim());
  if (!match) throw fail();
  const bytes = Buffer.from(match[1]!, "base64");
  if (bytes.length === 0 || bytes.length > SIGNATURE_MAX_BYTES) throw fail();
  try {
    inspectPng(bytes, SIGNATURE_LIMITS);
  } catch (error) {
    if (error instanceof ImageCheckError) throw fail();
    throw error;
  }
  return bytes;
}

/**
 * Agrees to the version shown, by signature or SMS code. Records the agreement
 * with the person's details at this moment and asks the background queue for
 * the signed PDF. Agreeing twice to the same version changes nothing.
 */
export async function agreeToTerms(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const input = agreeToTermsSchema.parse(raw);
  const employee = await myEmployee(ctx);
  if (!employee) {
    throw new AppError("NOT_FOUND", "Your login is not linked to an employee profile here.");
  }
  const latest = await latestPublished(prisma, ctx.company.id);
  if (!latest) throw new AppError("NOT_FOUND", "There are no terms to agree to.");
  if (input.versionId !== latest.id) {
    throw new AppError(
      "CONFLICT",
      "The terms were just updated. Read the new version before you agree.",
    );
  }
  const already = await ctx.db.termsAcceptance.findFirst({
    where: { employeeId: employee.id, versionId: latest.id },
  });
  if (already) return { id: already.id, version: latest.version!, already: true };
  if (!(await mustAgree(ctx, employee))) {
    throw new AppError("CONFLICT", "You have already agreed to the terms.");
  }
  const signature = input.method === "SIGNATURE" ? signatureBytes(input.signature) : null;
  const codeId =
    input.method === "SMS_CODE" ? await checkCode(ctx, `terms:${latest.id}`, input.code) : null;

  const created = await prisma.$transaction(async (tx: Tx) => {
    await lockRow(tx, "Employee", employee.id);
    const fresh = await tx.employee.findUniqueOrThrow({ where: { id: employee.id } });
    const twice = await tx.termsAcceptance.findFirst({
      where: { employeeId: employee.id, versionId: latest.id },
    });
    if (twice) return { acceptance: twice, phone: null, existing: true };
    let phone: string | null = null;
    if (codeId) {
      const used = await tx.oneTimeCode.updateMany({
        where: { id: codeId, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (used.count === 0) throw new AppError("CONFLICT", "This code was already used.");
      phone = (await tx.oneTimeCode.findUniqueOrThrow({ where: { id: codeId } })).sentTo;
    }
    const signedAt = new Date();
    const acceptance = await tx.termsAcceptance.create({
      data: {
        companyId: ctx.company.id,
        employeeId: fresh.id,
        versionId: latest.id,
        userId: ctx.user.id,
        method: input.method,
        signature: signature ? new Uint8Array(signature) : null,
        phone,
        nameAtSigning: fresh.name,
        codeAtSigning: fresh.code,
        nidAtSigning: fresh.nid,
        ipAddress: meta?.ipAddress?.slice(0, 100) ?? null,
        userAgent: meta?.userAgent?.slice(0, 500) ?? null,
        textHash: latest.textHash ?? termsTextHash(textOfVersion(latest)),
        signedAt,
      },
    });
    await tx.employee.update({ where: { id: fresh.id }, data: { termsAgreedAt: signedAt } });
    await enqueueJob(tx, {
      kind: "terms.pdf",
      companyId: ctx.company.id,
      payload: { acceptanceId: acceptance.id },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "Employee",
        entityId: fresh.id,
        summary: `${fresh.code} ${fresh.name} agreed to the terms of employment, version ${latest.version} (${
          phone ? `SMS code to ${maskedPhone(phone)}` : "signed by hand"
        })`,
      },
      tx,
    );
    return { acceptance, phone, existing: false };
  }, TX_OPTIONS);
  if (!created.existing) kickJobWorker();
  return { id: created.acceptance.id, version: latest.version!, already: created.existing };
}
