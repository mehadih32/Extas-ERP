import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { prisma } from "@/lib/prisma";
import { getAppearance, updateAppearance } from "@/modules/appearance/appearance.service";
import {
  getDashboardPreferences,
  updateDashboardPreferences,
} from "@/modules/dashboard/preferences.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/*
 * The Legacy or Modern look is each person's own choice, saved with their
 * other display preferences. Choosing one never touches anyone else's look or
 * the person's hidden dashboard cards.
 */
run("the look of the app", () => {
  async function setup() {
    const { company, roles } = await makeCompany("Look Co");
    const owner = await makeUser("owner@look.test");
    const clerk = await makeUser("clerk@look.test");
    await addToCompany(owner.id, company.id, roles.SUPER_ADMIN);
    await addToCompany(clerk.id, company.id, roles.EMPLOYEE);
    return {
      owner: await contextFor(owner.id, company.id),
      clerk: await contextFor(clerk.id, company.id),
    };
  }

  beforeEach(resetDb);
  afterAll(resetDb);

  it("starts everyone on the Legacy look", async () => {
    const { owner, clerk } = await setup();
    expect(await getAppearance(owner)).toEqual({ interfaceStyle: "LEGACY" });
    expect(await getAppearance(clerk)).toEqual({ interfaceStyle: "LEGACY" });
  });

  it("changes only the chooser's look, whatever their role", async () => {
    const { owner, clerk } = await setup();
    expect(await updateAppearance(clerk, { interfaceStyle: "MODERN" })).toEqual({
      interfaceStyle: "MODERN",
    });
    expect(await getAppearance(clerk)).toEqual({ interfaceStyle: "MODERN" });
    expect(await getAppearance(owner)).toEqual({ interfaceStyle: "LEGACY" });

    await updateAppearance(clerk, { interfaceStyle: "LEGACY" });
    expect(await getAppearance(clerk)).toEqual({ interfaceStyle: "LEGACY" });
  });

  it("keeps the hidden dashboard cards, and the cards keep the look", async () => {
    const { owner } = await setup();
    await updateDashboardPreferences(owner, { hiddenMetrics: ["NET_PROFIT"] });
    await updateAppearance(owner, { interfaceStyle: "MODERN" });
    expect(await getDashboardPreferences(owner)).toEqual({ hiddenMetrics: ["NET_PROFIT"] });

    await updateDashboardPreferences(owner, { hiddenMetrics: [] });
    expect(await getAppearance(owner)).toEqual({ interfaceStyle: "MODERN" });
    expect(await prisma.userPreference.count()).toBe(1);
  });

  it("refuses a look that does not exist", async () => {
    const { owner } = await setup();
    await expect(updateAppearance(owner, { interfaceStyle: "DARK" })).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(updateAppearance(owner, {})).rejects.toBeInstanceOf(ZodError);
    expect(await getAppearance(owner)).toEqual({ interfaceStyle: "LEGACY" });
  });
});
