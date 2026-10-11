import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  getDashboardPreferences,
  getHomeSectionOrder,
  homeSectionOrder,
  homeSectionOrderFor,
  setHomeSectionOrder,
  updateDashboardPreferences,
} from "@/modules/dashboard/preferences.service";
import { HOME_SECTIONS, homeSectionOrderSchema } from "@/modules/dashboard/schemas";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/**
 * Each person's own order of the Home screen's sections ("Arrange sections"),
 * kept in UserPreference.dashboardLayout.
 */
async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const { company: other, roles: otherRoles } = await makeCompany("Other");
  const owner = await makeUser("owner@extras.test");
  await addToCompany(owner.id, company.id, roles.SUPER_ADMIN);
  await addToCompany(owner.id, other.id, otherRoles.SUPER_ADMIN);
  const sales = await makeUser("sales@extras.test");
  await addToCompany(sales.id, company.id, roles.SALES_EXECUTIVE);
  return {
    owner: await contextFor(owner.id, company.id),
    ownerElsewhere: await contextFor(owner.id, other.id),
    sales: await contextFor(sales.id, company.id),
  };
}

describe("the order of the Home sections", () => {
  it("keeps each section once: the saved ones first, then the rest in the standard order", () => {
    expect(homeSectionOrder(undefined)).toEqual([...HOME_SECTIONS]);
    expect(homeSectionOrder("INSIGHTS")).toEqual([...HOME_SECTIONS]);
    expect(homeSectionOrder(["INSIGHTS", "OLD_SECTION", 7, "INSIGHTS", "ACTION_ZONE"])).toEqual([
      "INSIGHTS",
      "ACTION_ZONE",
      "TARGET_PULSE",
      "PREDICTIVE",
      "PIPELINE_ACTIVITY",
      "KEY_FIGURES",
    ]);
  });

  it("takes each known section at most once", () => {
    expect(homeSectionOrderSchema.safeParse({ order: ["INSIGHTS", "ACTION_ZONE"] }).success).toBe(
      true,
    );
    for (const order of [[], ["INSIGHTS", "INSIGHTS"], ["SOMETHING"], "INSIGHTS"]) {
      expect(homeSectionOrderSchema.safeParse({ order }).success, JSON.stringify(order)).toBe(
        false,
      );
    }
  });
});

