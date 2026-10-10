import { unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/modules/auth/context";
import type { ValidSession } from "@/modules/auth/session.service";

/*
 * How the app looks for each person: the original layout with the top menu
 * ("LEGACY", everyone's default) or the modern one with the side menu. It is a
 * display choice saved per person, like the hidden dashboard cards, so trying
 * the modern look changes nobody else's screens and needs no permission.
 */

export const INTERFACE_STYLES = ["LEGACY", "MODERN"] as const;
export type InterfaceStyle = (typeof INTERFACE_STYLES)[number];

export const appearanceSchema = z.object({ interfaceStyle: z.enum(INTERFACE_STYLES) });

export async function interfaceStyleFor(userId: string): Promise<InterfaceStyle> {
  const pref = await prisma.userPreference.findUnique({
    where: { userId },
    select: { interfaceStyle: true },
  });
  return pref?.interfaceStyle ?? "LEGACY";
}

/**
 * The signed-in person's look, once per request (the root layout and the app
 * frame both ask). Signed out, or if it cannot be read, the original look.
 */
export const currentInterfaceStyle = cache(async (): Promise<InterfaceStyle> => {
  try {
    const current = await getCurrentSession();
    return current ? await interfaceStyleFor(current.user.id) : "LEGACY";
  } catch (error) {
    // Next's own signals (a page that reads cookies is rendered per request) pass through.
    unstable_rethrow(error);
    return "LEGACY";
  }
});

export async function getAppearance(current: ValidSession) {
  return { interfaceStyle: await interfaceStyleFor(current.user.id) };
}

export async function updateAppearance(current: ValidSession, raw: unknown) {
  const { interfaceStyle } = appearanceSchema.parse(raw);
  const userId = current.user.id;
  await prisma.userPreference.upsert({
    where: { userId },
    create: { userId, interfaceStyle },
    update: { interfaceStyle },
  });
  return { interfaceStyle };
}
