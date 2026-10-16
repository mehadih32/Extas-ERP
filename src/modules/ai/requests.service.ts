import type { AiChannel, Prisma } from "@prisma/client";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { runTransaction } from "@/lib/transaction";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";

import type { PermissionKey } from "@/modules/rbac/permissions";

import { auditAsAi } from "./account";
import { isLocked, isNode, mostFor, type NodeRef, nodeAt, pathText } from "./control-tree";
import { type AiRecord, giveOneTaskGrant, giveTodayGrant } from "./control.service";
import { pushToBot } from "./bot/push";
import { aiLabel, aiSettingsOf, type PinProof, requirePin } from "./settings.service";

/*
 * What the AI asks the owner for. A permission request: a cell it needs is Off
 * ("To work out costing I need Production > Work out costing. Will you give
 * it?"), answered Only this task, For today, Always or No. A Deletion request:
 * the AI never deletes; it says what, why and what happens if it stays, and the
 * owner decides: approving runs the ERP's own delete (cancel) in the owner's
 * name, with its normal checks. The PIN must be set, and is asked for money,
 * prices and deletions. Each request is written to the log, marked AI.
 */

export const ANSWERS = [
  { value: "ONCE", label: "Only this task" },
  { value: "TODAY", label: "For today" },
  { value: "ALWAYS", label: "Always" },
  { value: "REFUSED", label: "No" },
] as const;

/** The AI asks for a cell that is Off (made by the AI's own steps, never by a person). */
export async function askPermission(
  companyId: string,
  input: {
    key: string;
    task: string;
    why?: string;
    record?: AiRecord;
    channel?: AiChannel;
  },
) {
  const node: NodeRef = `k:${input.key}`;
  if (!isNode(node)) {
    throw new AppError("VALIDATION", "The AI cannot ask for this: it is not a cell of Control.");
  }
  const settings = await aiSettingsOf(companyId);
  // The same open question is asked once.
  const open = await prisma.aiPermissionRequest.findFirst({
    where: {
      companyId,
      node,
      status: "PENDING",
      recordId: input.record?.id ?? null,
    },
  });
  if (open) return open;
  const request = await prisma.aiPermissionRequest.create({
    data: {
      companyId,
      node,
      task: input.task.slice(0, 500),
      why: input.why?.slice(0, 1000) ?? null,
      recordType: input.record?.type ?? null,
      recordId: input.record?.id ?? null,
      recordLabel: input.record?.label ?? null,
      channel: input.channel ?? "ERP",
      askedBy: aiLabel(settings),
    },
  });
  await auditAsAi(companyId, {
    action: "CREATE",
    entityType: "AiPermissionRequest",
    entityId: request.id,
    summary: `Asked the owner for permission: ${pathText(node)} (${request.task.slice(0, 120)})`,
  });
  // The owner hears of it on the bot too, with the answer buttons.
  await pushToBot(companyId, { kind: "permission", requestId: request.id });
  return request;
}

/** The AI asks the owner to delete a record (it never deletes anything itself). */
export async function askDeletion(
  companyId: string,
  input: {
    what: string;
    recordType: string;
    recordId: string;
    href?: string;
    why: string;
    ifKept: string;
    channel?: AiChannel;
  },
) {
  const settings = await aiSettingsOf(companyId);
  const open = await prisma.aiDeletionRequest.findFirst({
    where: { companyId, recordType: input.recordType, recordId: input.recordId, status: "PENDING" },
  });
  if (open) return open;
  const request = await prisma.aiDeletionRequest.create({
    data: {
      companyId,
      what: input.what.slice(0, 200),
      recordType: input.recordType,
      recordId: input.recordId,
      href: input.href ?? null,
      why: input.why.slice(0, 1000),
      ifKept: input.ifKept.slice(0, 1000),
      channel: input.channel ?? "ERP",
      askedBy: aiLabel(settings),
    },
  });
  await auditAsAi(companyId, {
    action: "CREATE",
    entityType: "AiDeletionRequest",
    entityId: request.id,
    summary: `Sent the owner a Deletion request: ${request.what}`,
  });
  await pushToBot(companyId, { kind: "deletion", requestId: request.id });
  return request;
}

function assertManage(ctx: CompanyContext) {
  if (!ctx.can("ai.manage")) {
    throw new AppError("FORBIDDEN", "Only the owner answers the AI's requests.");
  }
}

/** A cell that needs the PIN: money, prices and anything that leaves the company. */
export const needsPin = (node: string) => node.startsWith("k:") && isLocked(node.slice(2));

export const answerSchema = z.object({
  answer: z.enum(["ONCE", "TODAY", "ALWAYS", "REFUSED"]),
  note: z.string().trim().max(500).optional(),
  pin: z.string().optional(),
});

