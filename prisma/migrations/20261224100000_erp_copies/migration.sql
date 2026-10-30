-- Sharing the Google client with sold copies by a one-time copy code (additive only).
ALTER TABLE "BackupConfig" ADD COLUMN "googleClientFrom" TEXT;
ALTER TABLE "BackupConfig" ADD COLUMN "copyId" TEXT;
ALTER TABLE "BackupConfig" ADD COLUMN "copySecretRef" TEXT;
ALTER TABLE "BackupConfig" ADD COLUMN "copyCheckedAt" TIMESTAMP(3);
ALTER TABLE "BackupConfig" ADD COLUMN "copyBlockedAt" TIMESTAMP(3);

CREATE TABLE "ErpCopy" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeExpiresAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "address" TEXT,
    "tokenHash" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "driveConnected" BOOLEAN NOT NULL DEFAULT false,
    "blockedAt" TIMESTAMP(3),
    "blockedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErpCopy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ErpCopy_codeHash_key" ON "ErpCopy"("codeHash");
CREATE UNIQUE INDEX "ErpCopy_tokenHash_key" ON "ErpCopy"("tokenHash");
CREATE INDEX "ErpCopy_address_idx" ON "ErpCopy"("address");
