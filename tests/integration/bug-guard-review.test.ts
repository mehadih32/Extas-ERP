import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * v6.4 fresh review, Bug Guard and security: what the reviewers found, each
 * with the rule it breaks.
 *   S1   alarms (Bug Guard, backups, Server Health) reach only the bot links of
 *        active platform owners; platform-wide alarms only the platform company.
 *   S3   a blocked place lets the platform owner in with the right password
 *        (the account lock still applies); nobody else.
 *   S4   a sign-in Bug Guard stopped never makes its place "known".
 *   S5/6 an adjusting entry is checked again when it is applied, under a lock,
 *        in the ERP's lock order, and the supplier's bills follow it.
 *   S8   a server error shows its own company's message only.
 *   S10  what Bug Guard sends by itself is logged as Bug Guard, not the owner.
 *   S11  Bug Guard's own reads are not counted as slow database calls.
 *   S12  the Full check is started on the main branch.
 *   S13  a SELECT that ends a session or takes a lock is refused in read-only work.
 *   L5   Bug Guard's night run gives the Full check a longer time.
 *   L12  the bot shows only counts for Help searches that found nothing.
 */

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { readOnly } from "@/lib/read-only";
import { slowQueriesSince } from "@/lib/slow-queries";
import { READ_ONLY_WHY } from "@/modules/bug-guard/runner";

import { makeCompany, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

async function refusedInside(work: () => Promise<unknown>) {
  // Awaited inside: a Prisma query starts only when it is awaited.
  const error = await readOnly(READ_ONLY_WHY, async () => await work()).then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "expected it to be refused").toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe("FORBIDDEN");
}

run("Bug Guard, after the review", () => {
  beforeEach(async () => {
    vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-0123456789");
    vi.stubEnv("APP_URL", "https://erp.test");
    vi.stubEnv("DEMO_SITE", "");
    await resetDb();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("reading only (S11, S13)", () => {
    it("refuses a SELECT with side effects, and never counts Bug Guard's own reads as slow", async () => {
      const { company } = await makeCompany("Extas");
      await refusedInside(() => prisma.$queryRawUnsafe("SELECT pg_advisory_xact_lock(1)"));
      await refusedInside(() =>
        prisma.$queryRawUnsafe("SELECT pg_terminate_backend(pg_backend_pid() + 100000)"),
      );
      expect((await prisma.company.findUniqueOrThrow({ where: { id: company.id } })).name).toBe(
        "Extas",
      );

      const since = new Date();
      await readOnly(READ_ONLY_WHY, async () => {
        await prisma.$queryRawUnsafe("SELECT 1 AS n FROM pg_sleep(1.05)");
      });
      expect(slowQueriesSince(since)).toEqual([]);
      await prisma.$queryRawUnsafe("SELECT 1 AS n FROM pg_sleep(1.05)");
      expect(slowQueriesSince(since)).toEqual([
        expect.objectContaining({ model: "RawSQL", operation: "$queryRawUnsafe" }),
      ]);
    });
  });
});
