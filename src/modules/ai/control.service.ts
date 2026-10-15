import type { AiCellState, AiGrant, AiGrantScope } from "@prisma/client";
import { z } from "zod";

import { addDays, DATE_ONLY, localDay, nextDay, startOfDayInZone } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { runTransaction } from "@/lib/transaction";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";

import {
  ACTION_KEYS,
  AI_TREE,
  type AiNode,
  CELL_LABELS,
  type CellRows,
  type CellState,
  grantOpens,
  isAiBranch,
  isLocked,
  isNode,
  mostFor,
  type NodeRef,
  nodeAt,
  pathText,
  PRESETS,
  presetRows,
  readCell,
  refOf,
  setCell,
} from "./control-tree";
import { BOOKS, testsMissingFor } from "./knowledge";
import { aiSettingsOf, offReason, OFF_TEXT } from "./settings.service";

/*
 * Control (AI Center > Control): the Do / Ask / Off cells the owner sets, the
 * presets, and the grants that open a cell for a while. `aiMay` is the one
 * question every AI step asks before it acts: with AI off or paused the
 * answer is Off whatever the cells say.
 */

async function cellRows(companyId: string, db: Db = prisma): Promise<Map<NodeRef, CellState>> {
  const rows = await db.aiControlCell.findMany({
    where: { companyId },
    select: { node: true, state: true },
  });
  return new Map(
    rows.filter((r) => isNode(r.node)).map((r) => [r.node as NodeRef, r.state as CellState]),
  );
}

/** Grants still running now (not used up, ended or out of time). */
async function liveGrants(companyId: string, now = new Date(), db: Db = prisma) {
  return db.aiGrant.findMany({
    where: {
      companyId,
      usedAt: null,
      endedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: "asc" },
  });
}

const grantReading = (g: AiGrant) => ({
  ref: g.node as NodeRef,
  record: g.recordType && g.recordId ? { type: g.recordType, id: g.recordId } : null,
});

export type AiRecord = { type: string; id: string; label?: string };

export type AiMay = {
  state: CellState;
  /** Why, in a line the owner reads ("Accounts open today", "AI is switched off"). */
  why: string;
  /** The grant that opened it (a one-task grant is used up by `useGrant`). */
  grantId: string | null;
};

/**
 * May the AI do this action now (on this record)? Do: it does it itself; Ask:
 * it asks the owner first; Off: it asks for permission. Off while AI is
 * switched off or paused, or for anything that is not a cell (deleting, roles,
 * backups). Do becomes Ask while Mehedi 2.0 has not passed the tests of the
 * books the action needs (knowledge.ts).
 */
export async function aiMay(
  companyId: string,
  key: string,
  record?: AiRecord,
  db: Db = prisma,
): Promise<AiMay> {
  const may = await cellMay(companyId, key, record, db);
  if (may.state !== "DO") return may;
  const missing = await testsMissingFor(companyId, key, new Date(), db);
  if (missing.length === 0) return may;
  return {
    state: "ASK",
    why: `Do waits for the ${missing.map((b) => BOOKS[b].title.split(" · ")[0]).join(", ")} test${
      missing.length > 1 ? "s" : ""
    }: until he passes, he asks you first`,
    grantId: null,
  };
}

