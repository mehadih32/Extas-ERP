/**
 * Loads the demo site's database, after the migrations and prisma/seed.ts
 * (deploy/compose.yml, "demo-seed"; deploy/README.md, "The demo site"):
 *   1. the owner signs in to the demo with the same email and password as on the
 *      live ERP (deploy.sh copies the password hash, nothing else, from the live
 *      database);
 *   2. the first company in SEED_COMPANIES gets the Five Style Polo batch, once.
 * It stops, loading nothing, unless DEMO_SITE=on and the database is the demo's own.
 *   SEED_ADMIN_EMAIL          the owner's email
 *   DEMO_OWNER_PASSWORD_HASH  the owner's password hash on the live ERP
 *   SEED_COMPANIES            comma-separated company names (the first gets the batch)
 */
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";

import { POLO_BATCH } from "./five-style-polo";
import { assertDemoDatabase, loadFiveStylePoloDemo } from "./load-demo";

async function main() {
  await assertDemoDatabase();
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error("Set SEED_ADMIN_EMAIL in deploy/.env first.");
  const passwordHash = process.env.DEMO_OWNER_PASSWORD_HASH?.trim();
  if (!passwordHash) {
    throw new Error("DEMO_OWNER_PASSWORD_HASH is empty: deploy.sh copies it from the live ERP.");
  }
  const owner = await prisma.user.update({
    where: { email },
    data: { passwordHash, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null },
  });
  console.log(`✓ ${email} signs in to the demo with the live ERP's password`);

  const companyName = (process.env.SEED_COMPANIES ?? "Extas").split(",")[0]!.trim() || "Extas";
  const company = await prisma.company.findUniqueOrThrow({
    where: { slug: slugify(companyName, "company") },
  });
  const loaded = await loadFiveStylePoloDemo(owner.id, company.id);
  console.log(
    loaded
      ? `✓ Loaded the ${POLO_BATCH} batch (${loaded.batchCode}) into ${company.name}`
      : `✓ The ${POLO_BATCH} batch is in ${company.name} already`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
