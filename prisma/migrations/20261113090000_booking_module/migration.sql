-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('SUPPLIER_PO', 'MARKET_PURCHASE');

-- CreateEnum
CREATE TYPE "GarmentCategory" AS ENUM ('KNITWEAR', 'WOVEN', 'OUTERWEAR', 'SWEATER', 'OTHER');

-- CreateEnum
CREATE TYPE "CollarStyle" AS ENUM ('SOLID', 'JACQUARD_RIB', 'AMBUSH_RIB', 'TIPPING', 'HONEYCOMB');

-- CreateEnum
CREATE TYPE "DocumentLanguage" AS ENUM ('EN', 'BN');

-- AlterEnum
ALTER TYPE "MeasurementUnit" ADD VALUE 'LB';

-- AlterTable
ALTER TABLE "PurchaseOrderLine" ADD COLUMN     "specs" JSONB;

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "source" "BookingSource" NOT NULL,
    "category" "GarmentCategory" NOT NULL,
    "title" TEXT,
    "styleRef" TEXT,
    "garmentPieces" INTEGER,
    "deliveryPlace" TEXT,
    "paymentTerms" TEXT,
    "termsLanguage" "DocumentLanguage" NOT NULL DEFAULT 'EN',
    "terms" TEXT NOT NULL,
    "collarStyle" "CollarStyle",
    "collarExtraPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "collarNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingCollarSize" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "collarLength" DECIMAL(6,2) NOT NULL,
    "collarWidth" DECIMAL(6,2) NOT NULL,
    "cuffLength" DECIMAL(6,2),
    "cuffWidth" DECIMAL(6,2),

    CONSTRAINT "BookingCollarSize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingCollarColour" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "garmentColour" TEXT NOT NULL,
    "collarColour" TEXT NOT NULL,
    "tippingColour" TEXT,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "BookingCollarColour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingCollarQuantity" (
    "id" TEXT NOT NULL,
    "colourId" TEXT NOT NULL,
    "sizeId" TEXT NOT NULL,
    "pieces" INTEGER NOT NULL,
    "sets" INTEGER NOT NULL,

    CONSTRAINT "BookingCollarQuantity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Booking_orderId_key" ON "Booking"("orderId");

-- CreateIndex
CREATE INDEX "Booking_companyId_source_category_idx" ON "Booking"("companyId", "source", "category");

-- CreateIndex
CREATE INDEX "BookingCollarSize_bookingId_idx" ON "BookingCollarSize"("bookingId");

-- CreateIndex
CREATE INDEX "BookingCollarColour_bookingId_idx" ON "BookingCollarColour"("bookingId");

-- CreateIndex
CREATE INDEX "BookingCollarQuantity_sizeId_idx" ON "BookingCollarQuantity"("sizeId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingCollarQuantity_colourId_sizeId_key" ON "BookingCollarQuantity"("colourId", "sizeId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingCollarSize" ADD CONSTRAINT "BookingCollarSize_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingCollarColour" ADD CONSTRAINT "BookingCollarColour_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingCollarQuantity" ADD CONSTRAINT "BookingCollarQuantity_colourId_fkey" FOREIGN KEY ("colourId") REFERENCES "BookingCollarColour"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingCollarQuantity" ADD CONSTRAINT "BookingCollarQuantity_sizeId_fkey" FOREIGN KEY ("sizeId") REFERENCES "BookingCollarSize"("id") ON DELETE CASCADE ON UPDATE CASCADE;

