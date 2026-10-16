import { beforeEach, describe, expect, it } from "vitest";

/*
 * v6.4 A4: work that may only read. The Full check's sessions on the live
 * site, and Bug Guard's checks, run inside `readOnly`: every write through
 * Prisma is refused there (creates, updates, deletes, raw statements, inside
 * transactions and through the tenant-locked client alike), and nothing else
 * changes outside it.
 */

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { readOnly } from "@/lib/read-only";
import { tenantDb } from "@/lib/tenant-db";

import { makeCompany, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const WHY = "The Full check only reads on the live site";

async function refused(work: () => Promise<unknown>) {
  const error = await work().then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "expected the write to be refused").toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe("FORBIDDEN");
  expect((error as AppError).message).toContain(WHY);
}

run("Read-only work", () => {
  beforeEach(resetDb);

  it("refuses every write inside, reads as usual, and changes nothing outside", async () => {
    const { company } = await makeCompany("Extas");
    const db = tenantDb(company.id);
    await readOnly(WHY, async () => {
      expect((await prisma.company.findUniqueOrThrow({ where: { id: company.id } })).name).toBe(
        "Extas",
      );
      expect(await db.role.count()).toBeGreaterThan(0);
      expect(await prisma.$queryRawUnsafe<Array<{ n: number }>>('SELECT 1 AS "n"')).toEqual([
        { n: 1 },
      ]);
      await refused(() =>
        prisma.company.update({ where: { id: company.id }, data: { name: "Changed" } }),
      );
      await refused(() => prisma.company.updateMany({ data: { name: "Changed" } }));
      await refused(() => prisma.company.create({ data: { name: "Other", slug: "other" } }));
      await refused(() => prisma.company.createMany({ data: [{ name: "Other", slug: "other" }] }));
      await refused(() =>
        prisma.company.upsert({
          where: { id: company.id },
          create: { name: "Other", slug: "other" },
          update: { name: "Changed" },
        }),
      );
      await refused(() => prisma.role.deleteMany({ where: { companyId: company.id } }));
      await refused(() => db.role.updateMany({ data: { name: "Changed" } }));
      await refused(() => prisma.$executeRawUnsafe('UPDATE "Company" SET "name" = \'Changed\''));
      await refused(() =>
        prisma.$queryRawUnsafe('UPDATE "Company" SET "name" = \'Changed\' RETURNING "id"'),
      );
      await refused(() =>
        prisma.$transaction(async (tx) =>
          tx.company.update({ where: { id: company.id }, data: { name: "Changed" } }),
        ),
      );
    });
    expect((await prisma.company.findUniqueOrThrow({ where: { id: company.id } })).name).toBe(
      "Extas",
    );
    // Outside, writes go on as before.
    await prisma.company.update({ where: { id: company.id }, data: { name: "Extas BD" } });
    expect((await prisma.company.findUniqueOrThrow({ where: { id: company.id } })).name).toBe(
      "Extas BD",
    );
  });
});
