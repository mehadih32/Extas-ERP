import { Prisma } from "@prisma/client";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { recordHref } from "@/modules/reminders/links";

import { agentCells, agentKeyOf, agentTasks, aiAgents } from "./agents";
import { pathText } from "./control-tree";
import { aiMay, getControl, type AiControlNode } from "./control.service";
import { BOOK_CODES, BOOKS, STATE_TEXT, testStanding } from "./knowledge";
import { MODEL_TEST_TEXT, modelTestRuns, standingOf } from "./model-test-standing";
import { taskInfo } from "./models";
import { isProvider, modelLabel, parseModel, providerInfo, providerOf } from "./providers";
import {
  agentModelsOf,
  aiSettingsOf,
  modelForWork,
  offReason,
  OFF_TEXT,
  readModelsOf,
} from "./settings.service";
import { SKILL_STANDING_TEXT, standingOf as skillStanding } from "./skills";
import { periodStarts } from "./usage.service";

/*
 * AI Center > Agents: Mehedi 2.0 at the top and every agent under him (the
 * tech pack experts, the orchestrator, the review board and the Help AI). For
 * each: what it does, its model and provider, on or off, its Control cells,
 * its skills and books, its test results, today's and this month's cost and
 * its last runs. Read with ai.view; the owner (ai.manage) switches an agent
 * on or off (Mehedi 2.0 himself follows the main switch on AI Home).
 */

function assertView(ctx: CompanyContext) {
  if (!ctx.can("ai.view") && !ctx.can("ai.manage")) {
    throw new AppError("FORBIDDEN", "You do not have permission to see the AI Center.");
  }
}

const ZERO = new Prisma.Decimal(0);

/** How many cells are Do, Ask and Off (leaves only). */
function countCells(nodes: readonly AiControlNode[], into = { DO: 0, ASK: 0, OFF: 0 }) {
  for (const node of nodes) {
    if (node.children?.length) countCells(node.children, into);
    else into[node.state] += 1;
  }
  return into;
}

/** The newest lines read for the agents' last runs. */
const RECENT_LINES = 400;
const LAST_RUNS = 5;