/** What the cells and grants say, before the tests. */
async function cellMay(
  companyId: string,
  key: string,
  record: AiRecord | undefined,
  db: Db,
): Promise<AiMay> {
  const settings = await aiSettingsOf(companyId, db);
  const off = offReason(settings);
  if (off && off !== "no-key") return { state: "OFF", why: OFF_TEXT[off], grantId: null };
  if (!ACTION_KEYS.includes(key)) {
    return { state: "OFF", why: "This is not something the AI may ever do.", grantId: null };
  }
  const ref: NodeRef = `k:${key}`;
  const reading = readCell(await cellRows(companyId, db), ref);
  if (reading.state !== "DO") {
    const grant = (await liveGrants(companyId, new Date(), db)).find((g) =>
      grantOpens(grantReading(g), key, record),
    );
    if (grant) {
      return {
        // What goes to a buyer still waits for the owner's OK.
        state: mostFor(key),
        why: grant.note ?? "Opened for a while by the owner",
        grantId: grant.id,
      };
    }
  }
  const why =
    reading.from === "cell"
      ? `${pathText(ref)} is set to ${CELL_LABELS[reading.state]}`
      : reading.heldAtAsk
        ? `${pathText(ref)} asks you first even when its area is Do`
        : reading.from === "area"
          ? `${pathText(ref)} follows its area: ${CELL_LABELS[reading.state]}`
          : `${pathText(ref)} asks you first (every cell starts at Ask)`;
  return { state: reading.state, why, grantId: null };
}

/** Marks a one-task grant used once the AI has done the task. */
export async function useGrant(grantId: string | null, db: Db = prisma) {
  if (!grantId) return;
  await db.aiGrant.updateMany({
    where: { id: grantId, scope: "ONCE", usedAt: null },
    data: { usedAt: new Date() },
  });
}

function assertManage(ctx: CompanyContext) {
  if (!ctx.can("ai.manage")) {
    throw new AppError("FORBIDDEN", "Only the owner changes what the AI may do.");
  }
}

type ScreenNode = {
  ref: NodeRef;
  label: string;
  state: CellState;
  /** Set on its own, differently from the area above it (shown in another colour). */
  exception: boolean;
  /** Stays Ask when its area is Do. */
  locked: boolean;
  heldAtAsk: boolean;
  /** Opened to Do by a grant now running. */
  granted: boolean;
  /** The most it can be set to: Ask for what goes to a buyer. */
  most: CellState;
  children?: ScreenNode[];
};

