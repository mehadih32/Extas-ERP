import { describe, expect, it } from "vitest";

import {
  ACCESS_TREE,
  type AccessBranch,
  branchesOf,
  isBranch,
  leavesOf,
  searchTree,
  tickNode,
  tickState,
  TREE_KEYS,
} from "@/components/settings/roles/access-tree";
import { PERMISSION_GROUPS } from "@/components/settings/roles/role-labels";
import { visibleProductionTabs } from "@/components/production/tabs";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  type PermissionKey,
} from "@/modules/rbac/permissions";

const find = (id: string) => branchesOf(ACCESS_TREE).find((b) => b.id === id)!;

describe("the access tree", () => {
  it("holds every permission exactly once", () => {
    expect([...TREE_KEYS].sort()).toEqual(PERMISSIONS.map((p) => p.key).sort());
    expect(new Set(TREE_KEYS).size).toBe(TREE_KEYS.length);
  });

  it("gives every area and action a name, and areas unique ids", () => {
    const branches = branchesOf(ACCESS_TREE);
    expect(new Set(branches.map((b) => b.id)).size).toBe(branches.length);
    for (const b of branches) {
      expect(b.label.trim()).not.toBe("");
      expect(b.children.length).toBeGreaterThan(0);
    }
    for (const l of ACCESS_TREE.flatMap(leavesOf)) expect(l.label.trim()).not.toBe("");
  });

  it("goes Main area > sub-area > sub-sub-area > action for bookings", () => {
    const production = find("production");
    const bookings = production.children.find((c) => isBranch(c) && c.id === "production.bookings");
    expect(bookings && isBranch(bookings) && bookings.label).toBe("Bookings");
    const add = find("production.bookings.add");
    expect(add.label).toBe("Add bookings");
    expect(add.children.map((c) => !isBranch(c) && c.label)).toEqual([
      "Supplier PO (a mill or trims house)",
      "Ready stock (market purchase)",
    ]);
  });

  it("ticks a whole area, and shows all, some or none of it", () => {
    const production = find("production");
    const all = tickNode(production, new Set(), true);
    expect(tickState(production, all)).toBe("all");
    expect([...all].sort()).toEqual(
      leavesOf(production)
        .map((l) => l.key)
        .sort(),
    );
    const some = tickNode(find("production.bookings.add"), all, false);
    expect(tickState(production, some)).toBe("some");
    expect(tickState(find("production.bookings.add"), some)).toBe("none");
    expect(tickState(find("production.bookings"), some)).toBe("some");
    // Unticking an area leaves the rest of the app as it was.
    const other: Set<PermissionKey> = new Set(["sales.view", "production.view"]);
    expect([...tickNode(production, other, false)]).toEqual(["sales.view"]);
  });

  it("finds actions by their words, keeping the areas above them", () => {
    const found = searchTree(ACCESS_TREE, "ready stock");
    expect(found.map((b) => (b as AccessBranch).id)).toEqual(["production"]);
    expect(found.flatMap(leavesOf).map((l) => l.key)).toEqual(["production.bookings.market"]);
    // An area's name keeps everything in it.
    expect(
      searchTree(ACCESS_TREE, "payroll")
        .flatMap(leavesOf)
        .map((l) => l.key),
    ).toEqual(expect.arrayContaining(["hr.payroll", "hr.payroll.approve", "hr.money.view"]));
    // Words from the path and the action together.
    expect(
      searchTree(ACCESS_TREE, "bookings close")
        .flatMap(leavesOf)
        .map((l) => l.key),
    ).toEqual(["production.bookings.close"]);
    expect(searchTree(ACCESS_TREE, "zzz")).toEqual([]);
    expect(searchTree(ACCESS_TREE, "  ")).toHaveLength(ACCESS_TREE.length);
  });

  it("keeps the role screens' groups in the tree's order", () => {
    expect(PERMISSION_GROUPS.map((g) => g.label)).toEqual(ACCESS_TREE.map((b) => b.label));
    expect(PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key))).toEqual(TREE_KEYS);
  });
});

describe("booking permissions", () => {
  it("go to the built-in roles that had bookings before", () => {
    const bookings = (role: keyof typeof DEFAULT_ROLE_PERMISSIONS) =>
      DEFAULT_ROLE_PERMISSIONS[role].filter((k) => k.startsWith("production.bookings."));
    expect(bookings("PRODUCTION_MANAGER")).toEqual([
      "production.bookings.view",
      "production.bookings.supplier",
      "production.bookings.market",
      "production.bookings.attach",
      "production.bookings.close",
    ]);
    expect(bookings("WAREHOUSE_TEAM")).toEqual(["production.bookings.view"]);
    expect(bookings("ACCOUNTS")).toEqual(["production.bookings.view"]);
    expect(bookings("SALES_EXECUTIVE")).toEqual([]);
    expect(bookings("EMPLOYEE")).toEqual([]);
  });

  it("open the Bookings tab on their own", () => {
    const tabs = (keys: PermissionKey[]) => visibleProductionTabs(keys).map((t) => t.label);
    expect(tabs(["production.bookings.market"])).toEqual(["Bookings"]);
    expect(tabs(["production.bookings.view"])).toEqual(["Bookings"]);
    expect(tabs(["production.view"])).not.toContain("Bookings");
  });
});
