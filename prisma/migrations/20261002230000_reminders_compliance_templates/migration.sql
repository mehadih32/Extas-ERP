-- Notepad and planner, tasks, in-app reminders (manual ones and automatic ones
-- for production deadlines, goods in-house, shipments, licence expiry and task
-- due dates), compliance records with renewals, and document templates with tags.

-- AlterEnum
ALTER TYPE "ReminderType" ADD VALUE 'TASK_DUE';

-- AlterTable
ALTER TABLE "ComplianceDocument" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "previousId" TEXT,
ADD COLUMN     "supersededAt" TIMESTAMP(3),
ALTER COLUMN "issueDate" SET DATA TYPE DATE,
ALTER COLUMN "expiryDate" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "DocumentTemplate" ADD COLUMN     "pageSizes" JSONB;

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "doneOn" DATE;

-- AlterTable
ALTER TABLE "NotificationLog" ADD COLUMN     "employeeId" TEXT,
ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "entityType" TEXT,
ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "Reminder" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "acknowledgedById" TEXT,
ADD COLUMN     "dueDate" DATE,
ADD COLUMN     "purchaseOrderId" TEXT,
ADD COLUMN     "sourceKey" TEXT;

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "shipmentDate" DATE;

-- AlterTable
ALTER TABLE "TemplatePlaceholder" ADD COLUMN     "align" TEXT,
ADD COLUMN     "bold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fontSize" INTEGER,
ADD COLUMN     "width" DECIMAL(8,2),
ALTER COLUMN "sourcePath" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ReminderRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "ReminderType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "daysBefore" INTEGER[],
    "overdueEveryDays" INTEGER NOT NULL DEFAULT 1,
    "sendTime" TEXT NOT NULL DEFAULT '09:00',
    "notifyManagers" BOOLEAN NOT NULL DEFAULT true,
    "notifyOwner" BOOLEAN NOT NULL DEFAULT true,
    "userIds" TEXT[],
    "employeeIds" TEXT[],
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReminderRule_companyId_type_key" ON "ReminderRule"("companyId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceDocument_previousId_key" ON "ComplianceDocument"("previousId");

-- CreateIndex
CREATE INDEX "ComplianceDocument_companyId_type_idx" ON "ComplianceDocument"("companyId", "type");

-- CreateIndex
CREATE INDEX "NotificationLog_companyId_userId_createdAt_idx" ON "NotificationLog"("companyId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_companyId_userId_readAt_idx" ON "NotificationLog"("companyId", "userId", "readAt");

-- CreateIndex
CREATE INDEX "Reminder_projectId_idx" ON "Reminder"("projectId");

-- CreateIndex
CREATE INDEX "Reminder_orderId_idx" ON "Reminder"("orderId");

-- CreateIndex
CREATE INDEX "Reminder_purchaseOrderId_idx" ON "Reminder"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "Reminder_complianceDocumentId_idx" ON "Reminder"("complianceDocumentId");

-- CreateIndex
CREATE INDEX "Reminder_taskId_idx" ON "Reminder"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_companyId_sourceKey_key" ON "Reminder"("companyId", "sourceKey");

-- CreateIndex
CREATE INDEX "ReminderRecipient_userId_idx" ON "ReminderRecipient"("userId");

-- CreateIndex
CREATE INDEX "ReminderRecipient_employeeId_idx" ON "ReminderRecipient"("employeeId");

-- CreateIndex
CREATE INDEX "SalesOrder_companyId_shipmentDate_idx" ON "SalesOrder"("companyId", "shipmentDate");

-- CreateIndex
CREATE INDEX "Task_assigneeId_status_idx" ON "Task"("assigneeId", "status");

-- AddForeignKey
ALTER TABLE "ComplianceDocument" ADD CONSTRAINT "ComplianceDocument_previousId_fkey" FOREIGN KEY ("previousId") REFERENCES "ComplianceDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderRule" ADD CONSTRAINT "ReminderRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderRule" ADD CONSTRAINT "ReminderRule_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Seeing the compliance records (licences, VAT / BIN, TIN...) without changing
-- them. New companies get the grants from DEFAULT_ROLE_PERMISSIONS and
-- `npm run db:seed` keeps the catalogue in sync; this registers the key in
-- databases that already exist.
INSERT INTO "Permission" ("id", "key", "module", "description")
VALUES
  (gen_random_uuid()::text, 'compliance.view', 'COMPLIANCE',
   'View licences and registrations (trade licence, VAT / BIN, TIN...) and their renewal dates')
ON CONFLICT ("key") DO NOTHING;

-- Default grant for built-in Accounts roles that already exist (VAT and tax
-- numbers go on invoices and returns).
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."key" = 'compliance.view'
WHERE r."systemRole" = 'ACCOUNTS'
ON CONFLICT DO NOTHING;
