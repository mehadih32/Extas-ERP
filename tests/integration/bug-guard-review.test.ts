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
import { saveGitHub } from "@/modules/ai/full-check/full-check.service";
import { prisma } from "@/lib/prisma";
import { readOnly } from "@/lib/read-only";
import { slowQueriesSince } from "@/lib/slow-queries";
import { summaryText } from "@/modules/bug-guard/bot-texts";
import { APP_CHECKS } from "@/modules/bug-guard/checks/app";
import { PRODUCT_CHECKS } from "@/modules/bug-guard/checks/product";
import { READ_ONLY_WHY } from "@/modules/bug-guard/runner";
import type { CheckContext } from "@/modules/bug-guard/types";

import { startFakeGitHub } from "../fixtures/fake-github";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** Runs one of Bug Guard's real checks for a company, only reading. */
function check(key: string, companyId: string, extra: Partial<CheckContext> = {}) {
  const found = [...APP_CHECKS, ...PRODUCT_CHECKS].find((c) => c.key === key)!;
  const now = new Date();
  return readOnly(READ_ONLY_WHY, () =>
    found.run({
      companyId,
      now,
      since: new Date(now.getTime() - 86_400_000),
      platform: false,
      db: prisma,
      ...extra,
    }),
  );
}

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

  describe("server errors (S8)", () => {
    it("show the company's own error message and stack, never another company's", async () => {
      const { company: mine } = await makeCompany("Extas");
      const { company: theirs } = await makeCompany("Other Store");
      const error = (companyId: string, at: Date, message: string, stack: string) =>
        prisma.serverError.create({
          data: {
            companyId,
            at,
            routeType: "render",
            method: "GET",
            path: "/sales/orders/[id]",
            errorName: "TypeError",
            message,
            stack: [stack],
            errorId: companyId === mine.id ? "ERR-MINE" : "ERR-THEIRS",
          },
        });
      await error(mine.id, new Date(Date.now() - 60 * 60_000), "Our own message", "at ours");
      // The other store's error is newer: it must not be shown to this store.
      await error(theirs.id, new Date(Date.now() - 60_000), "Their private message", "at theirs");
      const [finding] = await check("app.server-errors", mine.id);
      expect(finding!.evidence).toEqual(
        expect.arrayContaining([
          { label: "বার্তা", value: "Our own message" },
          { label: "এরর কোড", value: "ERR-MINE" },
        ]),
      );
      expect(JSON.stringify(finding)).not.toMatch(/Their private|at theirs|ERR-THEIRS/);
      expect(finding!.code?.stack).toEqual(["at ours"]);
    });
  });

  describe("the Full check (S12)", () => {
    it("is started on the main branch, the only one whose proof the ERP takes", async () => {
      const gh = await startFakeGitHub("extas/erp");
      try {
        vi.stubEnv("GITHUB_API_URL", gh.url);
        vi.stubEnv("GITHUB_OIDC_ISSUER", gh.issuer);
        const { company, roles } = await makeCompany("Extas");
        const user = await makeUser("owner@extas.test", { isSuperAdmin: true });
        await addToCompany(user.id, company.id, roles.SUPER_ADMIN);
        const owner = await contextFor(user.id, company.id);
        await saveGitHub(owner, { repo: "extas/erp", token: gh.token });
        // Someone made another branch the default on GitHub.
        gh.state.defaultBranch = "develop";
        const { startFullCheck } = await import("@/modules/ai/full-check/full-check.service");
        await startFullCheck(owner);
        const dispatch = gh.calls.find((c) => c.path.endsWith("/full-check.yml/dispatches"))!;
        expect(dispatch.body).toMatchObject({ ref: "main" });
      } finally {
        await gh.close();
      }
    });
  });

  describe("Help searches that found nothing (L12)", () => {
    it("reach the bot as counts only; the words stay in the ERP for the owner", async () => {
      const { company } = await makeCompany("Extas");
      const { localDay } = await import("@/lib/dates");
      const day = localDay(new Date(), "Asia/Dhaka");
      for (const [subject, count] of [
        ["karim traders due", 3],
        ["lc margin rahim", 2],
      ] as const) {
        await prisma.usageCount.create({
          data: { companyId: company.id, day, kind: "HELP_MISS", subject, count },
        });
      }
      const [finding] = await check("product.help-misses", company.id);
      expect(finding!.title).not.toMatch(/karim|rahim|traders|margin/);
      expect(finding!.title).toMatch(/2টি/);
      expect(finding!.title).toMatch(/5 বার/);
      // The words are in the evidence: shown on the Bug Guard screen, not on the bot.
      expect(finding!.evidence).toEqual(
        expect.arrayContaining([{ label: "karim traders due", value: "3 বার" }]),
      );
      const report = summaryText(
        {
          company: "Extas",
          at: new Date(),
          checked: 1,
          failedChecks: [],
          newCount: 1,
          fixedCount: 0,
          open: [
            { severity: finding!.severity, title: finding!.title, href: finding!.href ?? null },
          ],
        },
        "https://erp.test",
      );
      expect(report).not.toMatch(/karim|rahim/);
    });
  });
});
