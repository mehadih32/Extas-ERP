-- v6.4.1: wrong passwords no longer lock an account; they slow down only the
-- place they come from. The owner (or anyone) can unlock sign-in from their own
-- mailbox with a link that works once, for 30 minutes: only its token's hash is
-- kept, with its time. Additive: two columns that may be empty.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "unlockTokenHash" TEXT,
ADD COLUMN     "unlockTokenUntil" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_unlockTokenHash_key" ON "User"("unlockTokenHash");
