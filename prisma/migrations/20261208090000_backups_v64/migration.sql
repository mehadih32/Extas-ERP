-- Backups v6.4 (G1, G2, A9, G4, G5, G9, G10, G11): new columns only; nothing is
-- dropped, renamed or retyped. cronSchedule, keepCount, retentionDays,
-- recoveryKeyRef and testRestoreSchedule stay as they are.

-- CreateEnum
CREATE TYPE "BackupScheduleMode" AS ENUM ('HOURS', 'DAYS', 'WEEKLY', 'DATES');

-- AlterTable
ALTER TABLE "BackupConfig" ADD COLUMN     "alertProblem" TEXT,
ADD COLUMN     "alertSentAt" TIMESTAMP(3),
ADD COLUMN     "cloudflareCheckedAt" TIMESTAMP(3),
ADD COLUMN     "cloudflareTokenHint" TEXT,
ADD COLUMN     "cloudflareTokenRef" TEXT,
ADD COLUMN     "cloudflareZone" TEXT,
ADD COLUMN     "cloudflareZoneId" TEXT,
ADD COLUMN     "drillDay" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "drillTime" TEXT NOT NULL DEFAULT '04:00',
ADD COLUMN     "driveKeepDays" INTEGER DEFAULT 90,
ADD COLUMN     "earlierKeyPairs" JSONB,
ADD COLUMN     "guideBuiltAt" TIMESTAMP(3),
ADD COLUMN     "guideHash" TEXT,
ADD COLUMN     "keepKeyInDrive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "keyInDriveAt" TIMESTAMP(3),
ADD COLUMN     "keyPairId" TEXT,
ADD COLUMN     "keySetAt" TIMESTAMP(3),
ADD COLUMN     "legacyKeyId" TEXT,
ADD COLUMN     "legacyKeyRetiredAt" TIMESTAMP(3),
ADD COLUMN     "lockedKeyFile" TEXT,
ADD COLUMN     "publicKey" TEXT,
ADD COLUMN     "scheduleDates" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "scheduleEvery" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "scheduleMode" "BackupScheduleMode" DEFAULT 'DAYS',
ADD COLUMN     "scheduleStartDay" TEXT,
ADD COLUMN     "scheduleTimes" TEXT[] DEFAULT ARRAY['02:00', '14:00']::TEXT[],
ADD COLUMN     "scheduleWeekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "serverKeep" INTEGER NOT NULL DEFAULT 4;


-- A config still on v6.3's default (every day at 02:00) takes the new default:
-- every day at 02:00 and 14:00 (the column defaults above). A config whose
-- schedule the owner had changed keeps it: its mode is left empty, and the app
-- reads the old schedule once into the closest new one (schedule.ts, scheduleFromCron).
UPDATE "BackupConfig" SET "scheduleMode" = NULL WHERE "cronSchedule" <> '0 2 * * *';
