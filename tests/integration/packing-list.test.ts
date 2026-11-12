import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as packing from "@/modules/inventory/packing-list.service";
import { readCsv } from "@/modules/inventory/packing-list/readers";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import type { IntakeParser } from "@/modules/production/ai-intake";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

/*
 * "Upload packing list" without AI (2026-11-12): the pieces reach stock only
 * through the stock path Products already uses (opening stock), inside the
 * company; a new style can be made from the list in the same window; each
 * factory's columns and colour spellings are remembered for its next list;
 * "Read with AI" says plainly that AI is off. Only those who may add stock
 * (inventory.manage) can do any of it, checked in the service as well.
 */

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

async function setup(name: string) {
  const { company, roles } = await makeCompany(name);
  const member = async (role: keyof typeof roles, who: string) => {
    const user = await makeUser(`${who}@${company.slug}.test`);
    await addToCompany(user.id, company.id, roles[role]);
    return contextFor(user.id, company.id);
  };
  const ctx = await member("SUPER_ADMIN", "owner");
  const sales = await member("SALES_EXECUTIVE", "sales");
  const s = await catalog.createSize(ctx, { name: "S" });
  const m = await catalog.createSize(ctx, { name: "M" });
  const navy = await catalog.createColor(ctx, { name: "Navy", hexCode: "#1F2A44" });
  const anthracite = await catalog.createColor(ctx, { name: "Anthracite", hexCode: "#383E42" });
  const tops = await catalog.createCategory(ctx, { name: "Tops" });
  const style = await styles.createStyle(ctx, {
    code: "HZ-01",
    name: "Hoody zip",
    categoryId: tops.id,
  });
  await matrix.generateMatrix(ctx, style.id, { colorIds: [navy.id], sizeIds: [s.id, m.id] });
  return { company, ctx, sales, sizes: { s, m }, colours: { navy, anthracite }, tops, style };
}

