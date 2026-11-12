"use server";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireCompany } from "@/modules/auth/context";
import { getFreshStart, startFreshStart } from "@/modules/fresh-start/fresh-start.service";

/** The Fresh start card (Settings > Company): only the owner sees it. */
export async function getFreshStartAction() {
  return runAction(async () => getFreshStart(await requireCompany()));
}

/**
 * The owner starts the company's one fresh start. Answers at once while the
 * backup and the wipe run; the card asks getFreshStartAction for the result.
 */
export async function startFreshStartAction(input: unknown) {
  return runAction(async () => {
    const ctx = await requireCompany();
    return startFreshStart(ctx, input, await getRequestMeta());
  });
}
