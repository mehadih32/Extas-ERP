import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  erases,
  FRESH_START_RESETS,
  FRESH_START_RULES,
  freshStartSteps,
  type FreshStartTicks,
} from "@/modules/fresh-start/plan";

const ALL_TICKS: FreshStartTicks[] = [false, true].flatMap((keepParties) =>
  [false, true].flatMap((keepProducts) =>
    [false, true].map((keepEmployees) => ({ keepParties, keepProducts, keepEmployees })),
  ),
);

describe("Fresh start plan", () => {
  it("classifies every model in the schema, and only those", () => {
    const schema = Prisma.dmmf.datamodel.models.map((m) => m.name).sort();
    const missing = schema.filter((name) => !(name in FRESH_START_RULES));
    expect(
      missing,
      "add these models to FRESH_START_RULES in src/modules/fresh-start/plan.ts",
    ).toEqual([]);
    const unknown = Object.keys(FRESH_START_RULES).filter((name) => !schema.includes(name));
    expect(unknown).toEqual([]);
  });

  it("keeps the settings, the team, the backups and the fresh start record itself", () => {
    const none = { keepParties: false, keepProducts: false, keepEmployees: false };
    for (const model of [
      "Company",
      "User",
      "Session",
      "CompanyMembership",
      "MemberPermission",
      "Role",
      "RolePermission",
      "AiSettings",
      "AiBotLink",
      "BackupConfig",
      "BackupRun",
      "LedgerAccount",
      "SalesChannelIntegration",
      "RetailStore",
      "FreshStart",
      "Warehouse",
    ]) {
      expect(erases(model, none), model).toBe(false);
    }
    for (const model of [
      "JournalEntry",
      "JournalLine",
      "SalesOrder",
      "Invoice",
      "StockMovement",
      "AuditLog",
    ]) {
      expect(erases(model, none), model).toBe(true);
    }
  });

  it("follows the ticks for buyers and suppliers, products and employees", () => {
    const all = { keepParties: true, keepProducts: true, keepEmployees: true };
    const none = { keepParties: false, keepProducts: false, keepEmployees: false };
    for (const model of [
      "Party",
      "Style",
      "ProductVariant",
      "RawMaterial",
      "Employee",
      "SalaryRevision",
    ]) {
      expect(erases(model, all), model).toBe(false);
      expect(erases(model, none), model).toBe(true);
    }
  });

  it("has a safe order for every choice of ticks, with every erased model in it", () => {
    for (const ticks of ALL_TICKS) {
      const steps = freshStartSteps(ticks);
      const erased = steps.filter((s) => s.kind === "erase").map((s) => s.model);
      const expected = Object.keys(FRESH_START_RULES).filter(
        (m) => erases(m, ticks) && m !== "FileAsset",
      );
      expect(erased.sort()).toEqual(expected.sort());
      // Every statement is scoped to the one company.
      for (const step of steps) expect(step.sql, step.model).toContain("$1");
    }
  });

  it("erases a table only after every erased table that points at it", () => {
    const ticks = { keepParties: false, keepProducts: false, keepEmployees: false };
    const order = freshStartSteps(ticks)
      .filter((s) => s.kind === "erase")
      .map((s) => s.model);
    const at = (m: string) => order.indexOf(m);
    expect(at("JournalLine")).toBeLessThan(at("JournalEntry"));
    expect(at("SalesOrderItem")).toBeLessThan(at("ProductVariant"));
    expect(at("Payment")).toBeLessThan(at("Invoice"));
    expect(at("RetailOrderLine")).toBeLessThan(at("RetailOrder"));
  });

  it("only resets figures of models that exist", () => {
    for (const model of Object.keys(FRESH_START_RESETS))
      expect(FRESH_START_RULES[model]).toBeDefined();
  });
});