run("Upload packing list (without AI)", () => {
  beforeEach(resetDb);

  it("adds the pieces as opening stock through the stock count's own path", async () => {
    const { ctx, style, colours, sizes } = await setup("Extas");
    const summary = await packing.addPackingListStock(ctx, {
      styleId: style.id,
      unitCost: 250,
      note: "Packing list from Rahman Knit",
      cells: [
        { colorId: colours.navy.id, sizeId: sizes.s.id, pieces: 20 },
        { colorId: colours.navy.id, sizeId: sizes.m.id, pieces: 52 },
      ],
    });
    expect(summary).toEqual({ changed: 2, added: 72, removed: 0 });
    const movements = await prisma.stockMovement.findMany({
      where: { companyId: ctx.company.id },
      orderBy: { quantity: "asc" },
    });
    expect(movements.map((m) => [m.type, m.quantity, m.note])).toEqual([
      ["OPENING", 20, "Packing list from Rahman Knit"],
      ["OPENING", 52, "Packing list from Rahman Knit"],
    ]);
    // Opening stock comes in as one numbered batch, valued in the books at the cost given.
    expect(new Set(movements.map((m) => m.lotId)).size).toBe(1);
    const journal = await prisma.journalEntry.findMany({
      where: { companyId: ctx.company.id, sourceType: "STOCK_ADJUSTMENT" },
      include: { lines: true },
    });
    const debit = journal.flatMap((j) => j.lines).reduce((s, l) => s + Number(l.debit), 0);
    expect(debit).toBe(72 * 250);
    const onHand = await stock.stockByVariant(
      ctx,
      movements.map((m) => m.variantId),
    );
    expect([...onHand.values()].reduce((s, c) => s + c.aGrade, 0)).toBe(72);
  });

  it("stays inside the company and needs the right to add stock", async () => {
    const one = await setup("Extas");
    const other = await setup("Other Co");
    const cell = { colorId: one.colours.navy.id, sizeId: one.sizes.s.id, pieces: 5 };
    // Another company's style is not there at all.
    await expect(
      packing.addPackingListStock(other.ctx, { styleId: one.style.id, cells: [cell] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // A colour and size not on the style are refused, not invented.
    await expect(
      packing.addPackingListStock(one.ctx, {
        styleId: one.style.id,
        cells: [{ ...cell, colorId: one.colours.anthracite.id }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    // Sales can see stock but not add it: refused in the service too.
    await expect(
      packing.addPackingListStock(one.sales, { styleId: one.style.id, cells: [cell] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(packing.getPackingListSetup(one.sales)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      packing.readPackingList(one.sales, { bytes: new Uint8Array([1]), fileName: "x.csv" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.stockMovement.count()).toBe(0);
  });

  it("makes a new style from the list in the same window, reusing colours and sizes it has", async () => {
    const { ctx, tops, colours, sizes } = await setup("Extas");
    const made = await packing.preparePackingStyle(ctx, {
      style: { mode: "NEW", code: "MASH-1", name: "Mash", categoryId: tops.id },
      colours: [
        { colorId: colours.anthracite.id, name: "Anthracite" },
        { name: "Orange" },
        { name: "navy" },
      ],
      sizes: [{ sizeId: sizes.m.id, name: "M" }, { name: "3XL" }, { name: "xxxl" }],
    });
    const style = await prisma.style.findUniqueOrThrow({
      where: { id: made.styleId },
      include: { variants: { include: { color: true, size: true } } },
    });
    expect(style.code).toBe("MASH-1");
    // "navy" is the Navy already there; "xxxl" is 3XL: no colour or size is made twice.
    expect(made.colourIds.navy).toBe(colours.navy.id);
    expect(made.sizeIds.xxxl).toBe(made.sizeIds["3XL"]);
    expect(await prisma.color.count({ where: { companyId: ctx.company.id } })).toBe(3);
    expect(new Set(style.variants.map((v) => `${v.color.name}/${v.size.name}`))).toEqual(
      new Set(["Anthracite/M", "Anthracite/3XL", "Orange/M", "Orange/3XL", "Navy/M", "Navy/3XL"]),
    );
    // Then its pieces go straight in.
    await packing.addPackingListStock(ctx, {
      styleId: style.id,
      cells: [{ colorId: made.colourIds.Orange!, sizeId: made.sizeIds["3XL"]!, pieces: 7 }],
    });
    expect(await prisma.stockMovement.count({ where: { companyId: ctx.company.id } })).toBe(1);
  });

  it("remembers a factory's columns and colour spellings for its next list, per company", async () => {
    const one = await setup("Extas");
    const other = await setup("Other Co");
    const csv = readFileSync("tests/fixtures/packing-lists/grid.csv");
    const sheet = readCsv(csv);
    const first = await packing.readPackingList(
      one.ctx,
      { bytes: csv, fileName: "list.csv" },
      { source: "Rahman Knit" },
      { sheets: [sheet], photoText: null },
    );
    expect(first.layoutFrom).toBe("FOUND");
    expect(first.text).toContain("Navy Blue - 10 - 20 - 30 = 60");
    await packing.rememberPackingSource(one.ctx, {
      source: "Rahman Knit",
      layout: {
        kind: "GRID",
        style: null,
        colour: "COLOR",
        size: null,
        pieces: null,
        sizeHeaders: ["S", "M", "L", "XL"],
      },
      colours: { "Navy Blue": one.colours.navy.id, ANTRA: one.colours.anthracite.id },
    });
    const again = await packing.readPackingList(
      one.ctx,
      { bytes: csv, fileName: "list.csv" },
      { source: "rahman knit" },
      { sheets: [sheet], photoText: null },
    );
    expect(again.layoutFrom).toBe("SAVED");
    expect(again.source?.colours).toEqual({
      NAVYBLUE: one.colours.navy.id,
      ANTRA: one.colours.anthracite.id,
    });
    // Another company never sees it, and cannot point it at its colours.
    const theirs = await packing.readPackingList(
      other.ctx,
      { bytes: csv, fileName: "list.csv" },
      { source: "Rahman Knit" },
      { sheets: [sheet], photoText: null },
    );
    expect(theirs.source).toBeNull();
    await packing.rememberPackingSource(other.ctx, {
      source: "Rahman Knit",
      colours: { NAVY: one.colours.navy.id },
    });
    const kept = await prisma.packingListSource.findFirstOrThrow({
      where: { companyId: other.company.id },
    });
    expect(kept.colours).toEqual({});
  });

  it("says plainly that Read with AI needs AI on, and turns the AI's lines into the same text", async () => {
    const { ctx } = await setup("Extas");
    const photo = {
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      fileName: "a.jpg",
      mimeType: "image/jpeg",
    };
    await expect(packing.readPackingListWithAi(ctx, photo, null)).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: expect.stringMatching(/AI reading is off.*without AI/),
    });
    const reader: IntakeParser = {
      parse: async () => ({
        lines: [
          {
            sku: null,
            styleCode: "HZ-01",
            color: "Navy",
            size: "S",
            quantity: 3,
            grade: "A_GRADE",
          },
          {
            sku: null,
            styleCode: "HZ-01",
            color: "Navy",
            size: "M",
            quantity: 4,
            grade: "A_GRADE",
          },
          {
            sku: null,
            styleCode: "HZ-01",
            color: "Navy",
            size: "M",
            quantity: 2,
            grade: "B_GRADE",
          },
        ],
        confidence: 0.6,
        notes: null,
        model: "test",
      }),
    };
    const read = await packing.readPackingListWithAi(ctx, photo, reader);
    expect(read.text).toBe("Style: HZ-01\nS M\nNavy - 3 - 4");
    expect(read.notes.join(" ")).toMatch(/2 B-grade pieces were left out/);
  });
});