/** Control as the screen shows it: the tree with each cell's state, the grants and presets. */
export async function getControl(ctx: CompanyContext) {
  const [rows, grants, settings] = await Promise.all([
    cellRows(ctx.company.id),
    liveGrants(ctx.company.id),
    aiSettingsOf(ctx.company.id),
  ]);
  const grantedKeys = new Set(
    ACTION_KEYS.filter((k) => grants.some((g) => grantOpens(grantReading(g), k))),
  );

  const build = (node: AiNode, parent: CellState | null): ScreenNode => {
    const ref = refOf(node);
    const reading = readCell(rows, ref);
    const shown: ScreenNode = {
      ref,
      label: node.label,
      state: reading.state,
      exception: reading.from === "cell" && parent !== null && parent !== reading.state,
      locked: !isAiBranch(node) && isLocked(node.key),
      heldAtAsk: reading.heldAtAsk,
      granted: !isAiBranch(node) && grantedKeys.has(node.key),
      most: isAiBranch(node) ? "DO" : mostFor(node.key),
    };
    if (isAiBranch(node)) shown.children = node.children.map((c) => build(c, reading.state));
    return shown;
  };

  const users = await prisma.user.findMany({
    where: { id: { in: grants.map((g) => g.grantedById).filter((id): id is string => !!id) } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return {
    enabled: settings.enabled,
    paused: settings.pausedAt !== null,
    tree: build(AI_TREE, null),
    grants: grants.map((g) => ({
      id: g.id,
      path: isNode(g.node) ? pathText(g.node as NodeRef) : g.node,
      scope: g.scope,
      record: g.recordLabel,
      expiresAt: g.expiresAt,
      note: g.note,
      by: g.grantedById ? (nameOf.get(g.grantedById) ?? null) : null,
    })),
    presets: PRESETS,
    can: { manage: ctx.can("ai.manage") },
  };
}

export type AiControl = Awaited<ReturnType<typeof getControl>>;
export type AiControlNode = ScreenNode;

export const cellSchema = z.object({
  node: z.string().refine(isNode, "Pick a cell of Control"),
  state: z.enum(["DO", "ASK", "OFF"]),
});

async function saveRows(
  ctx: CompanyContext,
  before: CellRows,
  after: ReadonlyMap<NodeRef, CellState>,
  db: Db,
) {
  const gone = [...before.keys()].filter((r) => !after.has(r));
  if (gone.length > 0) {
    await db.aiControlCell.deleteMany({ where: { companyId: ctx.company.id, node: { in: gone } } });
  }
  for (const [node, state] of after) {
    if (before.get(node) === state) continue;
    await db.aiControlCell.upsert({
      where: { companyId_node: { companyId: ctx.company.id, node } },
      create: {
        companyId: ctx.company.id,
        node,
        state: state as AiCellState,
        updatedById: ctx.user.id,
      },
      update: { state: state as AiCellState, updatedById: ctx.user.id },
    });
  }
}

/** Sets a cell to Do, Ask or Off; everything under an area follows it. */
export async function setControlCell(ctx: CompanyContext, input: unknown, meta?: RequestMeta) {
  assertManage(ctx);
  const { node, state } = cellSchema.parse(input);
  const ref = node as NodeRef;
  if (state === "DO" && ref.startsWith("k:") && mostFor(ref.slice(2)) === "ASK") {
    throw new AppError(
      "VALIDATION",
      "What goes to a buyer always waits for your OK: it can be Ask or Off, never Do.",
    );
  }
  await runTransaction(async (tx) => {
    const before = await cellRows(ctx.company.id, tx);
    await saveRows(ctx, before, setCell(before, ref, state), tx);
    const target = nodeAt(ref);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "PERMISSION_CHANGE",
        entityType: "AiControl",
        entityId: ctx.company.id,
        summary: `AI Control: ${pathText(ref) || target.label} set to ${CELL_LABELS[state]}${
          isAiBranch(target) ? " (everything in it follows)" : ""
        }`,
      },
      tx,
    );
  });
}

/** The end of today (the company's day) as an instant. */
function endOfToday(timeZone: string, now = new Date()) {
  return startOfDayInZone(nextDay(localDay(now, timeZone)), timeZone);
}

/** Applies a preset; "Accounts open today" opens Accounts until the end of today. */
export async function applyPreset(ctx: CompanyContext, preset: string, meta?: RequestMeta) {
  assertManage(ctx);
  const found = PRESETS.find((p) => p.id === preset);
  if (!found) throw new AppError("VALIDATION", "Pick one of the presets.");
  await runTransaction(async (tx) => {
    if (found.id === "accounts-today") {
      await tx.aiGrant.create({
        data: {
          companyId: ctx.company.id,
          node: "b:accounts",
          scope: "TODAY",
          expiresAt: endOfToday(ctx.company.timezone),
          grantedById: ctx.user.id,
          note: "Accounts open today",
        },
      });
    } else {
      const before = await cellRows(ctx.company.id, tx);
      await saveRows(ctx, before, presetRows(before, found.id), tx);
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "PERMISSION_CHANGE",
        entityType: "AiControl",
        entityId: ctx.company.id,
        summary: `AI Control preset: ${found.label}`,
      },
      tx,
    );
  });
}

export const grantSchema = z
  .object({
    node: z.string().refine(isNode, "Pick a cell of Control"),
    scope: z.enum(["TODAY", "UNTIL", "RECORD"]),
    /** UNTIL: the last day it is open (YYYY-MM-DD). */
    until: z.string().regex(DATE_ONLY).optional(),
    record: z
      .object({
        type: z.string().min(1).max(60),
        id: z.string().min(1).max(60),
        label: z.string().max(200).optional(),
      })
      .optional(),
  })
  .refine((g) => g.scope !== "UNTIL" || Boolean(g.until), {
    message: "Pick the last day",
    path: ["until"],
  })
  .refine((g) => g.scope !== "RECORD" || Boolean(g.record), {
    message: "Pick the order",
    path: ["record"],
  });

