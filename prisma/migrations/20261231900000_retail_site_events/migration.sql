-- Retail leftovers (plan v6, site-changes 2.8): the site's own webhooks and their event ids. Additive only.
ALTER TABLE "RetailReturnPiece" ADD COLUMN "eventId" TEXT;
ALTER TABLE "RetailReturnPiece" ADD COLUMN "reversesEventId" TEXT;
ALTER TABLE "RetailReturnParcel" ADD COLUMN "resolvedEventId" TEXT;
ALTER TABLE "RetailStore" ADD COLUMN "holdTold" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RetailStore" ADD COLUMN "paymentToldAt" TIMESTAMP(3);
