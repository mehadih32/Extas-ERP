-- AI Center > Agents (switch an agent off) and Skills (taught in plain words, versioned, tested). Only adds.
-- AlterTable
ALTER TABLE "AiSettings" ADD COLUMN     "agentsOff" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "AiSkill" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "on" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSkillVersion" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "whenToUse" TEXT NOT NULL,
    "steps" TEXT NOT NULL,
    "dos" TEXT,
    "donts" TEXT,
    "examples" JSONB NOT NULL,
    "notes" TEXT,
    "files" JSONB,
    "change" TEXT,
    "testStatus" TEXT,
    "testError" TEXT,
    "testedAt" TIMESTAMP(3),
    "testModel" TEXT,
    "passed" BOOLEAN,
    "testResult" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSkillVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiSkill_companyId_agent_idx" ON "AiSkill"("companyId", "agent");

-- CreateIndex
CREATE INDEX "AiSkillVersion_companyId_skillId_idx" ON "AiSkillVersion"("companyId", "skillId");

-- CreateIndex
CREATE UNIQUE INDEX "AiSkillVersion_skillId_version_key" ON "AiSkillVersion"("skillId", "version");

-- AddForeignKey
ALTER TABLE "AiSkill" ADD CONSTRAINT "AiSkill_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSkillVersion" ADD CONSTRAINT "AiSkillVersion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSkillVersion" ADD CONSTRAINT "AiSkillVersion_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "AiSkill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSkillVersion" ADD CONSTRAINT "AiSkillVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

