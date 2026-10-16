-- AlterTable
ALTER TABLE "AiBudget" ADD COLUMN     "providerLimits" JSONB;

-- AlterTable
ALTER TABLE "AiSettings" ADD COLUMN     "agentModels" JSONB,
ADD COLUMN     "geminiKeyHint" TEXT,
ADD COLUMN     "geminiKeySealed" TEXT,
ADD COLUMN     "geminiKeySetAt" TIMESTAMP(3),
ADD COLUMN     "keyTests" JSONB,
ADD COLUMN     "openaiKeyHint" TEXT,
ADD COLUMN     "openaiKeySealed" TEXT,
ADD COLUMN     "openaiKeySetAt" TIMESTAMP(3),
ADD COLUMN     "providerModels" JSONB;

-- AlterTable
ALTER TABLE "AiUsage" ADD COLUMN     "costKnown" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'anthropic';

-- CreateTable
CREATE TABLE "AiModelPrice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "inputPerM" DECIMAL(12,4),
    "outputPerM" DECIMAL(12,4),
    "cacheReadPerM" DECIMAL(12,4),
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiModelPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiModelTest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "right" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "details" JSONB,
    "error" TEXT,
    "ranById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiModelTest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiModelPrice_companyId_model_key" ON "AiModelPrice"("companyId", "model");

-- CreateIndex
CREATE INDEX "AiModelTest_companyId_task_model_createdAt_idx" ON "AiModelTest"("companyId", "task", "model", "createdAt");

-- AddForeignKey
ALTER TABLE "AiModelPrice" ADD CONSTRAINT "AiModelPrice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiModelPrice" ADD CONSTRAINT "AiModelPrice_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiModelTest" ADD CONSTRAINT "AiModelTest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiModelTest" ADD CONSTRAINT "AiModelTest_ranById_fkey" FOREIGN KEY ("ranById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

