import { describe, expect, it } from "vitest";

import { placeOf, screenName, screenPattern, TASK_SCREENS } from "@/modules/ai/cost-places";
import { AI_TASKS } from "@/modules/ai/models";
import { screenOf } from "@/modules/ai/usage.service";
import { helpSearchEntries } from "@/modules/help";
import { rankHelp } from "@/modules/help/search";

/*
 * Where an AI cost was spent (Budget & Costs "By place in the ERP"), and the
 * Help AI's choice of guides for a question written in full.
 */

describe("the place of an AI cost", () => {
  it("names a screen by its menu area and the parts under it, records as one kind", () => {
    expect(screenPattern("/sales/orders/cmorder0000000000000001x")).toBe("/sales/orders/[id]");
    expect(screenPattern("/production/projects/cmp1234567890abcdefghij/tech-pack")).toBe(
      "/production/projects/[id]/tech-pack",
    );
    expect(screenPattern("/ai/orders/2b4f9c3e-1d2a-4f00-9a7b-0c1d2e3f4a5b")).toBe(
      "/ai/orders/[id]",
    );
    expect(screenPattern("/ai/chat?x=1#end")).toBe("/ai/chat");
    expect(screenName("/ai/chat")).toBe("AI › Chat");
    expect(screenName("/production/projects/cmp1234567890abcdefghij/tech-pack")).toBe(
      "Production › Projects › Tech pack",
    );
    expect(screenName("/accounts/expenses")).toBe("Expenses");
    expect(screenName("/")).toBe("Dashboard");
    expect(screenName("/help/sales/sales-quotation")).toBe("Help Center");
    expect(screenName("bot")).toBe("The bot");
  });

  it("uses the screen, else the record's page, else the task's screen, else the area", () => {
    const line = { screen: null, task: "data.gather", module: "AI" };
    expect(placeOf({ ...line, screen: "/ai/chat" }, "/sales/orders/x")).toEqual({
      key: "/ai/chat",
      label: "AI › Chat",
      href: "/ai/chat",
    });
    expect(placeOf(line, "/hr/claims?claim=cmclaim000000000000000001#claim-1")).toEqual({
      key: "/hr/claims",
      label: "HR & payroll › Claims",
      href: "/hr/claims",
    });
    expect(placeOf(line, "/sales/orders/cmorder0000000000000001x")).toMatchObject({
      key: "/sales/orders/[id]",
      href: null,
    });
    expect(placeOf({ ...line, task: "server.health" }, null)).toMatchObject({
      label: "AI › Health",
      href: "/ai/health",
    });
    expect(placeOf({ ...line, task: "bot.command" }, null)).toEqual({
      key: "bot",
      label: "The bot",
      href: null,
    });
    expect(placeOf(line, null)).toEqual({
      key: "area:AI",
      label: "AI (in the background)",
      href: null,
    });
  });

  it("knows only real tasks, and keeps only the ERP's own addresses", () => {
    const keys = new Set<string>(AI_TASKS.map((t) => t.key));
    for (const task of Object.keys(TASK_SCREENS)) expect(keys.has(task)).toBe(true);
    expect(screenOf("/ai/chat?x=1")).toBe("/ai/chat");
    expect(screenOf("bot")).toBe("bot");
    expect(screenOf("https://elsewhere.test")).toBeNull();
    expect(screenOf("//elsewhere.test")).toBeNull();
    expect(screenOf(undefined)).toBeNull();
    expect(screenOf(`/${"a".repeat(400)}`)).toHaveLength(300);
  });
});

describe("the Help AI's guides", () => {
  const entries = helpSearchEntries(["parties.view", "parties.manage", "sales.view"]);

  // The word-for-word search needs the whole question in one guide; this reads it word by word.
  it("finds guides for a whole question, best first", () => {
    const question = "How do I add a new buyer to the ERP?";
    const found = rankHelp(entries, question);
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThanOrEqual(5);
    expect(found.map((f) => f.sectionId)).toContain("parties");
    // Best first.
    const scores = found.map((f) => f.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("reads Bengali questions too, and finds nothing for nothing", () => {
    expect(rankHelp(entries, "বায়ার যোগ করব কীভাবে?").length).toBeGreaterThan(0);
    expect(rankHelp(entries, "   ?")).toEqual([]);
    expect(rankHelp(entries, "a", 3)).toEqual([]);
  });
});
