/**
 * Seeds the minimum data needed to sign in:
 *   1. the permission catalogue,
 *   2. the companies (default: "Extras" and "Fabric Apparel") with the built-in roles
 *      (Super Admin, Production Manager, Sales Executive, Warehouse Team, Employee, Accounts),
 *   3. the platform owner account, as Super Admin of every seeded company,
 *   4. per company: the default size run (S to 3XL), a "Main Warehouse", the control
 *      ledger accounts and the default production cost heads (Fabric, Sewing (CM)...).
 *
 * Safe to run repeatedly. Usage: `npm run db:seed`
 *   SEED_ADMIN_EMAIL     owner email (required)
 *   SEED_ADMIN_PASSWORD  owner password (optional; a temporary one is printed if omitted)
 *   SEED_ADMIN_NAME      owner display name (default "Super Admin")
 *   SEED_COMPANIES       comma-separated company names
 */
import { generateTemporaryPassword, hashPassword } from "../src/lib/auth/password";
import { prisma } from "../src/lib/prisma";
import { slugify } from "../src/lib/slug";
import { ensureControlAccounts } from "../src/modules/accounts/control-accounts";
import { DEFAULT_SIZES } from "../src/modules/inventory/catalog.service";
import { DEFAULT_WAREHOUSE_NAME } from "../src/modules/inventory/stock.service";
import { ensureProductionCostHeads } from "../src/modules/production/cost.service";
import { ensureSystemRoles, syncPermissionCatalog } from "../src/modules/rbac/role.service";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error("Set SEED_ADMIN_EMAIL in .env before seeding.");
  const companyNames = (process.env.SEED_COMPANIES ?? "Extras,Fabric Apparel")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

  await syncPermissionCatalog();
  console.log("✓ Permission catalogue synced");

  let admin = await prisma.user.findUnique({ where: { email } });
  let printedPassword: string | undefined;
  if (!admin) {
    const password = process.env.SEED_ADMIN_PASSWORD || generateTemporaryPassword();
    if (!process.env.SEED_ADMIN_PASSWORD) printedPassword = password;
    admin = await prisma.user.create({
      data: {
        email,
        name: process.env.SEED_ADMIN_NAME?.trim() || "Super Admin",
        passwordHash: await hashPassword(password),
        isSuperAdmin: true,
        mustChangePassword: !process.env.SEED_ADMIN_PASSWORD,
      },
    });
    console.log(`✓ Created platform owner ${email}`);
  } else if (!admin.isSuperAdmin) {
    admin = await prisma.user.update({ where: { id: admin.id }, data: { isSuperAdmin: true } });
    console.log(`✓ Promoted ${email} to platform owner`);
  }

  for (const name of companyNames) {
    const slug = slugify(name, "company");
    const company =
      (await prisma.company.findUnique({ where: { slug } })) ??
      (await prisma.company.create({ data: { name, slug } }));
    const roles = await ensureSystemRoles(company.id);
    await prisma.companyMembership.upsert({
      where: { companyId_userId: { companyId: company.id, userId: admin.id } },
      create: { companyId: company.id, userId: admin.id, roleId: roles.SUPER_ADMIN },
      update: {},
    });
    if ((await prisma.size.count({ where: { companyId: company.id } })) === 0) {
      await prisma.size.createMany({
        data: DEFAULT_SIZES.map((size, sortOrder) => ({
          companyId: company.id,
          name: size,
          sortOrder,
        })),
      });
    }
    await prisma.warehouse.upsert({
      where: { companyId_name: { companyId: company.id, name: DEFAULT_WAREHOUSE_NAME } },
      create: { companyId: company.id, name: DEFAULT_WAREHOUSE_NAME, isDefault: true },
      update: {},
    });
    await ensureControlAccounts(company.id);
    await ensureProductionCostHeads(company.id);
    console.log(
      `✓ Company "${name}" ready with built-in roles, sizes, warehouse, ledger accounts and cost heads`,
    );
  }

  if (printedPassword) {
    console.log(`\nTemporary password for ${email}: ${printedPassword}`);
    console.log("You will be asked to change it after signing in.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
