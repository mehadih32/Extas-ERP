-- "Walk-in customers": the books account of every sale without a buyer profile
-- (counter sales, and website or social orders taken by name only), so every
-- receivable, payable and customer advance line in the books names an account.

-- CreateEnum
CREATE TYPE "PartySystemRole" AS ENUM ('WALK_IN');

-- AlterTable
ALTER TABLE "Party" ADD COLUMN     "systemRole" "PartySystemRole";

-- CreateIndex
CREATE UNIQUE INDEX "Party_companyId_systemRole_key" ON "Party"("companyId", "systemRole");

-- Backfill
-- Walk-in sales used to post their receivable and advance lines without naming an
-- account. They were the only lines that could (hand-written vouchers must name a
-- buyer or supplier), so each company with such lines gets its Walk-in customers
-- account now, and those lines name it.
INSERT INTO "Party" ("id", "companyId", "code", "kind", "buyerType", "name", "notes", "systemRole", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text,
       c."companyId",
       CASE
         WHEN EXISTS (SELECT 1 FROM "Party" p WHERE p."companyId" = c."companyId" AND p."code" = 'WALK-IN')
           THEN 'WALK-IN-' || upper(substr(md5(random()::text), 1, 6))
         ELSE 'WALK-IN'
       END,
       'BUYER',
       'RETAIL',
       'Walk-in customers',
       'Kept by the system: the books account of every sale without a buyer profile.',
       'WALK_IN',
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT je."companyId"
  FROM "JournalLine" jl
  JOIN "JournalEntry" je ON je."id" = jl."entryId"
  JOIN "LedgerAccount" la ON la."id" = jl."accountId"
  WHERE jl."partyId" IS NULL
    AND la."subType" IN ('ACCOUNTS_RECEIVABLE', 'CUSTOMER_ADVANCE')
) c
ON CONFLICT DO NOTHING;

UPDATE "JournalLine" jl
SET "partyId" = p."id"
FROM "JournalEntry" je, "LedgerAccount" la, "Party" p
WHERE je."id" = jl."entryId"
  AND la."id" = jl."accountId"
  AND p."companyId" = je."companyId"
  AND p."systemRole" = 'WALK_IN'
  AND jl."partyId" IS NULL
  AND la."subType" IN ('ACCOUNTS_RECEIVABLE', 'CUSTOMER_ADVANCE');
