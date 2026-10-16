import { describe, expect, it } from "vitest";

import { AI_TABS, visibleAiTabs } from "@/components/ai/tabs";
import { ACCESS_TREE, type AccessNode, isBranch } from "@/components/settings/roles/access-tree";
import {
  ACTION_KEYS,
  AI_TREE,
  BUYER_ACTIONS,
  type CellRows,
  type CellState,
  descendantsOf,
  grantOpens,
  isLocked,
  isNode,
  mostFor,
  NEVER_FOR_AI,
  type NodeRef,
  pathText,
  PRESETS,
  presetRows,
  readCell,
  setCell,
} from "@/modules/ai/control-tree";
import { AI_MODELS, AI_TASKS, costUsd, modelFor } from "@/modules/ai/models";
import { ALL_PERMISSION_KEYS, DEFAULT_ROLE_PERMISSIONS } from "@/modules/rbac/permissions";

const rows = (entries: Array<[NodeRef, CellState]>): CellRows => new Map(entries);

describe("Control: the AI's access tree", () => {
  it("is the roles screen's access tree, without what the AI may never hold", () => {
    const keys = new Set(ACTION_KEYS);
    for (const key of ALL_PERMISSION_KEYS) {
      expect(keys.has(key), key).toBe(!NEVER_FOR_AI.has(key));
    }
    // No team, roles, backups or AI Center cells; the AI cannot widen its own reach.
    for (const key of [
      "company.members.manage",
      "company.roles.manage",
      "backups.manage",
      "ai.view",
      "ai.manage",
    ]) {
      expect(isNode(`k:${key}`), key).toBe(false);
    }
    expect(isNode("b:backups")).toBe(false);
    expect(isNode("b:ai")).toBe(false);
    // Every area of the access tree that keeps an action is an area here too.
    const areas = (nodes: readonly AccessNode[]): string[] =>
      nodes.flatMap((n) => (isBranch(n) ? [n.id, ...areas(n.children)] : []));
    for (const id of areas(ACCESS_TREE).filter(
      (id) => !["backups", "ai", "administration.team"].includes(id),
    )) {
      expect(isNode(`b:${id}`), id).toBe(true);
    }
    expect(new Set(ACTION_KEYS).size).toBe(ACTION_KEYS.length);
  });

  it("adds the AI's own actions where they belong, and has no delete cell", () => {
    expect(pathText("k:ai.production.booking.send")).toBe(
      "Production › Bookings › Send a booking to the supplier",
    );
    expect(pathText("k:ai.buyer.reply")).toBe("Sales › Reply to a buyer");
    expect(ACTION_KEYS.some((k) => /delete|remove/i.test(k))).toBe(false);
    expect(AI_TREE.label).toBe("Everything");
  });

  it("starts every cell at Ask, and an area sets everything in it", () => {
    expect(readCell(rows([]), "k:production.manage")).toEqual({
      state: "ASK",
      from: "start",
      heldAtAsk: false,
    });
    const production = setCell(rows([]), "b:production", "DO");
    expect(readCell(production, "k:production.manage")).toMatchObject({
      state: "DO",
      from: "area",
    });
    expect(readCell(production, "k:ai.production.costing").state).toBe("DO");
    expect(readCell(production, "k:sales.view").state).toBe("ASK");

    // A cell set on its own is an exception; setting the area again clears it.
    const exception = setCell(production, "k:production.bookings.view", "OFF");
    expect(readCell(exception, "k:production.bookings.view")).toMatchObject({
      state: "OFF",
      from: "cell",
    });
    const again = setCell(exception, "b:production", "OFF");
    expect(again.has("k:production.bookings.view")).toBe(false);
    expect(readCell(again, "k:production.bookings.view").state).toBe("OFF");
    expect(descendantsOf("b:production.bookings")).toContain("k:production.bookings.approve");
  });

  it("keeps money, prices and anything that leaves the company at Ask under an area set to Do", () => {
    const all = rows([["b:all", "DO"]]);
    for (const key of [
      "accounts.receipts.record",
      "accounts.payments.record",
      "production.bookings.approve",
      "ai.production.booking.send",
      "ai.production.cm.agree",
      // Locked at Ask in v6.3: sending fabric first, and campaigns to win back quiet buyers.
      "ai.production.fabric_first",
      "sales.campaigns.manage",
    ]) {
      expect(isLocked(key), key).toBe(true);
      expect(readCell(all, `k:${key}`), key).toEqual({
        state: "ASK",
        from: "area",
        heldAtAsk: true,
      });
    }
    // Set on its own, a locked cell (not a buyer one) can be Do.
    expect(
      readCell(setCell(all, "k:ai.production.booking.send", "DO"), "k:ai.production.booking.send")
        .state,
    ).toBe("DO");
    expect(readCell(all, "k:production.view").state).toBe("DO");
  });

  it("never lets what goes to a buyer be Do", () => {
    for (const key of BUYER_ACTIONS) {
      expect(mostFor(key), key).toBe("ASK");
      expect(readCell(rows([[`k:${key}`, "DO"]]), `k:${key}`), key).toMatchObject({
        state: "ASK",
        heldAtAsk: true,
      });
    }
    expect([...BUYER_ACTIONS]).toEqual(
      expect.arrayContaining([
        "ai.buyer.reply",
        "ai.buyer.follow_up",
        "ai.buyer.claim",
        "ai.sales.quotation.send",
        "ai.sales.invoice.send",
        "sales.campaigns.manage",
      ]),
    );
    expect(mostFor("sales.campaigns.manage")).toBe("ASK");
    expect(mostFor("production.view")).toBe("DO");
  });

  it("opens a cell for a while: the exact cell always, an area only for unlocked actions, a record only for itself", () => {
    expect(grantOpens({ ref: "k:accounts.receipts.record" }, "accounts.receipts.record")).toBe(
      true,
    );
    expect(grantOpens({ ref: "b:accounts" }, "accounts.view")).toBe(true);
    expect(grantOpens({ ref: "b:accounts" }, "accounts.receipts.record")).toBe(false);
    expect(grantOpens({ ref: "b:accounts" }, "production.view")).toBe(false);
    const booking = { type: "PurchaseOrder", id: "po1" };
    expect(grantOpens({ ref: "b:production", record: booking }, "production.manage", booking)).toBe(
      true,
    );
    expect(
      grantOpens({ ref: "b:production", record: booking }, "production.manage", {
        type: "PurchaseOrder",
        id: "po2",
      }),
    ).toBe(false);
    expect(grantOpens({ ref: "b:production", record: booking }, "production.manage")).toBe(false);
  });

  it("has presets that set many cells at once", () => {
    expect(PRESETS.map((p) => p.label)).toEqual([
      "Only tech pack and booking",
      "Production full",
      "Accounts open today",
      "All off",
    ]);
    const techpack = presetRows(rows([["b:sales", "DO"]]), "techpack-and-booking");
    for (const ref of techpack.keys()) expect(isNode(ref), ref).toBe(true);
    expect(readCell(techpack, "k:sales.view").state).toBe("OFF");
    expect(readCell(techpack, "k:production.bookings.supplier").state).toBe("DO");
    expect(readCell(techpack, "k:ai.production.techpack.draft").state).toBe("DO");
    expect(readCell(techpack, "k:production.bookings.approve")).toMatchObject({
      state: "ASK",
      heldAtAsk: true,
    });
    expect(readCell(techpack, "k:accounts.view").state).toBe("OFF");

    const full = presetRows(rows([["k:sales.view", "OFF"]]), "production-full");
    expect(readCell(full, "k:production.stock_intake").state).toBe("DO");
    expect(readCell(full, "k:sales.view").state).toBe("OFF");
    expect(readCell(presetRows(full, "all-off"), "k:production.view").state).toBe("OFF");
  });
});

