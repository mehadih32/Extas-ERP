-- v6.4.1: the last restore drill on a new server, shown on the Backups screen.
-- Additive only: one nullable column.
ALTER TABLE "BackupConfig" ADD COLUMN "lastServerDrill" JSONB;
