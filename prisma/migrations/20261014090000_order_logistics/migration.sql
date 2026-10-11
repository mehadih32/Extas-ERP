-- Sales overhaul 1: cartons and the packer on an order (both optional).
ALTER TABLE "SalesOrder" ADD COLUMN "totalCartons" INTEGER,
ADD COLUMN "packedById" TEXT;

ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_packedById_fkey" FOREIGN KEY ("packedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