/** Answers a permission request: a grant, the cell set to Do, or No. */
export async function answerPermission(
  ctx: CompanyContext,
  requestId: string,
  input: unknown,
  meta?: RequestMeta,
  checked?: PinProof,
) {
  assertManage(ctx);
  const { answer, note, pin } = answerSchema.parse(input);
  const request = await ctx.db.aiPermissionRequest.findFirst({ where: { id: requestId } });
  if (!request) throw new AppError("NOT_FOUND", "This request is not there any more.");
  if (request.status !== "PENDING") {
    throw new AppError("CONFLICT", "This request was answered already.");
  }
  if (answer !== "REFUSED" && needsPin(request.node)) {
    await requirePin(ctx, checked ?? pin, "give this permission (money or prices)");
  }
  const path = isNode(request.node) ? pathText(request.node as NodeRef) : request.node;
  const record: AiRecord | undefined =
    request.recordType && request.recordId
      ? { type: request.recordType, id: request.recordId, label: request.recordLabel ?? undefined }
      : undefined;

  await runTransaction(async (tx) => {
    const claimed = await tx.aiPermissionRequest.updateMany({
      where: { id: requestId, status: "PENDING" },
      data: {
        status: answer,
        answeredById: ctx.user.id,
        answeredAt: new Date(),
        note: note ?? null,
      },
    });
    if (claimed.count === 0) throw new AppError("CONFLICT", "This request was answered already.");
    if (answer === "ONCE") {
      await giveOneTaskGrant(ctx, request.node, record, requestId, meta, tx);
    } else if (answer === "TODAY") {
      await giveTodayGrant(ctx, request.node, requestId, meta, tx);
    } else if (answer === "ALWAYS") {
      // Always: the cell is set to Do (Ask for what goes to a buyer, which waits for the owner).
      const state = mostFor(request.node.slice(2));
      await tx.aiControlCell.upsert({
        where: { companyId_node: { companyId: ctx.company.id, node: request.node } },
        create: { companyId: ctx.company.id, node: request.node, state, updatedById: ctx.user.id },
        update: { state, updatedById: ctx.user.id },
      });
    }
    const label = { ONCE: "only this task", TODAY: "for today", ALWAYS: "always", REFUSED: "no" };
    await auditInCompany(
      ctx,
      meta,
      {
        action: "PERMISSION_CHANGE",
        entityType: "AiPermissionRequest",
        entityId: requestId,
        summary: `Answered the AI's request for ${path}: ${label[answer]}${note ? ` (${note})` : ""}`,
      },
      tx,
    );
  });
}

/** The kinds of record a Deletion request can be for, and the ERP's own delete for each. */
const DELETES: Record<
  string,
  { what: string; permissions: PermissionKey[]; run: DeleteRun } | undefined
> = {
  SalesOrder: {
    what: "an order",
    permissions: ["sales.order.create"],
    run: async (ctx, id, reason, meta) => {
      const { cancelOrder } = await import("@/modules/sales/order.service");
      await cancelOrder(ctx, id, { reason }, meta);
    },
  },
  PurchaseOrder: {
    what: "a booking or a material order",
    permissions: [],
    run: async (ctx, id, reason, meta) => {
      const booking = await ctx.db.booking.findFirst({
        where: { orderId: id },
        select: { id: true },
      });
      if (booking) {
        assertMay(ctx, ["production.bookings.close"]);
        const { cancelBooking } = await import("@/modules/production/booking.service");
        await cancelBooking(ctx, booking.id, { reason }, meta);
      } else {
        assertMay(ctx, ["materials.purchase"]);
        const { cancelPurchaseOrder } = await import("@/modules/materials/purchase-order.service");
        await cancelPurchaseOrder(ctx, id, { reason }, meta);
      }
    },
  },
  Party: {
    what: "a buyer or a supplier",
    permissions: ["parties.manage"],
    run: async (ctx, id, reason, meta) => {
      // A party is never removed: its account is closed (settling while money is still due).
      const { changePartyStatus } = await import("@/modules/parties/party.service");
      await changePartyStatus(ctx, id, { status: "CLOSED", reason }, meta);
    },
  },
  ProductionProject: {
    what: "a production order",
    permissions: ["production.manage"],
    run: async (ctx, id, reason, meta) => {
      const { cancelProject } = await import("@/modules/production/project.service");
      await cancelProject(ctx, id, { reason }, meta);
    },
  },
};

type DeleteRun = (
  ctx: CompanyContext,
  recordId: string,
  reason: string,
  meta: RequestMeta | undefined,
) => Promise<void>;

/** The person's own permission for the delete, as on the record's page. */
function assertMay(ctx: CompanyContext, permissions: PermissionKey[]) {
  if (permissions.length > 0 && !permissions.some((p) => ctx.can(p))) {
    throw new AppError(
      "FORBIDDEN",
      "You do not have the permission to delete this on its own page, so it is not deleted.",
    );
  }
}

