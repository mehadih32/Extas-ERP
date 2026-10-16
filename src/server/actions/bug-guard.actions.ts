"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireCompany } from "@/modules/auth/context";
import * as fixes from "@/modules/bug-guard/fixes.service";
import * as screen from "@/modules/bug-guard/screen.service";
import * as settings from "@/modules/bug-guard/settings.service";

/*
 * AI Center > Bug Guard Server Actions (the platform owner only, checked in
 * the services): Run now, the schedule, Fix, Ignore, Remind me later, Show
 * again, the corrections (Apply and Undo with the PIN) and lifting a block
 * (with the PIN). Each returns { ok: true, data } or { ok: false, error }.
 */

const id = (value: string) => String(value).slice(0, 40);

const change = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const out = await work();
    revalidatePath("/ai/bug-guard");
    return out;
  });

export const getBugGuardAction = async () =>
  runAction(async () => screen.getBugGuard(await requireCompany()));

export const runBugGuardNowAction = async () =>
  change(async () => screen.runNow(await requireCompany()));

export const saveBugGuardSettingsAction = async (input: unknown) =>
  change(async () => settings.saveSettings(await requireCompany(), input, await getRequestMeta()));

/** Fix ({ pin } for a security step). */
export const fixFindingAction = async (findingId: string, input: unknown) =>
  change(async () =>
    fixes.fixFinding(await requireCompany(), id(findingId), input, await getRequestMeta()),
  );

export const ignoreFindingAction = async (findingId: string) =>
  change(async () =>
    fixes.ignoreFinding(await requireCompany(), id(findingId), await getRequestMeta()),
  );

export const snoozeFindingAction = async (findingId: string) =>
  change(async () =>
    fixes.snoozeFinding(await requireCompany(), id(findingId), await getRequestMeta()),
  );

export const reopenFindingAction = async (findingId: string) =>
  change(async () =>
    fixes.reopenFinding(await requireCompany(), id(findingId), await getRequestMeta()),
  );

/** Apply ({ pin }): a backup first, then the correction. */
export const applyCorrectionAction = async (correctionId: string, input: unknown) =>
  change(async () =>
    fixes.applyCorrection(await requireCompany(), id(correctionId), input, await getRequestMeta()),
  );

export const cancelCorrectionAction = async (correctionId: string) =>
  change(async () =>
    fixes.cancelCorrection(await requireCompany(), id(correctionId), await getRequestMeta()),
  );

/** Undo ({ pin }). */
export const undoCorrectionAction = async (correctionId: string, input: unknown) =>
  change(async () =>
    fixes.undoCorrection(await requireCompany(), id(correctionId), input, await getRequestMeta()),
  );

/** "Allow again" on a blocked login source ({ pin }). */
export const liftBlockAction = async (blockId: string, input: unknown) =>
  change(async () =>
    fixes.liftBlock(await requireCompany(), id(blockId), input, await getRequestMeta()),
  );
