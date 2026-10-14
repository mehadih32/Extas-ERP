-- Tech pack AI: the measurement chart from a few points, references saved to
-- the tech pack, logos with their machine files, sew-outs and the owner's
-- tick, colours with the dye mill's lab dips, AI drafts and expert answers.
-- Only new tables and new columns (with defaults); nothing existing changes.

-- CreateEnum
CREATE TYPE "GarmentKind" AS ENUM ('POLO', 'TEE', 'SHIRT');

-- CreateEnum
CREATE TYPE "MeasureUnit" AS ENUM ('INCH', 'CM');

-- CreateEnum
CREATE TYPE "ChestBasis" AS ENUM ('FULL', 'HALF');

-- CreateEnum
CREATE TYPE "LogoSource" AS ENUM ('BUYER_FILE', 'FACTORY_PUNCHER', 'AI_FROM_VECTOR');

-- CreateEnum
CREATE TYPE "ColourCodeSource" AS ENUM ('BUYER', 'IMAGE_ESTIMATE');

-- CreateEnum
CREATE TYPE "LabDipStatus" AS ENUM ('OPEN', 'BUYER_APPROVED', 'BEST_CAN_DO');

-- CreateEnum
CREATE TYPE "TechPackAiMode" AS ENUM ('ASK', 'AUTO');

-- CreateEnum
CREATE TYPE "ExpertAnswerKind" AS ENUM ('QUESTION', 'REVIEW');

-- AlterTable
ALTER TABLE "TechPack" ADD COLUMN     "baseSize" TEXT,
ADD COLUMN     "chartQuestions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "chestBasis" "ChestBasis",
ADD COLUMN     "garmentKind" "GarmentKind",
ADD COLUMN     "instructions" JSONB,
ADD COLUMN     "measureUnit" "MeasureUnit" NOT NULL DEFAULT 'INCH',
ADD COLUMN     "sizeRun" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "TechPackMeasurement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "techPackId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "howTo" TEXT,
    "rule" TEXT,
    "tolerance" DECIMAL(8,4) NOT NULL,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "values" JSONB NOT NULL,
    "sources" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechPackMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechPackReference" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "techPackId" TEXT NOT NULL,
    "fileId" TEXT,
    "link" TEXT,
    "note" TEXT,
    "savedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechPackReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechPackLogo" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "techPackId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "placement" TEXT,
    "widthMm" DECIMAL(8,2),
    "heightMm" DECIMAL(8,2),
    "threads" TEXT,
    "colours" INTEGER,
    "fabric" TEXT,
    "approvedStitches" INTEGER,
    "reference" TEXT,
    "source" "LogoSource",
    "artworkFileId" TEXT,
    "machineFileId" TEXT,
    "machineFormat" TEXT,
    "fileCheck" JSONB,
    "sewOutFileId" TEXT,
    "sewOutNote" TEXT,
    "tickedById" TEXT,
    "tickedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechPackLogo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechPackColour" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "techPackId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "codeSource" "ColourCodeSource" NOT NULL DEFAULT 'BUYER',
    "photoEstimate" JSONB,
    "deltaLimit" DECIMAL(5,2) NOT NULL DEFAULT 1.0,
    "primaryLight" TEXT NOT NULL DEFAULT 'D65',
    "secondaryLight" TEXT,
    "status" "LabDipStatus" NOT NULL DEFAULT 'OPEN',
    "approvedOption" TEXT,
    "reportFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechPackColour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabDipOption" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "colourId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "letter" TEXT NOT NULL,
    "light" TEXT,
    "deltaE" DECIMAL(6,2) NOT NULL,
    "dl" DECIMAL(6,2),
    "dc" DECIMAL(6,2),
    "dh" DECIMAL(6,2),
    "mi" DECIMAL(6,2),
    "readByAi" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabDipOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechPackAiDraft" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "techPackId" TEXT NOT NULL,
    "mode" "TechPackAiMode" NOT NULL,
    "model" TEXT NOT NULL,
    "output" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechPackAiDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechPackExpertAnswer" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "techPackId" TEXT NOT NULL,
    "expert" TEXT NOT NULL,
    "kind" "ExpertAnswerKind" NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "findings" JSONB,
    "model" TEXT NOT NULL,
    "askedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechPackExpertAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TechPackMeasurement_companyId_idx" ON "TechPackMeasurement"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "TechPackMeasurement_techPackId_code_key" ON "TechPackMeasurement"("techPackId", "code");

-- CreateIndex
CREATE INDEX "TechPackReference_techPackId_createdAt_idx" ON "TechPackReference"("techPackId", "createdAt");

-- CreateIndex
CREATE INDEX "TechPackReference_companyId_idx" ON "TechPackReference"("companyId");

-- CreateIndex
CREATE INDEX "TechPackLogo_techPackId_idx" ON "TechPackLogo"("techPackId");

-- CreateIndex
CREATE INDEX "TechPackLogo_companyId_idx" ON "TechPackLogo"("companyId");