describe("AI Center tabs and models", () => {
  it("shows the AI Center to the owner only by default, and Settings only with ai.manage", () => {
    expect(visibleAiTabs(DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN, true).map((t) => t.label)).toEqual(
      AI_TABS.map((t) => t.label),
    );
    // Server Health looks at the whole server: the platform owner's only.
    expect(visibleAiTabs(DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN).map((t) => t.label)).toEqual(
      AI_TABS.filter((t) => t.label !== "Server Health").map((t) => t.label),
    );
    for (const role of ["PRODUCTION_MANAGER", "SALES_EXECUTIVE", "ACCOUNTS", "EMPLOYEE"] as const) {
      expect(visibleAiTabs(DEFAULT_ROLE_PERMISSIONS[role]), role).toEqual([]);
    }
    // The chat is the owner's own (ai.manage), like Settings.
    expect(visibleAiTabs(["ai.view"]).map((t) => t.label)).toEqual([
      "AI Home",
      "Mehedi 2.0",
      "Orders",
      "Drafts",
      "Control",
      "Budget & Costs",
      "Models",
      "Books & tests",
      "Logs",
    ]);
  });

  it("uses the big model for thinking, smaller ones for the rest, and Fable only when allowed", () => {
    const task = (key: string) => AI_TASKS.find((t) => t.key === key)!;
    expect(task("costing").model).toBe("claude-opus-5-5");
    expect(task("message.draft").model).toBe("claude-sonnet-5-5");
    expect(task("read.documents").model).toBe("claude-haiku-5-5");
    expect(modelFor("costing", {}, false)).toBe("claude-opus-5-5");
    expect(modelFor("costing", { costing: "claude-sonnet-5-5" }, false)).toBe("claude-sonnet-5-5");
    expect(modelFor("costing", { costing: "claude-fable-5-1" }, false)).toBe("claude-opus-5-5");
    expect(modelFor("costing", { costing: "claude-fable-5-1" }, true)).toBe("claude-fable-5-1");
    expect(modelFor("costing", { costing: "not-a-model" }, true)).toBe("claude-opus-5-5");
    expect(new Set(AI_TASKS.map((t) => t.key)).size).toBe(AI_TASKS.length);
    for (const t of AI_TASKS)
      expect(
        AI_MODELS.some((m) => m.id === t.model),
        t.key,
      ).toBe(true);
  });

  it("works out what a call cost in dollars from its tokens", () => {
    // 1M in + 1M out on Opus 5.5: $4 + $20.
    expect(costUsd("claude-opus-5-5", { input: 1_000_000, output: 1_000_000 })).toBeCloseTo(24, 6);
    // Cache reads are cheap; cache writes cost a quarter more than input.
    expect(
      costUsd("claude-sonnet-5-5", {
        input: 0,
        output: 0,
        cacheRead: 1_000_000,
        cacheWrite: 1_000_000,
      }),
    ).toBeCloseTo(0.2 + 2.5, 6);
    // Haiku over 100K prompt tokens is charged at the long-prompt price.
    expect(costUsd("claude-haiku-5-5", { input: 50_000, output: 1_000 })).toBeCloseTo(0.0055, 6);
    expect(costUsd("claude-haiku-5-5", { input: 200_000, output: 1_000 })).toBeCloseTo(0.1025, 6);
    expect(costUsd("unknown", { input: 1, output: 1 })).toBe(0);
  });
});
