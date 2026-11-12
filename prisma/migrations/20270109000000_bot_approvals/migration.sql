-- Release 5: approvals from Telegram. A person's own choice per store whether
-- the bot brings them what waits for their approval (no row: yes).
CREATE TABLE IF NOT EXISTS "BotApprovalSetting" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sendApprovals" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BotApprovalSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BotApprovalSetting_companyId_userId_key" ON "BotApprovalSetting"("companyId", "userId");
CREATE INDEX IF NOT EXISTS "BotApprovalSetting_userId_idx" ON "BotApprovalSetting"("userId");

ALTER TABLE "BotApprovalSetting" ADD CONSTRAINT "BotApprovalSetting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BotApprovalSetting" ADD CONSTRAINT "BotApprovalSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
