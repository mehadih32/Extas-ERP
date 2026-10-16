-- Backups go to Google Drive, locked with the owner's recovery key (v6.3 C):
-- the device sign-in, the key, how many to keep, the weekly test restore, and
-- what kind each run is (backup, update safety copy, test restore, restore).

-- CreateEnum
CREATE TYPE "BackupKind" AS ENUM ('BACKUP', 'SAFETY_COPY', 'TEST_RESTORE', 'RESTORE');

-- AlterTable
ALTER TABLE "BackupConfig" ADD COLUMN     "googleClientId" TEXT,
ADD COLUMN     "googleClientSecretRef" TEXT,
ADD COLUMN     "googleDeviceExpiresAt" TIMESTAMP(3),
ADD COLUMN     "googleDeviceRef" TEXT,
ADD COLUMN     "keepCount" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "recoveryKeyId" TEXT,
ADD COLUMN     "recoveryKeyMadeAt" TIMESTAMP(3),
ADD COLUMN     "recoveryKeyRef" TEXT,
ADD COLUMN     "recoveryKeySavedAt" TIMESTAMP(3),
ADD COLUMN     "testRestoreEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "testRestoreSchedule" TEXT NOT NULL DEFAULT '0 4 * * 6';

-- AlterTable
ALTER TABLE "BackupRun" ADD COLUMN     "checkedAt" TIMESTAMP(3),
ADD COLUMN     "keyId" TEXT,
ADD COLUMN     "kind" "BackupKind" NOT NULL DEFAULT 'BACKUP',
ADD COLUMN     "name" TEXT,
ADD COLUMN     "report" JSONB,
ADD COLUMN     "sourceName" TEXT;

