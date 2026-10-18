import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { LONG_NAMES, lengthenNames, nth } from "../../scripts/layout-long-names";
import { isCheckDatabase } from "../../scripts/layout-session";
import { makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/*
 * v6.4.1 C1: the layout checks run with long, real-looking names, so a screen that
 * cuts a buyer's, supplier's or company's name with "..." fails there. The names go
 * only into a database made for checks; names and codes change, amounts never do.
 */
describe("the long names' list", () => {
  it("runs past its end with Unit 2, Unit 3", () => {
    expect(nth(["A", "B"], 0)).toBe("A");
    expect(nth(["A", "B"], 1)).toBe("B");
    expect(nth(["A", "B"], 2)).toBe("A Unit 2");
    expect(nth(["A", "B"], 5)).toBe("B Unit 3");
  });

  it("holds names as long as the owner's examples", () => {
    expect(LONG_NAMES.buyers).toContain(
      "Bangladesh Apparel Sourcing & Merchandising International Ltd.",
    );
    expect(LONG_NAMES.suppliers).toContain(
      "Narayanganj Knit Composite Dyeing & Finishing Mills Ltd.",
    );
    expect(LONG_NAMES.companies[0]).toBe("Extas Apparel Sourcing & Buying House Limited");
    for (const name of [...LONG_NAMES.buyers, ...LONG_NAMES.suppliers, ...LONG_NAMES.styles]) {
      expect(name.length, name).toBeGreaterThanOrEqual(45);
    }
  });

  it("goes only into a database made for checks, never the live ERP's or the demo site's", () => {
    expect(isCheckDatabase("extras_layout_demo")).toBe(true);
    expect(isCheckDatabase("extras_erp")).toBe(false);
    expect(isCheckDatabase("extras_demo", {})).toBe(false);
    expect(isCheckDatabase("extras_erp_test_41screens")).toBe(false);
  });
});

run("long names for the layout checks", () => {
  beforeEach(resetDb);
  afterAll(resetDb);

  async function setup() {
    const { company } = await makeCompany("Extas");
    const { company: second } = await makeCompany("Fabric Apparel");
    const party = (name: string, kind: "BUYER" | "SUPPLIER", code: string) =>
      prisma.party.create({
        data: { companyId: company.id, name, kind, code, openingBalance: 1250 },
      });
    await party("Northwind", "BUYER", "B-0001");
    await party("Gazipur Knit Composite", "SUPPLIER", "S-0001");
    await party("Noman Textile Mills", "SUPPLIER", "S-0002");
    const walkIn = await prisma.party.create({
      data: {
        companyId: company.id,
        name: "Walk-in customer",
        kind: "BUYER",
        code: "W-0001",
        systemRole: "WALK_IN",
      },
    });
    const category = await prisma.category.create({
      data: { companyId: company.id, name: "Polo", slug: "polo" },
    });
    await prisma.style.create({
      data: { companyId: company.id, categoryId: category.id, code: "PL-01", name: "Polo" },
    });
    for (const [i, name] of ["Navy", "White", "Red", "Green", "Grey", "Pink", "Black"].entries()) {
      await prisma.color.create({
        data: { companyId: company.id, name, hexCode: "#000000", sortOrder: i },
      });
    }
    await prisma.warehouse.create({ data: { companyId: company.id, name: "Main store" } });
    await makeUser("owner@long-names.test");
    await prisma.user.create({
      data: { email: `ai-${company.id}@ai.invalid`, name: "AI" },
    });
    return { company, second, walkIn };
  }

  it("gives the company, buyers, suppliers, styles, colours and stores long names", async () => {
    const { company, second, walkIn } = await setup();
    const counts = await lengthenNames();
    expect(counts.companies).toBeGreaterThanOrEqual(2);

    const [first, other] = await Promise.all([
      prisma.company.findUniqueOrThrow({ where: { id: company.id } }),
      prisma.company.findUniqueOrThrow({ where: { id: second.id } }),
    ]);
    expect(first.name).toBe("Extas Apparel Sourcing & Buying House Limited");
    expect(other.name).toBe(LONG_NAMES.companies[1]);

    const parties = await prisma.party.findMany({
      where: { companyId: company.id },
      orderBy: { code: "asc" },
    });
    const byCode = Object.fromEntries(parties.map((p) => [p.code, p]));
    expect(byCode["B-0001"]!.name).toBe(LONG_NAMES.buyers[0]);
    expect(byCode["S-0001"]!.name).toBe(LONG_NAMES.suppliers[0]);
    expect(byCode["S-0002"]!.name).toBe(LONG_NAMES.suppliers[1]);
    expect(byCode["S-0001"]!.contactPerson).toBe(LONG_NAMES.contact);
    // The walk-in customer the system keeps is left alone; amounts never change.
    expect((await prisma.party.findUniqueOrThrow({ where: { id: walkIn.id } })).name).toBe(
      "Walk-in customer",
    );
    expect(byCode["B-0001"]!.openingBalance.toString()).toBe("1250");

    const style = await prisma.style.findFirstOrThrow({ where: { companyId: company.id } });
    expect(style.name).toBe(LONG_NAMES.styles[0]);
    expect(style.code).toBe(`PL-01${LONG_NAMES.styleCode}`);

    const colours = await prisma.color.findMany({ where: { companyId: company.id } });
    expect(new Set(colours.map((c) => c.name)).size).toBe(7);
    expect(colours.map((c) => c.name)).toContain(`${LONG_NAMES.colours[0]} Unit 2`);

    const store = await prisma.warehouse.findFirstOrThrow({ where: { companyId: company.id } });
    expect(store.name).toBe(`Main store${LONG_NAMES.store}`);

    const people = await prisma.user.findMany();
    expect(people.find((u) => u.email === "owner@long-names.test")!.name).toBe(
      LONG_NAMES.people[0],
    );
    // Never the AI's own account.
    expect(people.find((u) => u.email.endsWith("@ai.invalid"))!.name).toBe("AI");
  });

  it("changes nothing more when it runs again", async () => {
    const { company } = await setup();
    await lengthenNames();
    const before = await prisma.color.findMany({ where: { companyId: company.id } });
    const style = await prisma.style.findFirstOrThrow({ where: { companyId: company.id } });
    await lengthenNames();
    const after = await prisma.color.findMany({ where: { companyId: company.id } });
    expect(after.map((c) => [c.id, c.name]).sort()).toEqual(
      before.map((c) => [c.id, c.name]).sort(),
    );
    expect((await prisma.style.findUniqueOrThrow({ where: { id: style.id } })).code).toBe(
      style.code,
    );
  });
});
