-- "Upload packing list" without AI (2026-11-12): each factory's or supplier's column
-- names and colour spellings, remembered for its next list. Additive only.
CREATE TABLE "PackingListSource" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "layout" JSONB,
    "colours" JSONB NOT NULL DEFAULT '{}',
    "uses" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PackingListSource_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PackingListSource_companyId_key_key" ON "PackingListSource"("companyId", "key");
CREATE INDEX "PackingListSource_companyId_updatedAt_idx" ON "PackingListSource"("companyId", "updatedAt");
ALTER TABLE "PackingListSource" ADD CONSTRAINT "PackingListSource_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
