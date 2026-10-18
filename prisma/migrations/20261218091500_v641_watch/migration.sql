-- v6.4.1: the check after each update, and the late-backup alert on GitHub.
-- Additive only: nothing existing changes.
--   * Bug Guard's run after an update (deploy.sh asks for it once the new
--     version is up) is marked as such.
--   * The Backups screen remembers when the late-backup alert on GitHub was set
--     up and on which repository (never the values it sent: GitHub keeps them).

-- AlterEnum
ALTER TYPE "BugGuardTrigger" ADD VALUE 'AFTER_DEPLOY';

-- AlterTable
ALTER TABLE "BackupConfig" ADD COLUMN     "githubAlertRepo" TEXT,
ADD COLUMN     "githubAlertAt" TIMESTAMP(3);
