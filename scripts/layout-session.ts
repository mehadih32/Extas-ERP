/**
 * A session for the layout checks (scripts/full-check/layout-run.mjs), made the way
 * scripts/check-update.ts makes its own: for the owner (SEED_ADMIN_EMAIL) in their
 * first company, lasting two hours. GitHub's layout check runs it on a throwaway
 * copy of the demo site's database (.github/workflows/layout-checks.yml).
 *
 * It only runs on a database made for checks: a copy whose name starts with
 * extras_layout or extras_erp_ui; never the live ERP's nor the demo site's. GitHub's
 * layout check loads the demo data into a throwaway database that must be called
 * extras_demo (prisma/demo/load-demo.ts); only there, on GitHub with
 * LAYOUT_THROWAWAY_DB=yes, is that name accepted.
 *   SEED_ADMIN_EMAIL     whose screens to check (the owner)
 *   LAYOUT_LOOK          LEGACY (the top menu, the default) or MODERN (the side menu):
 *                        the look the owner's screens are checked in
 *   LAYOUT_SESSION_FILE  where to write the session (the extras_session cookie's value)
 */
import { writeFileSync } from "node:fs";

import { generateSessionToken, hashSessionToken } from "@/lib/auth/token";
import { prisma } from "@/lib/prisma";

/**
 * The databases a check session may be made in: a copy made for checks, or GitHub's
 * throwaway copy of the demo data (named like the demo site's own, extras_demo).
 */
export function isCheckDatabase(
  name: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (name === "extras_demo") {
    return env.GITHUB_ACTIONS === "true" && env.LAYOUT_THROWAWAY_DB === "yes";
  }
  return /^extras_(layout|erp_ui)\w*$/.test(name ?? "");
}

async function main() {
  const [db] = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  if (!isCheckDatabase(db?.name)) {
    throw new Error(`Not a database made for checks (${db?.name ?? "unknown"}): no session made.`);
  }
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const file = process.env.LAYOUT_SESSION_FILE;
  if (!email || !file) throw new Error("Set SEED_ADMIN_EMAIL and LAYOUT_SESSION_FILE.");
  const look = process.env.LAYOUT_LOOK === "MODERN" ? "MODERN" : "LEGACY";

  const owner = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true, memberships: { select: { companyId: true }, take: 1 } },
  });
  const companyId = owner.memberships[0]?.companyId;
  if (!companyId) throw new Error("The owner is in no company yet.");
  await prisma.user.update({ where: { id: owner.id }, data: { mustChangePassword: false } });
  await prisma.userPreference.upsert({
    where: { userId: owner.id },
    create: { userId: owner.id, interfaceStyle: look },
    update: { interfaceStyle: look },
  });
  const token = generateSessionToken();
  await prisma.session.create({
    data: {
      userId: owner.id,
      token: hashSessionToken(token),
      activeCompanyId: companyId,
      userAgent: "Extas ERP layout check",
      expiresAt: new Date(Date.now() + 2 * 60 * 60_000),
    },
  });
  writeFileSync(file, token, { mode: 0o600 });
  console.log(
    `A session for the owner is ready (${look === "MODERN" ? "side menu" : "top menu"}).`,
  );
}

if (process.argv[1]?.endsWith("layout-session.ts")) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