/** Whether a Deletion request can be asked for this kind of record (the ERP deletes it). */
export const canBeDeleted = (recordType: string) => DELETES[recordType] !== undefined;

export const deletionAnswerSchema = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(500).optional(),
  pin: z.string().optional(),
});

/**
 * Answers a Deletion request. Approving it (with the PIN) claims the request
 * first, then runs the ERP's own delete for the record (a cancel, as on its
 * page) in the owner's name, with the page's normal checks, so it runs only
 * once: when the checks say no, nothing is deleted and the request waits again
 * with the reason. The AI itself never deletes.
 */
export async function answerDeletion(
  ctx: CompanyContext,
  requestId: string,
  input: unknown,
  meta?: RequestMeta,
  checked?: PinProof,
) {
  assertManage(ctx);
  const { approve, note, pin } = deletionAnswerSchema.parse(input);
  if (approve) await requirePin(ctx, checked ?? pin, "approve the Deletion request");
  const request = await ctx.db.aiDeletionRequest.findFirst({ where: { id: requestId } });
  if (!request) throw new AppError("NOT_FOUND", "This request is not there any more.");
  if (request.status !== "PENDING") {
    throw new AppError("CONFLICT", "This request was answered already.");
  }
  const remove = approve ? DELETES[request.recordType] : undefined;
  if (approve) {
    if (!remove) {
      throw new AppError(
        "CONFLICT",
        `The ERP has no delete for this kind of record (${request.recordType}). Refuse the request, or change the record on its page.`,
      );
    }
    assertMay(ctx, remove.permissions);
  }
  // Claimed first, so the delete runs once even when it is approved twice at once.
  const now = new Date();
  const claimed = await prisma.aiDeletionRequest.updateMany({
    where: { id: requestId, companyId: ctx.company.id, status: "PENDING" },
    data: {
      status: approve ? "APPROVED" : "REJECTED",
      answeredById: ctx.user.id,
      answeredAt: now,
      doneAt: approve ? now : null,
      note: note ?? null,
    },
  });
  if (claimed.count === 0) throw new AppError("CONFLICT", "This request was answered already.");
  if (remove) {
    const reason = `Deletion request approved: ${request.why}`.slice(0, 500);
    try {
      await remove.run(ctx, request.recordId, reason, meta);
    } catch (error) {
      // The record's own checks said no: nothing was deleted, and the request
      // waits again, with why.
      const why = `Not deleted: ${error instanceof AppError ? error.message : "the ERP could not delete it."}`;
      await prisma.aiDeletionRequest.updateMany({
        where: { id: requestId, status: "APPROVED", answeredAt: now },
        data: {
          status: "PENDING",
          answeredById: null,
          answeredAt: null,
          doneAt: null,
          note: why.slice(0, 500),
        },
      });
      if (error instanceof AppError) throw new AppError(error.code, why, error.details);
      throw error;
    }
  }
  await auditInCompany(ctx, meta, {
    action: "STATUS_CHANGE",
    entityType: "AiDeletionRequest",
    entityId: requestId,
    summary: approve
      ? `Approved the AI's Deletion request and deleted ${request.what}`
      : `Refused the AI's Deletion request: ${request.what}`,
  });
}

/** What waits for the owner: open permission and Deletion requests, newest first. */
export async function getRequests(ctx: CompanyContext, history = false) {
  const where: Prisma.AiPermissionRequestWhereInput = history ? {} : { status: "PENDING" };
  const [permissions, deletions] = await Promise.all([
    ctx.db.aiPermissionRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { answeredBy: { select: { name: true } } },
    }),
    ctx.db.aiDeletionRequest.findMany({
      where: history ? {} : { status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { answeredBy: { select: { name: true } } },
    }),
  ]);
  return {
    permissions: permissions.map((r) => ({
      id: r.id,
      path: isNode(r.node) ? pathText(r.node as NodeRef) : r.node,
      action: isNode(r.node) ? nodeAt(r.node as NodeRef).label : r.node,
      task: r.task,
      why: r.why,
      record: r.recordLabel,
      askedBy: r.askedBy,
      channel: r.channel,
      status: r.status,
      note: r.note,
      needsPin: needsPin(r.node),
      answeredBy: r.answeredBy?.name ?? null,
      answeredAt: r.answeredAt,
      createdAt: r.createdAt,
    })),
    deletions: deletions.map((r) => ({
      id: r.id,
      what: r.what,
      href: r.href,
      why: r.why,
      ifKept: r.ifKept,
      askedBy: r.askedBy,
      channel: r.channel,
      status: r.status,
      note: r.note,
      answeredBy: r.answeredBy?.name ?? null,
      answeredAt: r.answeredAt,
      createdAt: r.createdAt,
    })),
    can: { answer: ctx.can("ai.manage") },
  };
}

export type AiRequests = Awaited<ReturnType<typeof getRequests>>;
