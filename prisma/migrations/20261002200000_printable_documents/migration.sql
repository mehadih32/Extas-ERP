-- Printable letterhead documents: the uploaded company logo, and stored PDFs
-- keyed by what they show so unchanged documents are not made twice.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "logoFileId" TEXT;

-- AlterTable
ALTER TABLE "GeneratedDocument" ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "options" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "Company_logoFileId_key" ON "Company"("logoFileId");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedDocument_companyId_contentHash_key" ON "GeneratedDocument"("companyId", "contentHash");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_logoFileId_fkey" FOREIGN KEY ("logoFileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The blank letterhead pad permission. New companies get the grants from
-- DEFAULT_ROLE_PERMISSIONS and `npm run db:seed` keeps the catalogue in sync; this
-- registers the key in databases that already exist.
INSERT INTO "Permission" ("id", "key", "module", "description")
VALUES
  (gen_random_uuid()::text, 'documents.letterhead', 'TEMPLATES',
   'Print the blank company letterhead pad')
ON CONFLICT ("key") DO NOTHING;

-- Default grants for built-in roles that already exist: the people who write
-- official letters (Sales, Accounts and Production managers).
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."key" = 'documents.letterhead'
WHERE r."systemRole" IN ('SALES_EXECUTIVE', 'ACCOUNTS', 'PRODUCTION_MANAGER')
ON CONFLICT DO NOTHING;
