"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import * as fullCheck from "@/modules/ai/full-check/full-check.service";
import { requireCompany } from "@/modules/auth/context";

/*
 * AI Center > Full check Server Actions (the platform owner only, checked in
 * the service): the GitHub connection, starting a check, sending problems or
 * a request to Claude Code, looking again, and merging a ready fix (with the
 * PIN). Each returns { ok: true, data } or { ok: false, error }.
 */

const changeWith = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const out = await work();
    revalidatePath("/", "layout");
    return out;
  });

export const getFullCheckAction = async (runId?: string) =>
  runAction(async () =>
    fullCheck.getFullCheck(
      await requireCompany(),
      typeof runId === "string" && runId ? runId.slice(0, 40) : undefined,
    ),
  );

export const saveGitHubAction = async (input: unknown) =>
  changeWith(async () =>
    fullCheck.saveGitHub(await requireCompany(), input, await getRequestMeta()),
  );

export const removeGitHubAction = async () =>
  changeWith(async () => fullCheck.removeGitHub(await requireCompany(), await getRequestMeta()));

export const testGitHubAction = async () =>
  changeWith(async () => fullCheck.testGitHubConnection(await requireCompany()));

export const startFullCheckAction = async () =>
  changeWith(async () => fullCheck.startFullCheck(await requireCompany(), await getRequestMeta()));

/** "Fix with Claude Code" ({ problemIds }) or "Fix all" ({ runId }). */
export const sendFixAction = async (input: unknown) =>
  changeWith(async () => fullCheck.sendFix(await requireCompany(), input, await getRequestMeta()));

export const askClaudeCodeAction = async (input: unknown) =>
  changeWith(async () =>
    fullCheck.askClaudeCode(await requireCompany(), input, await getRequestMeta()),
  );

export const lookAgainAction = async () =>
  changeWith(async () => fullCheck.lookAgain(await requireCompany()));

/** Merges a ready fix ({ pin }); the Deploy workflow then installs it. */
export const mergeFixAction = async (id: string, input: unknown) =>
  changeWith(async () =>
    fullCheck.mergeFix(
      await requireCompany(),
      String(id).slice(0, 40),
      input,
      await getRequestMeta(),
    ),
  );
