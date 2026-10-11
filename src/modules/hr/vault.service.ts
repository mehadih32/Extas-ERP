import type { EmployeeDocumentKind, PayDetailsRequest, Prisma } from "@prisma/client";

import { METHOD_LABELS } from "@/components/sales/labels";
import { dateColumn, dateOnly, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { assertAllowed } from "@/lib/verdict";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import * as files from "@/modules/files/file.service";
import { actingAs, assertCanManageHr, requireLinkedEmployee } from "@/modules/hr/access";
import { canActOnOwnRecord } from "@/modules/hr/rules";
import {
  decidePayRequestSchema,
  employeeDocumentSchema,
  listPayRequestsSchema,
  myDetailsSchema,
  payDetailsRequestSchema,
  rejectPayRequestSchema,
} from "@/modules/hr/schemas";
import {
  type PayDetails,
  payDetailsOf,
  samePayDetails,
  SELF_DOCUMENT_KINDS,
  vaultGaps,
} from "@/modules/hr/vault";
import { activeMembers, membersWith } from "@/modules/reminders/audience";
import { sendInApp } from "@/modules/reminders/notification.service";

/*
 * The employee data vault: the details a complete record needs (hr/vault.ts),
 * the papers kept with it (NID scan, photo, certificates) and changes to how
 * the salary is paid.
 *   HR (hr.manage)  sees and fills everything, adds and removes papers, and
 *                   approves or turns down pay detail changes (not their own,
 *                   unless they are the Super Admin).
 *   The employee    (portal.self) fills in their own details in My HR: who they
 *                   are once, contacts and their reference person any time. A
 *                   new bank account or wallet waits for HR's approval, so a
 *                   salary cannot be redirected by whoever holds the login.
 * Every change is in the audit trail; HR and the employee are told in the app.
 */

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 30_000 };
/** Papers kept per employee. */
export const MAX_DOCUMENTS = 40;

/** "bKash 01711000000", "Bank transfer: City Bank, Gulshan, 1234", "Cash". */
export function payDetailsText(p: PayDetails): string {
  const details =
    p.salaryMethod === "BANK_TRANSFER" || p.salaryMethod === "CHEQUE"
      ? [p.bankName, p.bankBranch, p.bankAccountNumber].filter(Boolean).join(", ")
      : p.salaryMethod === "BKASH" || p.salaryMethod === "NAGAD" || p.salaryMethod === "ROCKET"
        ? (p.walletNumber ?? "")
        : "";
  const method = METHOD_LABELS[p.salaryMethod];
  if (!details) return method;
  return p.salaryMethod === "BANK_TRANSFER" || p.salaryMethod === "CHEQUE"
    ? `${method}: ${details}`
    : `${method} ${details}`;
}

const requestInclude = {
  requestedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
} satisfies Prisma.PayDetailsRequestInclude;

type RequestRow = PayDetailsRequest & {
  requestedBy: { id: string; name: string } | null;
  decidedBy: { id: string; name: string } | null;
};

function presentRequest(r: RequestRow, timezone: string) {
  const changes = payDetailsOf(r.changes as PayDetails);
  const previous = payDetailsOf(r.previous as PayDetails);
  return {
    id: r.id,
    status: r.status,
    changes,
    previous,
    changesText: payDetailsText(changes),
    previousText: payDetailsText(previous),
    note: r.note,
    decisionNote: r.decisionNote,
    requestedBy: r.requestedBy,
    decidedBy: r.decidedBy,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
    /** Days in company time, "2026-10-11". */
    askedOn: localDay(r.createdAt, timezone),
    decidedOn: r.decidedAt ? localDay(r.decidedAt, timezone) : null,
  };
}

export type PayRequestView = ReturnType<typeof presentRequest>;

const documentInclude = {
  file: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true } },
  addedBy: { select: { id: true, name: true } },
} satisfies Prisma.EmployeeDocumentInclude;

type DocumentRow = Prisma.EmployeeDocumentGetPayload<{ include: typeof documentInclude }>;

