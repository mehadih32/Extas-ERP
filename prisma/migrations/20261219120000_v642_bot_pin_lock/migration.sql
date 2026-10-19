-- v6.4.2: after 20 wrong PINs to the bot in a day, PIN actions on the bot stop
-- until the owner unlocks them in the ERP (AI Center > Bot, with the PIN). Only
-- the time it stopped is kept, never a PIN. Additive: one column that may be empty.

-- AlterTable
ALTER TABLE "AiSettings" ADD COLUMN     "botPinLockedAt" TIMESTAMP(3);
