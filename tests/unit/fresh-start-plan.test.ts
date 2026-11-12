import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { rawWriteTables } from "@/lib/read-only";
import {
  erases,
  FILE_MENTIONS,
  FRESH_START_RESETS,
  FRESH_START_RULES,
  freshStartSteps,
  type FreshStartTicks,
  touchedTables,
} from "@/modules/fresh-start/plan";
import { fileSql, lockSql } from "@/modules/fresh-start/wipe";

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

  it("erases notes and the planner (2026-11-12 review)", () => {
    for (const ticks of ALL_TICKS) expect(erases("Note", ticks)).toBe(true);
  });

  it("looks for kept files only in real file columns, each of which exists", () => {
    const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
    for (const c of FILE_MENTIONS) {
      const field = models.get(c.model)?.fields.find((f) => f.name === c.column);
      expect(field, `${c.model}.${c.column}`).toBeDefined();
      expect(field!.type).toBe(c.json ? "Json" : "String");
    }
    // Erased tables are never searched; kept ones are, by their column only.
    const none = { keepParties: false, keepProducts: false, keepEmployees: false };
    const sql = fileSql(none);
    expect(sql).not.toContain('"Style"');
    expect(sql).toContain('"Company" t');
    expect(fileSql({ ...none, keepProducts: true })).toContain('t."imageUrl"');
  });

  it("locks every table it writes to before it writes", () => {
    for (const ticks of ALL_TICKS) {
      const tables = touchedTables(ticks);
      for (const step of freshStartSteps(ticks)) expect(tables).toContain(step.model);
      expect(tables).toContain("FileAsset");
      expect(lockSql(ticks)).toMatch(/^LOCK TABLE .* IN EXCLUSIVE MODE$/);
      expect(rawWriteTables(lockSql(ticks))[0]).toBe(tables[0]);
    }
  });

  it("names the tables a raw write touches, for the fresh start guard", () => {
    expect(rawWriteTables('UPDATE "Party" SET "name" = $1 WHERE "id" = $2')).toEqual(["Party"]);
    expect(rawWriteTables('INSERT INTO "AuditLog" ("id") VALUES ($1)')).toEqual(["AuditLog"]);
    expect(rawWriteTables('DELETE FROM "Note" WHERE "companyId" = $1')).toEqual(["Note"]);
    expect(rawWriteTables('SELECT 1 FROM "Party"')).toEqual([]);
  });
});
