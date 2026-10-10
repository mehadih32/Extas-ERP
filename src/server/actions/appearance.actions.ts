"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/result";
import { getAppearance, updateAppearance } from "@/modules/appearance/appearance.service";
import { requireSession } from "@/modules/auth/context";

/*
 * Each person's look (Legacy or Modern). Anyone signed in may change their own;
 * it changes nobody else's screens.
 */

export const getAppearanceAction = async () =>
  runAction(async () => getAppearance(await requireSession()));

export const updateAppearanceAction = async (input: unknown) =>
  runAction(async () => {
    const result = await updateAppearance(await requireSession(), input);
    // The whole frame changes (menu, fonts, styles), so every page draws afresh.
    revalidatePath("/", "layout");
    return result;
  });