run("saving the order of the Home sections", () => {
  beforeEach(resetDb);

  it("starts in the standard order and keeps a saved order for that person only", async () => {
    const env = await setup();
    expect(await getHomeSectionOrder(env.owner)).toEqual({ sectionOrder: [...HOME_SECTIONS] });

    const order = [
      "INSIGHTS",
      "KEY_FIGURES",
      "PIPELINE_ACTIVITY",
      "PREDICTIVE",
      "ACTION_ZONE",
      "TARGET_PULSE",
    ] as const;
    expect(await setHomeSectionOrder(env.owner, { order })).toEqual({ sectionOrder: order });
    // Read again as after a refresh, and in the other company the owner works in.
    expect(await homeSectionOrderFor(env.owner.user.id)).toEqual(order);
    expect(await getHomeSectionOrder(env.ownerElsewhere)).toEqual({ sectionOrder: order });
    // Another person keeps their own.
    expect(await getHomeSectionOrder(env.sales)).toEqual({ sectionOrder: [...HOME_SECTIONS] });
    const pref = await prisma.userPreference.findUnique({ where: { userId: env.owner.user.id } });
    expect(pref?.dashboardLayout).toEqual({ sectionOrder: order });
  });

  it("moves only the sections given, the others keeping their places", async () => {
    const env = await setup();
    // A Sales Executive sees the sales target and The Pulse, the live activity and the Insights.
    const result = await setHomeSectionOrder(env.sales, {
      order: ["INSIGHTS", "TARGET_PULSE", "PIPELINE_ACTIVITY"],
    });
    expect(result.sectionOrder).toEqual([
      "INSIGHTS",
      "ACTION_ZONE",
      "PREDICTIVE",
      "TARGET_PULSE",
      "KEY_FIGURES",
      "PIPELINE_ACTIVITY",
    ]);
    // A later order of the same sections fills the same places.
    const again = await setHomeSectionOrder(env.sales, {
      order: ["PIPELINE_ACTIVITY", "INSIGHTS", "TARGET_PULSE"],
    });
    expect(again.sectionOrder).toEqual([
      "PIPELINE_ACTIVITY",
      "ACTION_ZONE",
      "PREDICTIVE",
      "INSIGHTS",
      "KEY_FIGURES",
      "TARGET_PULSE",
    ]);
  });

  it("refuses a section twice or one it does not know, and changes nothing", async () => {
    const env = await setup();
    await setHomeSectionOrder(env.owner, { order: ["KEY_FIGURES", "TARGET_PULSE"] });
    const before = await homeSectionOrderFor(env.owner.user.id);
    for (const order of [["INSIGHTS", "INSIGHTS"], ["SOMETHING"], []]) {
      await expect(setHomeSectionOrder(env.owner, { order })).rejects.toThrow();
    }
    expect(await homeSectionOrderFor(env.owner.user.id)).toEqual(before);
  });

  it("reads past an old or broken saved layout and keeps what else it holds", async () => {
    const env = await setup();
    await prisma.userPreference.create({
      data: {
        userId: env.owner.user.id,
        dashboardLayout: { sectionOrder: ["KEY_FIGURES", "GONE", "KEY_FIGURES"], other: 1 },
      },
    });
    expect((await homeSectionOrderFor(env.owner.user.id))[0]).toBe("KEY_FIGURES");
    await setHomeSectionOrder(env.owner, { order: ["INSIGHTS", "KEY_FIGURES"] });
    const pref = await prisma.userPreference.findUnique({ where: { userId: env.owner.user.id } });
    expect(pref?.dashboardLayout).toEqual({
      other: 1,
      sectionOrder: [
        "INSIGHTS",
        "TARGET_PULSE",
        "ACTION_ZONE",
        "PREDICTIVE",
        "PIPELINE_ACTIVITY",
        "KEY_FIGURES",
      ],
    });

    await prisma.userPreference.update({
      where: { userId: env.owner.user.id },
      data: { dashboardLayout: ["not", "an", "object"] },
    });
    expect(await homeSectionOrderFor(env.owner.user.id)).toEqual([...HOME_SECTIONS]);
  });

  it("leaves the hidden key figures alone, and they leave the order alone", async () => {
    const env = await setup();
    await updateDashboardPreferences(env.owner, { hiddenMetrics: ["NET_PROFIT"] });
    await setHomeSectionOrder(env.owner, { order: ["INSIGHTS"] });
    expect(await getDashboardPreferences(env.owner)).toEqual({ hiddenMetrics: ["NET_PROFIT"] });
    await updateDashboardPreferences(env.owner, { metric: "LIABILITIES", hidden: true });
    expect(await homeSectionOrderFor(env.owner.user.id)).toEqual([...HOME_SECTIONS]);
    await setHomeSectionOrder(env.owner, { order: ["INSIGHTS", "TARGET_PULSE"] });
    expect(await getDashboardPreferences(env.owner)).toEqual({
      hiddenMetrics: ["LIABILITIES", "NET_PROFIT"],
    });
    expect((await homeSectionOrderFor(env.owner.user.id))[0]).toBe("INSIGHTS");
  });

  it("saves from two tabs at once without losing a section", async () => {
    const env = await setup();
    await Promise.all([
      setHomeSectionOrder(env.owner, { order: ["INSIGHTS", "TARGET_PULSE"] }),
      setHomeSectionOrder(env.owner, { order: ["KEY_FIGURES", "ACTION_ZONE"] }),
    ]);
    const order = await homeSectionOrderFor(env.owner.user.id);
    expect([...order].sort()).toEqual([...HOME_SECTIONS].sort());
    expect(order.indexOf("INSIGHTS")).toBeLessThan(order.indexOf("TARGET_PULSE"));
    expect(order.indexOf("KEY_FIGURES")).toBeLessThan(order.indexOf("ACTION_ZONE"));
  });
});
