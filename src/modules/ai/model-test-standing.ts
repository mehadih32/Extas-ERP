import type { Db } from "@/lib/db-types";
import { prisma } from "@/lib/prisma";

import { type AiTaskKey, taskInfo } from "./models";
import { testVersion } from "./model-tests";
import { isBuiltIn } from "./providers";

/*
 * Where each model stands on each task's test (AI Center > Models and the Do
 * check in control.service.ts): the ERP's own Claude models are built in; any
 * other model counts as passed only by its last run of the current test.
 */

export type ModelTestState = "BUILT_IN" | "PASSED" | "FAILED" | "CHANGED" | "NONE";

export type ModelStanding = {
  state: ModelTestState;
  last: { right: number; total: number; at: Date; error: string | null } | null;
};

export const MODEL_TEST_TEXT: Record<ModelTestState, string> = {
  BUILT_IN: "Built in",
  PASSED: "Passed",
  FAILED: "Not passed",
  CHANGED: "Test changed: test again",
  NONE: "Not tested",
};

const keyOf = (task: string, model: string) => `${task}|${model}`;

/** The last run of every (task, model) the company has tested. */
export async function modelTestRuns(companyId: string, db: Db = prisma) {
  const runs = await db.aiModelTest.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take: 1_000,
    select: {
      task: true,
      model: true,
      version: true,
      passed: true,
      right: true,
      total: true,
      error: true,
      createdAt: true,
    },
  });
  const last = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (!last.has(keyOf(r.task, r.model))) last.set(keyOf(r.task, r.model), r);
  return last;
}

export type ModelTestRuns = Awaited<ReturnType<typeof modelTestRuns>>;

/** How a model stands on a task's test. */
export function standingOf(runs: ModelTestRuns, task: AiTaskKey, model: string): ModelStanding {
  const run = runs.get(keyOf(task, model)) ?? null;
  const last = run
    ? { right: run.right, total: run.total, at: run.createdAt, error: run.error }
    : null;
  if (isBuiltIn(model) && taskInfo(task)) return { state: "BUILT_IN", last };
  if (!run) return { state: "NONE", last };
  if (run.version !== testVersion(task)) return { state: "CHANGED", last };
  return { state: run.passed ? "PASSED" : "FAILED", last };
}

/** Whether the model may do the task on Do. */
export const mayDo = (s: ModelStanding) => s.state === "BUILT_IN" || s.state === "PASSED";
