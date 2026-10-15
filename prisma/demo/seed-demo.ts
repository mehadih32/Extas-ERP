/**
 * Loads the demo site's database, after the migrations and prisma/seed.ts
 * (deploy/compose.yml, "demo-seed"; deploy/README.md, "The demo site"):
 *   1. the owner signs in to the demo with the same email and password as on the
 *      live ERP (deploy.sh copies the password hash, nothing else, from the live
 *      database);
 *   2. the first company in SEED_COMPANIES gets the Five Style Polo batch, once;
 *   3. and the four test bookings (./test-bookings.ts), once. Their numbers are
 *      printed as "Test booking" lines, which deploy.sh repeats in the Deploy log.
 *      A failure there is printed and the demo still starts;
 *   4. and the v6.2 sample order for Mehedi 2.0 (./v62-samples.ts), once, waiting
 *      for the owner's Approve (the AI stays off).
 * It stops, loading nothing, unless DEMO_SITE=on and the database is the demo's own.
 *   SEED_ADMIN_EMAIL          the owner's email
 *   DEMO_OWNER_PASSWORD_HASH  the owner's password hash on the live ERP
 *   SEED_COMPANIES            comma-separated company names (the first gets the batch)
 */
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";

import { POLO_BATCH } from "./five-style-polo";
import {
  assertDemoDatabase,
  loadFiveStylePoloDemo,
  loadTestBookingsDemo,
  loadV62SamplesDemo,
} from "./load-demo";

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

  try {
    const tests = await loadTestBookingsDemo(owner.id, company.id);
    for (const b of tests.bookings) {
      console.log(`✓ Test booking ${b.title}: ${b.number ?? "not made"}`);
    }
    for (const problem of tests.problems) console.log(`! Test booking not in stock: ${problem}`);
  } catch (error) {
    console.error("! Test booking: the four test bookings could not be made", error);
  }

  try {
    const sample = await loadV62SamplesDemo(owner.id, company.id);
    console.log(
      sample
        ? `✓ v6.2 sample order ${sample.order} with costing sheet ${sample.costing}, waiting for Approve`
        : "✓ The v6.2 sample order is there already",
    );
  } catch (error) {
    console.error("! v6.2 sample order: it could not be made", error);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