export async function getAgents(ctx: CompanyContext) {
  assertView(ctx);
  const companyId = ctx.company.id;
  const settings = await aiSettingsOf(companyId);
  const agents = aiAgents(settings.assistantName);
  const now = new Date();
  const { dayStart, monthStart } = periodStarts(now, ctx.company.timezone);
  const [control, books, runs, skills, month, today, recent] = await Promise.all([
    getControl(ctx),
    testStanding(companyId, now),
    modelTestRuns(companyId),
    ctx.db.aiSkill.findMany({
      orderBy: { createdAt: "asc" },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    }),
    ctx.db.aiUsage.groupBy({
      by: ["agent"],
      where: { createdAt: { gte: monthStart } },
      _sum: { cost: true },
      _count: true,
    }),
    ctx.db.aiUsage.groupBy({
      by: ["agent"],
      where: { createdAt: { gte: dayStart } },
      _sum: { cost: true },
      _count: true,
    }),
    ctx.db.aiUsage.findMany({
      orderBy: { createdAt: "desc" },
      take: RECENT_LINES,
      select: {
        id: true,
        agent: true,
        task: true,
        why: true,
        model: true,
        cost: true,
        costKnown: true,
        result: true,
        recordType: true,
        recordId: true,
        recordLabel: true,
        createdAt: true,
      },
    }),
  ]);
  const read = readModelsOf(settings);
  const nameOf = (ref: string) => {
    const provider = parseModel(ref)?.provider;
    return modelLabel(ref, provider ? read[provider]?.models : undefined);
  };
  const keyOf = (agent: string) => agentKeyOf(agent, settings.assistantName);
  const sum = (rows: typeof month, key: string) => {
    const mine = rows.filter((r) => keyOf(r.agent) === key);
    return {
      cost: mine.reduce((t, r) => t.plus(r._sum.cost ?? ZERO), ZERO).toFixed(2),
      calls: mine.reduce((t, r) => t + r._count, 0),
    };
  };
  const off = offReason(settings);
  const own = agentModelsOf(settings);
  const cells = await Promise.all(
    agents.map(async (a) =>
      Promise.all(
        agentCells(a.key).map(async (key) => {
          const may = await aiMay(companyId, key);
          return { key, label: pathText(`k:${key}`), state: may.state, why: may.why };
        }),
      ),
    ),
  );

  return {
    currency: ctx.company.currency,
    aiState: off ?? ("on" as const),
    aiText: off ? OFF_TEXT[off] : null,
    agents: agents.map((a, i) => {
      const ownModel = own[a.key] ?? null;
      const tasks = agentTasks(a.key);
      // The model it works on: its own, else its main work's.
      const model = ownModel ?? modelForWork(settings, tasks[0] ?? "chat", a.name);
      const provider = providerOf(model);
      const mine = skills.filter((s) => s.agent === a.key);
      return {
        key: a.key,
        name: a.name,
        what: a.what,
        head: a.key === "mehedi",
        model: {
          ref: model,
          label: nameOf(model),
          provider: isProvider(provider) ? providerInfo(provider).label : provider,
          own: ownModel !== null,
          // Mehedi 2.0 works on each task's own model unless he has one of his own.
          each: ownModel === null && a.key === "mehedi",
        },
        on: a.key === "mehedi" ? off === null : off === null && !settings.agentsOff.includes(a.key),
        switchedOff: a.key !== "mehedi" && settings.agentsOff.includes(a.key),
        cells:
          a.key === "mehedi"
            ? { every: countCells([control.tree]), list: [] }
            : { every: null, list: cells[i]! },
        skills: mine.flatMap((s) => {
          const v = s.versions[0];
          if (!v) return [];
          const standing = skillStanding(v);
          return [
            {
              id: s.id,
              name: v.name,
              version: v.version,
              on: s.on,
              standing,
              text: v.testStatus === "RUNNING" ? "Testing now" : SKILL_STANDING_TEXT[standing],
            },
          ];
        }),
        books:
          a.key === "mehedi"
            ? BOOK_CODES.map((code) => ({
                code,
                title: BOOKS[code].title,
                state: books[code].state,
                text: STATE_TEXT[books[code].state],
              }))
            : [],
        modelTest: ownModel
          ? (() => {
              const standing = standingOf(runs, tasks[0] ?? "chat", ownModel);
              return { state: standing.state, text: MODEL_TEST_TEXT[standing.state] };
            })()
          : null,
        today: sum(today, a.key),
        month: sum(month, a.key),
        last: recent
          .filter((l) => keyOf(l.agent) === a.key)
          .slice(0, LAST_RUNS)
          .map((l) => ({
            id: l.id,
            at: l.createdAt,
            task: taskInfo(l.task)?.label ?? l.task,
            why: l.why,
            model: nameOf(l.model),
            cost: l.costKnown ? l.cost.toFixed(2) : null,
            result: l.result,
            record: l.recordLabel,
            href: recordHref(ctx, l.recordType ? { type: l.recordType, id: l.recordId } : null),
          })),
      };
    }),
    can: { manage: ctx.can("ai.manage") },
  };
}

export type AiAgentsScreen = Awaited<ReturnType<typeof getAgents>>;

export const agentSwitchSchema = z.object({ agent: z.string().max(40), on: z.boolean() });

/** Switches an agent on or off (not Mehedi 2.0: he follows the main switch). */
export async function setAgentOn(ctx: CompanyContext, input: unknown, meta?: RequestMeta) {
  if (!ctx.can("ai.manage")) {
    throw new AppError("FORBIDDEN", "Only the owner switches the AI's agents on or off.");
  }
  const { agent, on } = agentSwitchSchema.parse(input);
  const settings = await aiSettingsOf(ctx.company.id);
  const found = aiAgents(settings.assistantName).find((a) => a.key === agent);
  if (!found) throw new AppError("NOT_FOUND", "There is no such agent.");
  if (agent === "mehedi") {
    throw new AppError(
      "VALIDATION",
      `${settings.assistantName} follows the main switch: turn AI on or off, or pause it, on AI Home.`,
    );
  }
  const agentsOff = on
    ? settings.agentsOff.filter((k) => k !== agent)
    : [...new Set([...settings.agentsOff, agent])];
  await prisma.aiSettings.upsert({
    where: { companyId: ctx.company.id },
    create: { companyId: ctx.company.id, agentsOff },
    update: { agentsOff },
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiSettings",
    entityId: ctx.company.id,
    summary: `Switched the AI agent ${found.name} ${on ? "on" : "off"}`,
  });
}
