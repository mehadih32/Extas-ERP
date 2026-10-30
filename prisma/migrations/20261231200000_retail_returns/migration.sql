-- CreateEnum
CREATE TYPE "RetailDeliveryStatus" AS ENUM ('DELIVERED', 'PARTIAL', 'RETURNED');

-- CreateEnum
CREATE TYPE "RetailMatch" AS ENUM ('GREEN', 'YELLOW', 'ORANGE');

-- CreateEnum
CREATE TYPE "RetailParcelState" AS ENUM ('HOLD', 'IN_RETURN_STOCK', 'CHECKED', 'MISSING');

-- CreateEnum
CREATE TYPE "RetailPieceStatus" AS ENUM ('WAITING', 'APPROVED', 'DECLINED');

-- CreateEnum
CREATE TYPE "RetailDeclineReason" AS ENUM ('B_GRADE', 'C_GRADE', 'STAIN_OR_DAMAGE', 'USED', 'NO_TAG', 'PIECE_MISSING', 'WRONG_ITEM', 'PARCEL_MISSING', 'OTHER');

-- CreateTable
CREATE TABLE "RetailDelivery" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "retailOrderId" TEXT NOT NULL,
    "status" "RetailDeliveryStatus" NOT NULL,
    "courier" TEXT NOT NULL,
    "consignmentId" TEXT NOT NULL,
    "collected" DECIMAL(14,2) NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "markKept" JSONB,
    "discountGiven" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "phoneConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "match" "RetailMatch" NOT NULL,
    "returning" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailReturnList" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "returnListId" TEXT NOT NULL,
    "courier" TEXT NOT NULL,
    "handedBackAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetailReturnList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailReturnParcel" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "retailOrderId" TEXT NOT NULL,
    "consignmentId" TEXT NOT NULL,
    "receivedCount" INTEGER,
    "note" TEXT,
    "state" "RetailParcelState" NOT NULL,
    "match" "RetailMatch" NOT NULL,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetailReturnParcel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailReturnPiece" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "retailOrderLineId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "status" "RetailPieceStatus" NOT NULL DEFAULT 'WAITING',
    "reason" "RetailDeclineReason",
    "note" TEXT,
    "differentPiece" BOOLEAN NOT NULL DEFAULT false,
    "salesReturnId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetailReturnPiece_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RetailDelivery_retailOrderId_key" ON "RetailDelivery"("retailOrderId");

-- CreateIndex
CREATE INDEX "RetailDelivery_companyId_idx" ON "RetailDelivery"("companyId");

-- CreateIndex
CREATE INDEX "RetailReturnList_companyId_idx" ON "RetailReturnList"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "RetailReturnList_storeId_returnListId_key" ON "RetailReturnList"("storeId", "returnListId");

-- CreateIndex
CREATE UNIQUE INDEX "RetailReturnParcel_retailOrderId_key" ON "RetailReturnParcel"("retailOrderId");

-- CreateIndex
CREATE INDEX "RetailReturnParcel_companyId_state_idx" ON "RetailReturnParcel"("companyId", "state");

-- CreateIndex
CREATE INDEX "RetailReturnPiece_parcelId_idx" ON "RetailReturnPiece"("parcelId");

-- CreateIndex
CREATE INDEX "RetailReturnPiece_companyId_status_idx" ON "RetailReturnPiece"("companyId", "status");

-- AddForeignKey
ALTER TABLE "RetailDelivery" ADD CONSTRAINT "RetailDelivery_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailDelivery" ADD CONSTRAINT "RetailDelivery_retailOrderId_fkey" FOREIGN KEY ("retailOrderId") REFERENCES "RetailOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailReturnList" ADD CONSTRAINT "RetailReturnList_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailReturnList" ADD CONSTRAINT "RetailReturnList_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "RetailStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailReturnParcel" ADD CONSTRAINT "RetailReturnParcel_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailReturnParcel" ADD CONSTRAINT "RetailReturnParcel_listId_fkey" FOREIGN KEY ("listId") REFERENCES "RetailReturnList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailReturnParcel" ADD CONSTRAINT "RetailReturnParcel_retailOrderId_fkey" FOREIGN KEY ("retailOrderId") REFERENCES "RetailOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailReturnPiece" ADD CONSTRAINT "RetailReturnPiece_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailReturnPiece" ADD CONSTRAINT "RetailReturnPiece_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "RetailReturnParcel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailReturnPiece" ADD CONSTRAINT "RetailReturnPiece_retailOrderLineId_fkey" FOREIGN KEY ("retailOrderLineId") REFERENCES "RetailOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailReturnPiece" ADD CONSTRAINT "RetailReturnPiece_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The right to resolve Hold parcels and check returned pieces (plan v6 sec 8.4).
INSERT INTO "Permission" ("id", "key", "module", "description")
VALUES
  (gen_random_uuid()::text, 'retail.returns', 'RETAIL',
   'Resolve Hold parcels and check the pieces retail stores send back (approving one also needs Accounts)')
ON CONFLICT ("key") DO NOTHING;