-- CreateIndex
CREATE INDEX "TechPackColour_companyId_idx" ON "TechPackColour"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "TechPackColour_techPackId_name_key" ON "TechPackColour"("techPackId", "name");

-- CreateIndex
CREATE INDEX "LabDipOption_companyId_idx" ON "LabDipOption"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "LabDipOption_colourId_round_letter_key" ON "LabDipOption"("colourId", "round", "letter");

-- CreateIndex
CREATE INDEX "TechPackAiDraft_techPackId_createdAt_idx" ON "TechPackAiDraft"("techPackId", "createdAt");

-- CreateIndex
CREATE INDEX "TechPackAiDraft_companyId_idx" ON "TechPackAiDraft"("companyId");

-- CreateIndex
CREATE INDEX "TechPackExpertAnswer_techPackId_createdAt_idx" ON "TechPackExpertAnswer"("techPackId", "createdAt");

-- CreateIndex
CREATE INDEX "TechPackExpertAnswer_companyId_idx" ON "TechPackExpertAnswer"("companyId");

-- AddForeignKey
ALTER TABLE "TechPackMeasurement" ADD CONSTRAINT "TechPackMeasurement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPackMeasurement" ADD CONSTRAINT "TechPackMeasurement_techPackId_fkey" FOREIGN KEY ("techPackId") REFERENCES "TechPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPackReference" ADD CONSTRAINT "TechPackReference_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPackReference" ADD CONSTRAINT "TechPackReference_techPackId_fkey" FOREIGN KEY ("techPackId") REFERENCES "TechPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPackReference" ADD CONSTRAINT "TechPackReference_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPackReference" ADD CONSTRAINT "TechPackReference_savedById_fkey" FOREIGN KEY ("savedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPackLogo" ADD CONSTRAINT "TechPackLogo_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPackLogo" ADD CONSTRAINT "TechPackLogo_techPackId_fkey" FOREIGN KEY ("techPackId") REFERENCES "TechPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPackLogo" ADD CONSTRAINT "TechPackLogo_artworkFileId_fkey" FOREIGN KEY ("artworkFileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPackLogo" ADD CONSTRAINT "TechPackLogo_machineFileId_fkey" FOREIGN KEY ("machineFileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPackLogo" ADD CONSTRAINT "TechPackLogo_sewOutFileId_fkey" FOREIGN KEY ("sewOutFileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPackLogo" ADD CONSTRAINT "TechPackLogo_tickedById_fkey" FOREIGN KEY ("tickedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPackColour" ADD CONSTRAINT "TechPackColour_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPackColour" ADD CONSTRAINT "TechPackColour_techPackId_fkey" FOREIGN KEY ("techPackId") REFERENCES "TechPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPackColour" ADD CONSTRAINT "TechPackColour_reportFileId_fkey" FOREIGN KEY ("reportFileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabDipOption" ADD CONSTRAINT "LabDipOption_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabDipOption" ADD CONSTRAINT "LabDipOption_colourId_fkey" FOREIGN KEY ("colourId") REFERENCES "TechPackColour"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPackAiDraft" ADD CONSTRAINT "TechPackAiDraft_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPackAiDraft" ADD CONSTRAINT "TechPackAiDraft_techPackId_fkey" FOREIGN KEY ("techPackId") REFERENCES "TechPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPackAiDraft" ADD CONSTRAINT "TechPackAiDraft_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPackExpertAnswer" ADD CONSTRAINT "TechPackExpertAnswer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPackExpertAnswer" ADD CONSTRAINT "TechPackExpertAnswer_techPackId_fkey" FOREIGN KEY ("techPackId") REFERENCES "TechPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechPackExpertAnswer" ADD CONSTRAINT "TechPackExpertAnswer_askedById_fkey" FOREIGN KEY ("askedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The permissions of this build that only the owner holds at first: the
-- Permission rows let the access tree give them to a role or a person. Live
-- sites take new permissions from migrations, so they are added here. Nobody
-- is given them; Super Admin holds every permission in code.
INSERT INTO "Permission" ("id", "key", "module", "description")
VALUES
  (gen_random_uuid()::text, 'production.bookings.approve', 'PRODUCTION',
   'Approve bookings before they go to the supplier, and choose Fabric first for an order (the owner''s by default)'),
  (gen_random_uuid()::text, 'production.techpack.approve', 'PRODUCTION',
   'Lock a style''s fabric part and approve its tech pack for production'),
  (gen_random_uuid()::text, 'production.logo.approve', 'PRODUCTION',
   'Tick a logo for bulk after its sew-out (the owner''s): its machine file is then locked'),
  (gen_random_uuid()::text, 'ai.view', 'AI',
   'See the AI Center: what the AI did, what waits for an answer, and Control'),
  (gen_random_uuid()::text, 'ai.manage', 'AI',
   'Turn AI on or off, set what it may do (Control), its models, key and PIN, and answer its requests (the owner''s)')
ON CONFLICT ("key") DO NOTHING;
