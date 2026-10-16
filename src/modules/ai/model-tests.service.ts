import type { Prisma } from "@prisma/client";
import { z } from "zod";

import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";

import { askClaude } from "./claude";
import { type AiTaskKey, TASK_KEYS, taskInfo } from "./models";
import { mayDo, modelTestRuns, standingOf } from "./model-test-standing";
import { tasksFor, testCasesOf, testVersion } from "./model-tests";
import { isBuiltIn, modelLabel, parseModel, providerInfo } from "./providers";
import {
  agentModelsOf,
  aiSettingsOf,
  companyModelFor,
  keyFor,
  readModelsOf,
} from "./settings.service";

/*
 * Running a task's test on a model (AI Center > Models, "Run the test"), and
 * the Do check: an action whose AI work runs on a model that has not passed
 * that work's test stays Ask (control.service.ts aiMay), on every provider
 * alike. The test asks the model through the same door as all AI work
 * (claude.ts), so the switch, the budget and the cost lines apply, and it is
 * marked by the ERP, never by another AI.
 */

export const runTestSchema = z.object({
  task: z.enum(TASK_KEYS),
  model: z.string().trim().min(1).max(140),
});

export type ModelTestResult = {
  passed: boolean;
  right: number;
  total: number;
  details: Array<{ case: string; title: string; ok: boolean; why: string; answer: string }>;
};

/** Asks the model every question of the task's test and keeps the result. */
export async function runModelTest(
  ctx: CompanyContext,
  input: unknown,
  meta?: RequestMeta,
): Promise<ModelTestResult> {
  if (!ctx.can("ai.manage")) {
    throw new AppError("FORBIDDEN", "Only the owner runs the model tests.");
  }
  const { task, model } = runTestSchema.parse(input);
  const ref = parseModel(model);
  if (!ref) throw new AppError("VALIDATION", "Pick a model from the list.");
  const settings = await aiSettingsOf(ctx.company.id);
  if (!keyFor(settings, ref.provider)) {
    throw new AppError(
      "VALIDATION",
      `Add the ${providerInfo(ref.provider).label} key on AI Center > Settings first.`,
    );
  }
  const read = readModelsOf(settings)[ref.provider]?.models;
  const label = modelLabel(model, read);
  const details: ModelTestResult["details"] = [];
  for (const c of testCasesOf(task)) {
    try {
      const answer = await askClaude(ctx.company.id, {
        task,
        model,
        agent: "Model test",
        userId: ctx.user.id,
        screen: "/ai/models",
        why: `Model test: ${label} on ${taskInfo(task)!.label} (${c.title})`,
        ...(c.ask.system ? { system: c.ask.system } : {}),
        messages: [{ role: "user", content: c.ask.prompt }],
        ...(c.ask.tools ? { tools: c.ask.tools } : {}),
        maxTokens: c.ask.maxTokens,
        costOk: true,
        timeoutMs: 120_000,
      });
      details.push({ case: c.id, title: c.title, ...c.mark(answer.message) });
    } catch (error) {
      if (
        error instanceof AppError &&
        details.length === 0 &&
        !/could not take/.test(error.message)
      ) {
        // AI off, no key, a budget limit or a refused key: nothing was tested.
        throw error;
      }
      details.push({
        case: c.id,
        title: c.title,
        ok: false,
        why: error instanceof Error ? error.message : "The model did not answer.",
        answer: "",
      });
    }
  }
  const right = details.filter((d) => d.ok).length;
  const result = { passed: right === details.length, right, total: details.length, details };
  await prisma.aiModelTest.create({
    data: {
      companyId: ctx.company.id,
      task,
      model,
      provider: ref.provider,
      version: testVersion(task),
      passed: result.passed,
      right,
      total: result.total,
      details: details as unknown as Prisma.InputJsonValue,
      ranById: ctx.user.id,
    },
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiSettings",
    entityId: ctx.company.id,
    summary: `Model test: ${label} on ${taskInfo(task)!.label}: ${result.passed ? "passed" : "not passed"} (${right} of ${result.total})`,
  });
  return result;
}

/** The last runs of one model on one task, for the screen. */
export async function modelTestHistory(ctx: CompanyContext, task: AiTaskKey, model: string) {
  return ctx.db.aiModelTest.findMany({
    where: { task, model },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { passed: true, right: true, total: true, details: true, createdAt: true },
  });
}

export type MissingModelTest = { task: AiTaskKey; model: string; label: string };

/**
 * The tests still missing before an action may be Do: every model its AI work
 * may run on (each task's model, and any agent's own model) that is not one of
 * the ERP's own and has not passed that task's test.
 */
export async function modelTestsMissingFor(
  companyId: string,
  key: string,
  db: Db = prisma,
): Promise<MissingModelTest[]> {
  const settings = await aiSettingsOf(companyId, db);
  const agentOwn = Object.values(agentModelsOf(settings)).filter((m) => !isBuiltIn(m));
  const tasks = tasksFor(key);
  const candidates = tasks.flatMap((task) =>
    [...new Set([companyModelFor(settings, task), ...agentOwn])]
      .filter((m) => !isBuiltIn(m))
      .map((model) => ({ task, model })),
  );
  if (candidates.length === 0) return [];
  const runs = await modelTestRuns(companyId, db);
  return candidates
    .filter((c) => !mayDo(standingOf(runs, c.task, c.model)))
    .map((c) => ({ ...c, label: modelLabel(c.model) }));
}
