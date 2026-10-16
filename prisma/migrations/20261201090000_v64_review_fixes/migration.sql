-- v6.4 A: the reviewer's findings on v6.3. Only new columns and a new
-- permission; nothing is changed or removed.

-- A1: a fix counts as ready only when it is Claude Code's own work for that
-- issue, from a branch in this repository, into main; the owner sees who
-- opened it and the files it changes before Merge.
ALTER TABLE "ClaudeCodeRequest" ADD COLUMN     "prAuthor" TEXT,
ADD COLUMN     "prFiles" JSONB,
ADD COLUMN     "prOpenedByErp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "prProblem" TEXT,
ADD COLUMN     "prVetted" BOOLEAN NOT NULL DEFAULT false;

-- A2: what may go into a GitHub issue: the status code, the error's type and
-- stack lines from the ERP's own code (never screen text or business data).
ALTER TABLE "FullCheckProblem" ADD COLUMN     "errorType" TEXT,
ADD COLUMN     "stack" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "status" INTEGER;

-- A4: the Full check's sessions belong to its own check account and carry the
-- role (and, for the owner's view, the platform view) they check.
ALTER TABLE "Session" ADD COLUMN     "checkPlatform" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "checkRoleId" TEXT;

-- A10: approving collar, cuff and trims bookings before the tech pack is
-- approved is the owner's, or whoever the owner gives this permission. No role
-- is given it; Super Admin holds every permission in code.
INSERT INTO "Permission" ("id", "key", "module", "description")
VALUES
  (gen_random_uuid()::text, 'production.bookings.override', 'PRODUCTION',
   'Approve collar, cuff and trims bookings before the tech pack is approved, with a reason (the owner''s)')
ON CONFLICT ("key") DO NOTHING;