/** Opens a cell (or an area) to Do for today, until a date, or for one record. */
export async function giveGrant(
  ctx: CompanyContext,
  input: unknown,
  meta?: RequestMeta,
  requestId?: string,
  db: Db = prisma,
) {
  assertManage(ctx);
  const g = grantSchema.parse(input);
  const today = localDay(new Date(), ctx.company.timezone);
  if (g.scope === "UNTIL" && g.until! < today) {
    throw new AppError("VALIDATION", "Pick today or a later day.", {
      until: ["Pick today or a later day"],
    });
  }
  return grantRow(ctx, { ...g, scope: g.scope }, meta, requestId, db);
}

async function grantRow(
  ctx: CompanyContext,
  g: {
    node: string;
    scope: AiGrantScope;
    until?: string;
    record?: { type: string; id: string; label?: string };
  },
  meta: RequestMeta | undefined,
  requestId: string | undefined,
  db: Db,
) {
  const ref = g.node as NodeRef;
  const tz = ctx.company.timezone;
  const expiresAt =
    g.scope === "TODAY"
      ? endOfToday(tz)
      : g.scope === "UNTIL"
        ? startOfDayInZone(nextDay(g.until!), tz)
        : g.scope === "ONCE"
          ? // A one-task grant that is never used runs out after a day.
            startOfDayInZone(addDays(localDay(new Date(), tz), 2), tz)
          : null;
  const scopeText =
    g.scope === "TODAY"
      ? "for today"
      : g.scope === "UNTIL"
        ? `until ${g.until}`
        : g.scope === "ONCE"
          ? "for one task"
          : `for ${g.record?.label ?? "one record"}`;
  const grant = await db.aiGrant.create({
    data: {
      companyId: ctx.company.id,
      node: ref,
      scope: g.scope,
      recordType: g.record?.type ?? null,
      recordId: g.record?.id ?? null,
      recordLabel: g.record?.label ?? null,
      expiresAt,
      grantedById: ctx.user.id,
      requestId: requestId ?? null,
      note: `${pathText(ref)} opened ${scopeText}`,
    },
  });
  await auditInCompany(
    ctx,
    meta,
    {
      action: "PERMISSION_CHANGE",
      entityType: "AiControl",
      entityId: ctx.company.id,
      summary: `AI Control: ${pathText(ref)} opened ${scopeText}`,
    },
    db,
  );
  return grant;
}

/** A one-task grant (a permission request answered "Only this task"). */
export async function giveOneTaskGrant(
  ctx: CompanyContext,
  node: string,
  record: AiRecord | undefined,
  requestId: string,
  meta: RequestMeta | undefined,
  db: Db,
) {
  return grantRow(ctx, { node, scope: "ONCE", record }, meta, requestId, db);
}

/** A grant for today (a permission request answered "For today"). */
export async function giveTodayGrant(
  ctx: CompanyContext,
  node: string,
  requestId: string,
  meta: RequestMeta | undefined,
  db: Db,
) {
  return grantRow(ctx, { node, scope: "TODAY" }, meta, requestId, db);
}

/** Ends a grant early: the cell is back to its own setting at once. */
export async function endGrant(ctx: CompanyContext, grantId: string, meta?: RequestMeta) {
  assertManage(ctx);
  const grant = await ctx.db.aiGrant.findFirst({ where: { id: grantId } });
  if (!grant) throw new AppError("NOT_FOUND", "This grant is not there any more.");
  if (grant.endedAt || grant.usedAt) return;
  await prisma.aiGrant.update({ where: { id: grantId }, data: { endedAt: new Date() } });
  await auditInCompany(ctx, meta, {
    action: "PERMISSION_CHANGE",
    entityType: "AiControl",
    entityId: ctx.company.id,
    summary: `AI Control: ended "${grant.note ?? grant.node}" early`,
  });
}
