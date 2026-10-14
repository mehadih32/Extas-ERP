-- The book frame for booking books and bookings: a tagline under the company's name,
-- the company's default orientation and each person's last pick. Additive only.

-- CreateEnum
CREATE TYPE "PageOrientation" AS ENUM ('LANDSCAPE', 'PORTRAIT');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "bookOrientation" "PageOrientation" NOT NULL DEFAULT 'LANDSCAPE',
ADD COLUMN     "tagline" TEXT;

-- AlterTable
ALTER TABLE "UserPreference" ADD COLUMN     "pdfOrientation" "PageOrientation";