function presentDocument(d: DocumentRow, timezone: string) {
  return {
    id: d.id,
    kind: d.kind,
    title: d.title,
    fileId: d.file.id,
    fileName: d.file.fileName,
    mimeType: d.file.mimeType,
    sizeBytes: d.file.sizeBytes,
    addedBy: d.addedBy,
    createdAt: d.createdAt,
    addedOn: localDay(d.createdAt, timezone),
  };
}

export type VaultDocument = ReturnType<typeof presentDocument>;

async function loadEmployee(ctx: CompanyContext, employeeId: string) {
  const employee = await ctx.db.employee.findFirst({ where: { id: employeeId } });
  if (!employee) throw new AppError("NOT_FOUND", "Employee not found.");
  return employee;
}

const documentsOf = (ctx: CompanyContext, employeeId: string) =>
  ctx.db.employeeDocument.findMany({
    where: { employeeId },
    include: documentInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

/** The HR managers to tell about a request, not the person who made it. */
async function hrManagers(companyId: string, except: string, db: Tx | typeof prisma) {
  const members = await activeMembers(companyId, db);
  return membersWith(members, ["hr.manage"])
    .filter((userId) => userId !== except)
    .map((userId) => ({ userId }));
}

// =============================================================================
// HR: one employee's vault, and the pay detail changes waiting
// =============================================================================

/** What HR sees in an employee's vault: what is missing, papers, the change waiting. */
export async function getEmployeeVault(ctx: CompanyContext, employeeId: string) {
  assertCanManageHr(ctx, "Only HR can open the data vault.");
  const employee = await loadEmployee(ctx, employeeId);
  const [documents, requests] = await Promise.all([
    documentsOf(ctx, employee.id),
    ctx.db.payDetailsRequest.findMany({
      where: { employeeId: employee.id },
      include: requestInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 4,
    }),
  ]);
  const pending = requests.find((r) => r.status === "PENDING") ?? null;
  const decide = pending
    ? canActOnOwnRecord(
        employee,
        actingAs(ctx),
        "Someone else must approve a change to your own pay details.",
      )
    : null;
  return {
    gaps: vaultGaps(employee),
    documents: documents.map((d) => presentDocument(d, ctx.company.timezone)),
    pendingRequest: pending ? presentRequest(pending, ctx.company.timezone) : null,
    recentRequests: requests
      .filter((r) => r.status !== "PENDING")
      .map((r) => presentRequest(r, ctx.company.timezone)),
    can: {
      decide: decide?.ok === true,
      addDocument: documents.length < MAX_DOCUMENTS,
    },
    notes: { decide: decide && !decide.ok ? decide.message : null },
  };
}

export type EmployeeVault = Awaited<ReturnType<typeof getEmployeeVault>>;

/** Pay detail changes, newest first (the waiting ones by default), with whose they are. */
export async function listPayRequests(ctx: CompanyContext, raw: unknown = {}) {
  assertCanManageHr(ctx, "Only HR can see pay detail changes.");
  const q = listPayRequestsSchema.parse(raw);
  const rows = await ctx.db.payDetailsRequest.findMany({
    where: {
      status: q.status ?? "PENDING",
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
    },
    include: { ...requestInclude, employee: { select: { id: true, code: true, name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.take ?? 50,
  });
  return rows.map((r) => ({ ...presentRequest(r, ctx.company.timezone), employee: r.employee }));
}

/** The request, still waiting, locked with its employee for the decision. */
async function openRequest(tx: Tx, ctx: CompanyContext, requestId: string) {
  const request = await tx.payDetailsRequest.findFirst({
    where: { id: requestId, companyId: ctx.company.id },
  });
  if (!request) throw new AppError("NOT_FOUND", "Pay detail change not found.");
  await lockRow(tx, "Employee", request.employeeId);
  const fresh = await tx.payDetailsRequest.findUniqueOrThrow({ where: { id: request.id } });
  if (fresh.status !== "PENDING") {
    throw new AppError("CONFLICT", "This change was already decided or withdrawn.");
  }
  const employee = await tx.employee.findUniqueOrThrow({ where: { id: fresh.employeeId } });
  return { request: fresh, employee };
}

/** HR approves: the salary goes the new way from now on (payroll already approved stays). */
export async function approvePayRequest(
  ctx: CompanyContext,
  requestId: string,
  raw: unknown = {},
  meta?: RequestMeta,
) {
  assertCanManageHr(ctx, "Only HR can approve pay detail changes.");
  const input = decidePayRequestSchema.parse(raw);
  const id = await prisma.$transaction(async (tx) => {
    const { request, employee } = await openRequest(tx, ctx, requestId);
    assertAllowed(
      canActOnOwnRecord(
        employee,
        actingAs(ctx),
        "Someone else must approve a change to your own pay details.",
      ),
    );
    const changes = payDetailsOf(request.changes as PayDetails);
    await tx.employee.update({ where: { id: employee.id }, data: changes });
    await tx.payDetailsRequest.update({
      where: { id: request.id },
      data: {
        status: "APPROVED",
        decidedById: ctx.user.id,
        decidedAt: new Date(),
        decisionNote: input.note || null,
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "Employee",
        entityId: employee.id,
        summary: `Approved ${employee.code} ${employee.name}'s pay details: ${payDetailsText(
          payDetailsOf(request.previous as PayDetails),
        )} → ${payDetailsText(changes)}`,
      },
      tx,
    );
    if (employee.userId) {
      await sendInApp(tx, ctx.company.id, [{ userId: employee.userId, employeeId: employee.id }], {
        subject: "Your pay details were changed",
        body: `HR approved your change. Your salary now goes to ${payDetailsText(changes)}.`,
        entityType: "MyDetails",
        entityId: employee.id,
      });
    }
    return request.id;
  }, TX_OPTIONS);
  return presentRequest(
    await ctx.db.payDetailsRequest.findUniqueOrThrow({ where: { id }, include: requestInclude }),
    ctx.company.timezone,
  );
}

/** HR turns a change down, saying why; the pay details stay as they are. */
export async function rejectPayRequest(
  ctx: CompanyContext,
  requestId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageHr(ctx, "Only HR can turn down pay detail changes.");
  const input = rejectPayRequestSchema.parse(raw);
  const id = await prisma.$transaction(async (tx) => {
    const { request, employee } = await openRequest(tx, ctx, requestId);
    assertAllowed(
      canActOnOwnRecord(
        employee,
        actingAs(ctx),
        "Someone else must decide on a change to your own pay details.",
      ),
    );
    await tx.payDetailsRequest.update({
      where: { id: request.id },
      data: {
        status: "REJECTED",
        decidedById: ctx.user.id,
        decidedAt: new Date(),
        decisionNote: input.reason,
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "Employee",
        entityId: employee.id,
        summary: `Turned down ${employee.code} ${employee.name}'s pay details change to ${payDetailsText(
          payDetailsOf(request.changes as PayDetails),
        )}: ${input.reason}`,
      },
      tx,
    );
    if (employee.userId) {
      await sendInApp(tx, ctx.company.id, [{ userId: employee.userId, employeeId: employee.id }], {
        subject: "Your pay details change was not approved",
        body: `HR's reason: ${input.reason}`,
        entityType: "MyDetails",
        entityId: employee.id,
      });
    }
    return request.id;
  }, TX_OPTIONS);
  return presentRequest(
    await ctx.db.payDetailsRequest.findUniqueOrThrow({ where: { id }, include: requestInclude }),
    ctx.company.timezone,
  );
}

// =============================================================================
// Papers in the vault
// =============================================================================

/** Stores the upload and keeps it as the employee's paper; the file is removed again on failure. */
async function addDocument(
  ctx: CompanyContext,
  employeeId: string,
  kind: EmployeeDocumentKind,
  title: string | null,
  upload: { fileName: string; bytes: Buffer },
  meta: RequestMeta | undefined,
  who: string,
) {
  const asset = await files.storeUpload(ctx, upload, meta);
  try {
    return await prisma.$transaction(async (tx) => {
      await lockRow(tx, "Employee", employeeId);
      const employee = await tx.employee.findUniqueOrThrow({ where: { id: employeeId } });
      const count = await tx.employeeDocument.count({ where: { employeeId } });
      if (count >= MAX_DOCUMENTS) {
        throw new AppError(
          "CONFLICT",
          `${MAX_DOCUMENTS} papers are kept per employee. Remove an old one first.`,
        );
      }
      const document = await tx.employeeDocument.create({
        data: {
          companyId: ctx.company.id,
          employeeId,
          kind,
          title,
          fileId: asset.id,
          addedById: ctx.user.id,
        },
        include: documentInclude,
      });
      await auditInCompany(
        ctx,
        meta,
        {
          action: "CREATE",
          entityType: "Employee",
          entityId: employeeId,
          summary: `${who} added ${kind.toLowerCase()} paper "${title ?? asset.fileName}" to ${employee.code} ${employee.name}'s vault`,
        },
        tx,
      );
      return presentDocument(document, ctx.company.timezone);
    }, TX_OPTIONS);
  } catch (error) {
    const stored = await prisma.fileAsset.findUnique({ where: { id: asset.id } });
    if (stored) {
      await prisma.fileAsset.delete({ where: { id: stored.id } });
      await files.deleteStoredFile(stored);
    }
    throw error;
  }
}

/** HR keeps a paper (NID scan, photo, certificate, appointment letter) in an employee's vault. */
export async function addEmployeeDocument(
  ctx: CompanyContext,
  employeeId: string,
  raw: unknown,
  upload: { fileName: string; bytes: Buffer },
  meta?: RequestMeta,
) {
  assertCanManageHr(ctx, "Only HR can add papers to an employee's vault.");
  const input = employeeDocumentSchema.parse(raw);
  const employee = await loadEmployee(ctx, employeeId);
  return addDocument(ctx, employee.id, input.kind, input.title || null, upload, meta, "HR");
}

/** Removes a paper and its file: HR any paper, an employee the ones they added themselves. */
async function removeDocument(
  ctx: CompanyContext,
  documentId: string,
  allowed: (d: { employeeId: string; addedById: string | null }) => boolean,
  meta: RequestMeta | undefined,
) {
  const removed = await prisma.$transaction(async (tx) => {
    const document = await tx.employeeDocument.findFirst({
      where: { id: documentId, companyId: ctx.company.id },
      include: { file: true, employee: { select: { id: true, code: true, name: true } } },
    });
    if (!document) throw new AppError("NOT_FOUND", "Paper not found.");
    if (!allowed(document)) {
      throw new AppError("FORBIDDEN", "Only HR can remove this paper.");
    }
    // The file was stored for this paper only; removing it removes the paper too.
    await tx.fileAsset.delete({ where: { id: document.fileId } });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "DELETE",
        entityType: "Employee",
        entityId: document.employee.id,
        summary: `Removed ${document.kind.toLowerCase()} paper "${document.title ?? document.file.fileName}" from ${document.employee.code} ${document.employee.name}'s vault`,
      },
      tx,
    );
    return { id: document.id, file: document.file };
  }, TX_OPTIONS);
  await files.deleteStoredFile(removed.file);
  return { id: removed.id };
}

export async function removeEmployeeDocument(
  ctx: CompanyContext,
  documentId: string,
  meta?: RequestMeta,
) {
  assertCanManageHr(ctx, "Only HR can remove papers from an employee's vault.");
  return removeDocument(ctx, documentId, () => true, meta);
}

// =============================================================================
// The employee's own vault (My HR > My details)
// =============================================================================

/** The details the employee fills in, which are locked once filled, papers and their pay change. */
export async function getMyVault(ctx: CompanyContext) {
  const employee = await requireLinkedEmployee(ctx);
  const [documents, request] = await Promise.all([
    documentsOf(ctx, employee.id),
    ctx.db.payDetailsRequest.findFirst({
      where: { employeeId: employee.id, status: { not: "WITHDRAWN" } },
      include: requestInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
  ]);
  return {
    details: {
      name: employee.name,
      code: employee.code,
      phone: employee.phone,
      whatsapp: employee.whatsapp,
      email: employee.email,
      nid: employee.nid,
      dateOfBirth: dateOnly(employee.dateOfBirth),
      bloodGroup: employee.bloodGroup,
      address: employee.address,
      emergencyContact: employee.emergencyContact,
      referenceName: employee.referenceName,
      referencePhone: employee.referencePhone,
      referenceRelation: employee.referenceRelation,
    },
    /** Who they are is filled once; after that only HR changes it. */
    locked: {
      nid: Boolean(employee.nid?.trim()),
      dateOfBirth: employee.dateOfBirth !== null,
      bloodGroup: Boolean(employee.bloodGroup?.trim()),
    },
    gaps: vaultGaps(employee),
    pay: { ...payDetailsOf(employee), text: payDetailsText(payDetailsOf(employee)) },
    /** The change waiting for HR, or the last one HR decided. */
    payRequest: request ? presentRequest(request, ctx.company.timezone) : null,
    documents: documents.map((d) => ({
      ...presentDocument(d, ctx.company.timezone),
      canRemove: d.addedById === ctx.user.id,
    })),
    can: { addDocument: documents.length < MAX_DOCUMENTS },
  };
}

export type MyVault = Awaited<ReturnType<typeof getMyVault>>;

/** The employee fills in or updates their own details. */
export async function updateMyDetails(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const linked = await requireLinkedEmployee(ctx);
  const input = myDetailsSchema.parse(raw);
  const changed: string[] = [];
  await prisma.$transaction(async (tx) => {
    await lockRow(tx, "Employee", linked.id);
    const e = await tx.employee.findUniqueOrThrow({ where: { id: linked.id } });
    const data: Prisma.EmployeeUpdateInput = {};
    const once = (field: "nid" | "bloodGroup", value: string | null | undefined, what: string) => {
      if (value === undefined || (value ?? null) === (e[field] ?? null)) return;
      if (e[field]?.trim()) {
        throw new AppError("FORBIDDEN", `Your ${what} is already on file. Ask HR to change it.`, {
          [field]: [`Ask HR to change your ${what}.`],
        });
      }
      data[field] = value;
      changed.push(what);
    };
    once("nid", input.nid, "national ID");
    once("bloodGroup", input.bloodGroup, "blood group");
    if (input.dateOfBirth !== undefined && input.dateOfBirth !== dateOnly(e.dateOfBirth)) {
      if (e.dateOfBirth) {
        throw new AppError(
          "FORBIDDEN",
          "Your date of birth is already on file. Ask HR to change it.",
          {
            dateOfBirth: ["Ask HR to change your date of birth."],
          },
        );
      }
      data.dateOfBirth = input.dateOfBirth ? dateColumn(input.dateOfBirth) : null;
      changed.push("date of birth");
    }
    const free = [
      ["whatsapp", "WhatsApp"],
      ["email", "email"],
      ["address", "address"],
      ["emergencyContact", "emergency contact"],
      ["referenceName", "reference name"],
      ["referencePhone", "reference phone"],
      ["referenceRelation", "reference relation"],
    ] as const;
    for (const [field, what] of free) {
      const value = input[field];
      if (value === undefined || (value ?? null) === (e[field] ?? null)) continue;
      data[field] = value ?? null;
      changed.push(what);
    }
    if (changed.length === 0) return;
    await tx.employee.update({ where: { id: e.id }, data });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "Employee",
        entityId: e.id,
        summary: `${e.code} ${e.name} updated their own details: ${changed.join(", ")}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return { changed, ...(await getMyVault(ctx)) };
}

/**
 * The employee asks to be paid another way or to another account. It waits for
 * HR; a newer ask replaces one still waiting.
 */
export async function requestPayDetailsChange(
  ctx: CompanyContext,
  raw: unknown,
  meta?: RequestMeta,
) {
  const linked = await requireLinkedEmployee(ctx);
  const input = payDetailsRequestSchema.parse(raw);
  const id = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "Employee", linked.id);
    const e = await tx.employee.findUniqueOrThrow({ where: { id: linked.id } });
    const previous = payDetailsOf(e);
    if (samePayDetails(previous, input.changes)) {
      throw new AppError("VALIDATION", "These are already your pay details.");
    }
    await tx.payDetailsRequest.updateMany({
      where: { employeeId: e.id, status: "PENDING" },
      data: { status: "WITHDRAWN", decisionNote: "Replaced by a newer request." },
    });
    const request = await tx.payDetailsRequest.create({
      data: {
        companyId: ctx.company.id,
        employeeId: e.id,
        changes: input.changes,
        previous,
        note: input.note,
        requestedById: ctx.user.id,
      },
    });
    const text = `${payDetailsText(input.changes)} instead of ${payDetailsText(previous)}`;
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "Employee",
        entityId: e.id,
        summary: `${e.code} ${e.name} asked to be paid by ${text}`,
      },
      tx,
    );
    await sendInApp(tx, ctx.company.id, await hrManagers(ctx.company.id, ctx.user.id, tx), {
      subject: "Pay details change to approve",
      body: `${e.name} (${e.code}) asked to be paid by ${text}.${input.note ? ` "${input.note}"` : ""}`,
      entityType: "Employee",
      entityId: e.id,
    });
    return request.id;
  }, TX_OPTIONS);
  return presentRequest(
    await ctx.db.payDetailsRequest.findUniqueOrThrow({ where: { id }, include: requestInclude }),
    ctx.company.timezone,
  );
}

/** The employee takes back a change still waiting for HR. */
export async function withdrawMyPayRequest(
  ctx: CompanyContext,
  requestId: string,
  meta?: RequestMeta,
) {
  const linked = await requireLinkedEmployee(ctx);
  await prisma.$transaction(async (tx) => {
    await lockRow(tx, "Employee", linked.id);
    const request = await tx.payDetailsRequest.findFirst({
      where: { id: requestId, companyId: ctx.company.id, employeeId: linked.id },
    });
    if (!request) throw new AppError("NOT_FOUND", "Pay detail change not found.");
    if (request.status !== "PENDING") {
      throw new AppError("CONFLICT", "HR already decided on this change.");
    }
    await tx.payDetailsRequest.update({
      where: { id: request.id },
      data: { status: "WITHDRAWN", decidedAt: new Date() },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "Employee",
        entityId: linked.id,
        summary: `${linked.code} ${linked.name} withdrew their pay details change`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return { id: requestId, status: "WITHDRAWN" as const };
}

/** The employee adds a paper (NID scan, photo, certificate) to their own vault. */
export async function addMyDocument(
  ctx: CompanyContext,
  raw: unknown,
  upload: { fileName: string; bytes: Buffer },
  meta?: RequestMeta,
) {
  const linked = await requireLinkedEmployee(ctx);
  const input = employeeDocumentSchema.parse(raw);
  if (!SELF_DOCUMENT_KINDS.includes(input.kind)) {
    throw new AppError("FORBIDDEN", "HR adds appointment letters and contracts.", {
      kind: ["HR adds appointment letters and contracts."],
    });
  }
  return addDocument(ctx, linked.id, input.kind, input.title || null, upload, meta, linked.name);
}

/** The employee removes a paper they added themselves. */
export async function removeMyDocument(
  ctx: CompanyContext,
  documentId: string,
  meta?: RequestMeta,
) {
  const linked = await requireLinkedEmployee(ctx);
  return removeDocument(
    ctx,
    documentId,
    (d) => d.employeeId === linked.id && d.addedById === ctx.user.id,
    meta,
  );
}
