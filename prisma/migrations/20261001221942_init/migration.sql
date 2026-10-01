-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SystemRole" AS ENUM ('SUPER_ADMIN', 'PRODUCTION_MANAGER', 'SALES_EXECUTIVE', 'WAREHOUSE_TEAM', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "AppModule" AS ENUM ('DASHBOARD', 'SALES', 'WHOLESALE', 'RETAIL', 'PRODUCTION', 'INVENTORY', 'PARTIES', 'ACCOUNTS', 'EXPENSES', 'HR', 'COMPLIANCE', 'TEMPLATES', 'REPORTS', 'NOTEPAD', 'REMINDERS', 'SETTINGS', 'BACKUPS');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'FORCE_OVERRIDE', 'INVOICE_EDIT', 'STATUS_CHANGE', 'LOGIN', 'LOGOUT', 'EXPORT', 'PERMISSION_CHANGE', 'STOCK_ADJUSTMENT', 'RESTORE');

-- CreateEnum
CREATE TYPE "CustomFieldEntity" AS ENUM ('QUOTATION', 'QUOTATION_ITEM', 'SALES_ORDER', 'PARTY', 'PRODUCTION_PROJECT', 'STYLE');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'LONG_TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT', 'COLOR');

-- CreateEnum
CREATE TYPE "StockGrade" AS ENUM ('A_GRADE', 'B_GRADE');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('OPENING', 'PRODUCTION_IN', 'PURCHASE_IN', 'SALE_OUT', 'RETURN_RESTOCK', 'BAD_STOCK_OUT', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateEnum
CREATE TYPE "BadStockSource" AS ENUM ('RETURN_QC', 'WAREHOUSE_DAMAGE', 'PRODUCTION_REJECT', 'MANUAL');

-- CreateEnum
CREATE TYPE "RawMaterialKind" AS ENUM ('FABRIC', 'TRIM', 'ACCESSORY', 'PACKAGING', 'OTHER');

-- CreateEnum
CREATE TYPE "MeasurementUnit" AS ENUM ('PCS', 'METER', 'YARD', 'KG', 'GRAM', 'ROLL', 'DOZEN', 'GROSS', 'CONE', 'SET');

-- CreateEnum
CREATE TYPE "RawMaterialMovementType" AS ENUM ('PURCHASE_IN', 'ISSUE_TO_PRODUCTION', 'RETURN_FROM_PRODUCTION', 'ADJUSTMENT', 'WASTAGE');

-- CreateEnum
CREATE TYPE "PartyKind" AS ENUM ('BUYER', 'SUPPLIER', 'BOTH');

-- CreateEnum
CREATE TYPE "BuyerType" AS ENUM ('RETAIL', 'WHOLESALE', 'B2B_CORPORATE');

-- CreateEnum
CREATE TYPE "PartyGrade" AS ENUM ('A_PLUS', 'A', 'B', 'C');

-- CreateEnum
CREATE TYPE "PartyStatus" AS ENUM ('ACTIVE', 'SETTLING', 'DORMANT', 'CLOSED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'SMS', 'IN_APP', 'PDF_DOWNLOAD');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "ProformaStatus" AS ENUM ('ISSUED', 'ADVANCE_RECEIVED', 'IN_PRODUCTION', 'CONVERTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('WEBSITE', 'SOCIAL_COMMERCE', 'POS', 'WHOLESALE', 'B2B_PREORDER');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED', 'PARTIALLY_RETURNED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('RECEIVED', 'PAID');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'BKASH', 'NAGAD', 'ROCKET', 'CARD', 'COURIER_COD', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('CASH_BANK', 'DUE');

-- CreateEnum
CREATE TYPE "EcommercePlatform" AS ENUM ('SHOPIFY', 'WOOCOMMERCE', 'CUSTOM_WEBSITE', 'FACEBOOK_SHOP', 'OTHER');

-- CreateEnum
CREATE TYPE "WebhookSource" AS ENUM ('ECOMMERCE', 'PATHAO', 'STEADFAST', 'WHATSAPP', 'OTHER');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "CourierProvider" AS ENUM ('PATHAO', 'STEADFAST', 'OTHER');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('PENDING', 'CREATED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'PARTIALLY_DELIVERED', 'RETURNED', 'CANCELLED', 'PAYOUT_RECEIVED');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('PENDING_QC', 'PARTIALLY_CHECKED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ReturnItemQcStatus" AS ENUM ('PENDING', 'MOVED_TO_MAIN_STOCK', 'MOVED_TO_BAD_STOCK', 'SPLIT');

-- CreateEnum
CREATE TYPE "ProductionStage" AS ENUM ('FABRIC_SOURCING', 'CUTTING', 'SEWING', 'WASH_QC', 'FINISHING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ProductionStatus" AS ENUM ('PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "IntakeMethod" AS ENUM ('AI_OCR', 'MANUAL');

-- CreateEnum
CREATE TYPE "IntakeStatus" AS ENUM ('DRAFT', 'PARSED', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CostAllocationMethod" AS ENUM ('EQUAL_PER_PIECE', 'B_GRADE_RATIO', 'MANUAL');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "AccountSubType" AS ENUM ('CASH', 'BANK', 'MOBILE_WALLET', 'ACCOUNTS_RECEIVABLE', 'INVENTORY', 'RAW_MATERIALS', 'PENDING_RETURNS', 'ADVANCE_TO_EMPLOYEE', 'OTHER_CURRENT_ASSET', 'FIXED_ASSET', 'ACCUMULATED_DEPRECIATION', 'ACCOUNTS_PAYABLE', 'CUSTOMER_ADVANCE', 'LOAN', 'INVESTOR', 'OTHER_LIABILITY', 'CAPITAL', 'RETAINED_EARNINGS', 'DRAWINGS', 'SALES', 'OTHER_INCOME', 'COGS', 'INVENTORY_LOSS', 'OPERATING_EXPENSE', 'PAYROLL_EXPENSE', 'MARKETING_EXPENSE', 'COURIER_EXPENSE', 'FINANCE_COST');

-- CreateEnum
CREATE TYPE "JournalSource" AS ENUM ('MANUAL', 'SALE', 'PAYMENT', 'SUPPLIER_BILL', 'EXPENSE', 'PAYROLL', 'SALARY_ADVANCE', 'BAD_STOCK', 'STOCK_INTAKE', 'RETURN', 'COURIER_PAYOUT', 'CAPITAL', 'INSTALLMENT', 'DEPRECIATION', 'OPENING_BALANCE');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('IN_USE', 'UNDER_REPAIR', 'DISPOSED');

-- CreateEnum
CREATE TYPE "CapitalSourceKind" AS ENUM ('OWNER_CAPITAL', 'INVESTOR', 'BANK_LOAN', 'PRIVATE_LOAN');

-- CreateEnum
CREATE TYPE "CapitalStatus" AS ENUM ('ACTIVE', 'SETTLED', 'DEFAULTED');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('SCHEDULED', 'PAID', 'OVERDUE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('PRODUCTION', 'RAW_MATERIAL', 'CONVEYANCE', 'FOOD', 'RENT', 'UTILITIES', 'SALARY', 'MARKETING', 'COURIER', 'OFFICE', 'MAINTENANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "AdPlatform" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'GOOGLE', 'TIKTOK', 'OTHER');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'RESIGNED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID');

-- CreateEnum
CREATE TYPE "AdvanceStatus" AS ENUM ('OPEN', 'SETTLED');

-- CreateEnum
CREATE TYPE "ComplianceType" AS ENUM ('TRADE_LICENSE', 'VAT_BIN', 'TIN', 'IRC', 'ERC', 'BGMEA_BKMEA', 'FIRE_LICENSE', 'ENVIRONMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('QUOTATION', 'PROFORMA_INVOICE', 'SALES_ORDER', 'COMMERCIAL_INVOICE', 'PACKING_LIST', 'DELIVERY_CHALLAN', 'PAYMENT_RECEIPT', 'SUPPLIER_BILL', 'EXPENSE_VOUCHER', 'JOURNAL_VOUCHER', 'SALES_RETURN', 'STOCK_INTAKE', 'PRODUCTION_PROJECT', 'STOCK_AVAILABILITY', 'LEDGER_STATEMENT', 'RECEIVABLES_REPORT', 'PAYABLES_REPORT', 'BANK_STATEMENT', 'LETTERHEAD', 'CONVEYANCE_FORM', 'PAYSLIP', 'REPORT');

-- CreateEnum
CREATE TYPE "TemplateFormat" AS ENUM ('PDF', 'WORD', 'IMAGE', 'HTML');

-- CreateEnum
CREATE TYPE "ReportPeriod" AS ENUM ('ONE_WEEK', 'ONE_MONTH', 'ONE_YEAR', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('PDF', 'EXCEL');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "NoteTab" AS ENUM ('DAILY_ROUTINE', 'NEXT_3_DAYS', 'GENERAL');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReminderType" AS ENUM ('PRODUCTION_DEADLINE', 'GOODS_IN_HOUSE', 'SHIPMENT', 'COMPLIANCE_EXPIRY', 'FACTORY_VISIT', 'PAYMENT_DUE', 'INSTALLMENT_DUE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('SCHEDULED', 'SENT', 'ACKNOWLEDGED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "BackupTrigger" AS ENUM ('SCHEDULED', 'MANUAL');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "legalName" TEXT,
    "logoUrl" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "letterheadFooter" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#0B3D2E',
    "accentColor" TEXT NOT NULL DEFAULT '#BE1434',
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Dhaka',
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
    "defaultAdvancePercent" DECIMAL(5,2) NOT NULL DEFAULT 30,
    "dormantAfterMonths" INTEGER NOT NULL DEFAULT 6,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "avatarUrl" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "lastCompanyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyMembership" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "systemRole" "SystemRole",
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "module" "AppModule" NOT NULL,
    "description" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hiddenMetrics" TEXT[],
    "dashboardLayout" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileAsset" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "uploadedById" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "url" TEXT,
    "checksum" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSequence" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "docType" "DocumentType" NOT NULL,
    "prefix" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "padding" INTEGER NOT NULL DEFAULT 5,
    "resetYearly" BOOLEAN NOT NULL DEFAULT true,
    "year" INTEGER,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldDefinition" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entity" "CustomFieldEntity" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" "CustomFieldType" NOT NULL,
    "options" TEXT[],
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Style" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "brandId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "fabric" TEXT,
    "imageUrl" TEXT,
    "retailPrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "wholesalePrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Style_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Color" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hexCode" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Color_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Size" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Size_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "colorId" TEXT NOT NULL,
    "sizeId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "retailPrice" DECIMAL(14,2),
    "wholesalePrice" DECIMAL(14,2),
    "avgCost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SizeRatioPreset" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SizeRatioPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SizeRatioEntry" (
    "id" TEXT NOT NULL,
    "presetId" TEXT NOT NULL,
    "sizeId" TEXT NOT NULL,
    "ratio" INTEGER NOT NULL,

    CONSTRAINT "SizeRatioEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBalance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "grade" "StockGrade" NOT NULL DEFAULT 'A_GRADE',
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "grade" "StockGrade" NOT NULL DEFAULT 'A_GRADE',
    "type" "StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(14,4),
    "referenceType" TEXT,
    "referenceId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BadStockEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "lossValue" DECIMAL(14,2) NOT NULL,
    "source" "BadStockSource" NOT NULL,
    "reason" TEXT,
    "salesReturnItemId" TEXT,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BadStockEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawMaterial" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "RawMaterialKind" NOT NULL,
    "unit" "MeasurementUnit" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "avgCost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "reorderLevel" DECIMAL(14,3),
    "supplierId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RawMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawMaterialMovement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "rawMaterialId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "type" "RawMaterialMovementType" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,4),
    "productionProjectId" TEXT,
    "supplierBillId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawMaterialMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "PartyKind" NOT NULL,
    "buyerType" "BuyerType",
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT DEFAULT 'Bangladesh',
    "taxId" TEXT,
    "grade" "PartyGrade",
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "status" "PartyStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusChangedAt" TIMESTAMP(3),
    "creditLimit" DECIMAL(14,2),
    "paymentTermsDays" INTEGER,
    "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lastTransactionAt" TIMESTAMP(3),
    "notes" TEXT,
    "customFields" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReEngagementCampaign" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inactivityMonths" INTEGER NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "message" TEXT NOT NULL,
    "catalogFileUrl" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReEngagementCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "terms" TEXT,
    "notes" TEXT,
    "customFields" JSONB,
    "templateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationItem" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "categoryId" TEXT,
    "styleId" TEXT,
    "description" TEXT NOT NULL,
    "fabric" TEXT,
    "colorNote" TEXT,
    "sizeBreakdown" JSONB,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuotationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationStylingRule" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "area" TEXT,
    "instruction" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuotationStylingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProformaInvoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "quotationId" TEXT,
    "partyId" TEXT NOT NULL,
    "status" "ProformaStatus" NOT NULL DEFAULT 'ISSUED',
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total" DECIMAL(14,2) NOT NULL,
    "advancePercent" DECIMAL(5,2) NOT NULL DEFAULT 30,
    "advanceAmount" DECIMAL(14,2) NOT NULL,
    "advancePaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "advancePaidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProformaInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "channel" "SalesChannel" NOT NULL,
    "partyId" TEXT,
    "proformaId" TEXT,
    "integrationId" TEXT,
    "externalOrderId" TEXT,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'CONFIRMED',
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "shippingAddress" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "shippingCharge" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "dueAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "hasForceOverride" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "unitCost" DECIMAL(14,4),
    "availableAtSale" INTEGER,
    "forceOverride" BOOLEAN NOT NULL DEFAULT false,
    "overrideById" TEXT,
    "overrideReason" TEXT,
    "overrideAt" TIMESTAMP(3),

    CONSTRAINT "SalesOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "partyId" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "total" DECIMAL(14,2) NOT NULL,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "dueAmount" DECIMAL(14,2) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'UNPAID',
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackingList" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "cartons" INTEGER,
    "grossWeightKg" DECIMAL(10,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackingList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackingListItem" (
    "id" TEXT NOT NULL,
    "packingListId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "cartonNo" TEXT,
    "isPicked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PackingListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryChallan" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "deliveryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vehicleNo" TEXT,
    "driverName" TEXT,
    "driverPhone" TEXT,
    "receivedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryChallan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryChallanItem" (
    "id" TEXT NOT NULL,
    "challanId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "DeliveryChallanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "direction" "PaymentDirection" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "partyId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accountId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "orderId" TEXT,
    "proformaId" TEXT,
    "supplierBillId" TEXT,
    "shipmentId" TEXT,
    "reference" TEXT,
    "isAdvance" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesChannelIntegration" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "EcommercePlatform" NOT NULL,
    "baseUrl" TEXT,
    "apiKeyRef" TEXT,
    "webhookSecretRef" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesChannelIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "source" "WebhookSource" NOT NULL,
    "integrationId" TEXT,
    "eventType" TEXT NOT NULL,
    "externalId" TEXT,
    "payload" JSONB NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "CourierProvider" NOT NULL,
    "name" TEXT NOT NULL,
    "storeId" TEXT,
    "credentialsRef" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "courierAccountId" TEXT NOT NULL,
    "consignmentId" TEXT,
    "trackingCode" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'PENDING',
    "codAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deliveryCharge" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "codCharge" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "payoutAmount" DECIMAL(14,2),
    "payoutAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentEvent" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "status" "ShipmentStatus" NOT NULL,
    "rawStatus" TEXT,
    "message" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesReturn" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "reason" TEXT,
    "status" "ReturnStatus" NOT NULL DEFAULT 'PENDING_QC',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SalesReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesReturnItem" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "qcStatus" "ReturnItemQcStatus" NOT NULL DEFAULT 'PENDING',
    "qtyRestocked" INTEGER NOT NULL DEFAULT 0,
    "qtyBadStock" INTEGER NOT NULL DEFAULT 0,
    "inspectedById" TEXT,
    "inspectedAt" TIMESTAMP(3),
    "qcNote" TEXT,

    CONSTRAINT "SalesReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionProject" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT,
    "styleId" TEXT,
    "factoryId" TEXT,
    "factoryName" TEXT,
    "buyerId" TEXT,
    "isInHouse" BOOLEAN NOT NULL DEFAULT false,
    "proformaId" TEXT,
    "stage" "ProductionStage" NOT NULL DEFAULT 'FABRIC_SOURCING',
    "status" "ProductionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "targetDate" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "targetQuantity" INTEGER NOT NULL,
    "producedQtyA" INTEGER NOT NULL DEFAULT 0,
    "producedQtyB" INTEGER NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionStageLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "stage" "ProductionStage" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "ProductionStageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierBill" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierRef" TEXT,
    "supplierId" TEXT NOT NULL,
    "billDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "paymentType" "PaymentType" NOT NULL,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "dueAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "BillStatus" NOT NULL DEFAULT 'UNPAID',
    "attachmentId" TEXT,
    "notes" TEXT,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierBillAllocation" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "projectId" TEXT,
    "expenseHeadId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT,

    CONSTRAINT "SupplierBillAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockIntake" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "projectId" TEXT,
    "sourceFileId" TEXT,
    "method" "IntakeMethod" NOT NULL DEFAULT 'MANUAL',
    "status" "IntakeStatus" NOT NULL DEFAULT 'DRAFT',
    "aiRawResult" JSONB,
    "aiConfidence" DECIMAL(5,2),
    "totalCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "costAllocation" "CostAllocationMethod" NOT NULL DEFAULT 'EQUAL_PER_PIECE',
    "bGradeCostRatio" DECIMAL(5,4),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockIntake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockIntakeLine" (
    "id" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "grade" "StockGrade" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "StockIntakeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "subType" "AccountSubType" NOT NULL,
    "parentId" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "sourceType" "JournalSource" NOT NULL,
    "sourceId" TEXT,
    "postedById" TEXT,
    "isReversed" BOOLEAN NOT NULL DEFAULT false,
    "reversalOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "partyId" TEXT,
    "employeeId" TEXT,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "memo" TEXT,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "branch" TEXT,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "routingNumber" TEXT,
    "swiftCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedAsset" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ledgerAccountId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "purchaseCost" DECIMAL(14,2) NOT NULL,
    "depreciationRate" DECIMAL(5,2),
    "currentValue" DECIMAL(14,2) NOT NULL,
    "location" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'IN_USE',
    "disposedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapitalSource" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ledgerAccountId" TEXT,
    "kind" "CapitalSourceKind" NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "principal" DECIMAL(14,2) NOT NULL,
    "interestRate" DECIMAL(5,2),
    "profitSharePct" DECIMAL(5,2),
    "startDate" TIMESTAMP(3) NOT NULL,
    "maturityDate" TIMESTAMP(3),
    "outstanding" DECIMAL(14,2) NOT NULL,
    "status" "CapitalStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapitalSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapitalInstallment" (
    "id" TEXT NOT NULL,
    "capitalSourceId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "principalPart" DECIMAL(14,2),
    "interestPart" DECIMAL(14,2),
    "status" "InstallmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "paidAt" TIMESTAMP(3),
    "paidFromAccountId" TEXT,
    "journalEntryId" TEXT,

    CONSTRAINT "CapitalInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseHead" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "ledgerAccountId" TEXT,
    "isProductionCost" BOOLEAN NOT NULL DEFAULT false,
    "requiresEmployee" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ExpenseHead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "headId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paymentType" "PaymentType" NOT NULL,
    "paidFromAccountId" TEXT,
    "supplierId" TEXT,
    "projectId" TEXT,
    "employeeId" TEXT,
    "purpose" TEXT,
    "fromLocation" TEXT,
    "toLocation" TEXT,
    "salaryAdvanceId" TEXT,
    "description" TEXT,
    "receiptFileId" TEXT,
    "formPrinted" BOOLEAN NOT NULL DEFAULT false,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdSpend" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "platform" "AdPlatform" NOT NULL,
    "campaign" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdSpend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "department" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "nid" TEXT,
    "address" TEXT,
    "photoUrl" TEXT,
    "joinDate" TIMESTAMP(3) NOT NULL,
    "exitDate" TIMESTAMP(3),
    "baseSalary" DECIMAL(14,2) NOT NULL,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryRevision" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveType" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "daysPerYear" INTEGER NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveBalance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "entitled" DECIMAL(5,1) NOT NULL,
    "used" DECIMAL(5,1) NOT NULL DEFAULT 0,

    CONSTRAINT "LeaveBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "days" DECIMAL(5,1) NOT NULL,
    "reason" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "approvedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "attachmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "totalNet" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "basic" DECIMAL(14,2) NOT NULL,
    "allowances" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "overtime" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "bonus" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "unpaidLeaveDeduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "advanceDeduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "otherDeductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(14,2) NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "journalEntryId" TEXT,

    CONSTRAINT "PayrollItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryAdvance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "outstanding" DECIMAL(14,2) NOT NULL,
    "givenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidFromAccountId" TEXT,
    "purpose" TEXT,
    "status" "AdvanceStatus" NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "SalaryAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvanceSettlement" (
    "id" TEXT NOT NULL,
    "advanceId" TEXT NOT NULL,
    "payrollItemId" TEXT,
    "expenseId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdvanceSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "ComplianceType" NOT NULL,
    "title" TEXT NOT NULL,
    "number" TEXT,
    "issuingAuthority" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "alertDaysBefore" INTEGER NOT NULL DEFAULT 30,
    "fileId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "format" "TemplateFormat" NOT NULL,
    "fileId" TEXT,
    "htmlContent" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplatePlaceholder" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "format" TEXT,
    "pageX" DECIMAL(8,2),
    "pageY" DECIMAL(8,2),
    "page" INTEGER,

    CONSTRAINT "TemplatePlaceholder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "partyId" TEXT,
    "templateId" TEXT,
    "fileId" TEXT,
    "title" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),
    "sharedVia" "MessageChannel"[],
    "sharedAt" TIMESTAMP(3),
    "generatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportExport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestedById" TEXT,
    "period" "ReportPeriod" NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "metrics" TEXT[],
    "format" "ReportFormat" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "fileId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ReportExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tab" "NoteTab" NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "planDate" DATE,
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigneeId" TEXT,
    "createdById" TEXT,
    "projectId" TEXT,
    "dueAt" TIMESTAMP(3),
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "ReminderType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "repeatRule" TEXT,
    "offsetDays" INTEGER,
    "status" "ReminderStatus" NOT NULL DEFAULT 'SCHEDULED',
    "channels" "MessageChannel"[],
    "projectId" TEXT,
    "orderId" TEXT,
    "complianceDocumentId" TEXT,
    "taskId" TEXT,
    "createdById" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderRecipient" (
    "id" TEXT NOT NULL,
    "reminderId" TEXT NOT NULL,
    "userId" TEXT,
    "employeeId" TEXT,

    CONSTRAINT "ReminderRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reminderId" TEXT,
    "channel" "MessageChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupConfig" (
    "id" TEXT NOT NULL,
    "cronSchedule" TEXT NOT NULL DEFAULT '0 2 * * *',
    "includeMedia" BOOLEAN NOT NULL DEFAULT true,
    "googleDriveFolderId" TEXT,
    "credentialsRef" TEXT,
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL,
    "trigger" "BackupTrigger" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "dbDumpPath" TEXT,
    "mediaArchivePath" TEXT,
    "sizeBytes" BIGINT,
    "driveFileId" TEXT,
    "triggeredById" TEXT,
    "error" TEXT,

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "CompanyMembership_roleId_idx" ON "CompanyMembership"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyMembership_companyId_userId_key" ON "CompanyMembership"("companyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_companyId_name_key" ON "Role"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_entityType_entityId_idx" ON "AuditLog"("companyId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "FileAsset_companyId_idx" ON "FileAsset"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSequence_companyId_docType_key" ON "DocumentSequence"("companyId", "docType");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDefinition_companyId_entity_key_key" ON "CustomFieldDefinition"("companyId", "entity", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Category_companyId_slug_key" ON "Category"("companyId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_companyId_name_key" ON "Brand"("companyId", "name");

-- CreateIndex
CREATE INDEX "Style_companyId_categoryId_idx" ON "Style"("companyId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Style_companyId_code_key" ON "Style"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Color_companyId_name_key" ON "Color"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Size_companyId_name_key" ON "Size"("companyId", "name");

-- CreateIndex
CREATE INDEX "ProductVariant_companyId_barcode_idx" ON "ProductVariant"("companyId", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_companyId_sku_key" ON "ProductVariant"("companyId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_styleId_colorId_sizeId_key" ON "ProductVariant"("styleId", "colorId", "sizeId");

-- CreateIndex
CREATE UNIQUE INDEX "SizeRatioPreset_companyId_name_key" ON "SizeRatioPreset"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SizeRatioEntry_presetId_sizeId_key" ON "SizeRatioEntry"("presetId", "sizeId");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_companyId_name_key" ON "Warehouse"("companyId", "name");

-- CreateIndex
CREATE INDEX "StockBalance_companyId_quantity_idx" ON "StockBalance"("companyId", "quantity");

-- CreateIndex
CREATE UNIQUE INDEX "StockBalance_variantId_warehouseId_grade_key" ON "StockBalance"("variantId", "warehouseId", "grade");

-- CreateIndex
CREATE INDEX "StockMovement_companyId_createdAt_idx" ON "StockMovement"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_variantId_createdAt_idx" ON "StockMovement"("variantId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_referenceType_referenceId_idx" ON "StockMovement"("referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "BadStockEntry_salesReturnItemId_key" ON "BadStockEntry"("salesReturnItemId");

-- CreateIndex
CREATE UNIQUE INDEX "BadStockEntry_journalEntryId_key" ON "BadStockEntry"("journalEntryId");

-- CreateIndex
CREATE INDEX "BadStockEntry_companyId_createdAt_idx" ON "BadStockEntry"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RawMaterial_companyId_code_key" ON "RawMaterial"("companyId", "code");

-- CreateIndex
CREATE INDEX "RawMaterialMovement_rawMaterialId_createdAt_idx" ON "RawMaterialMovement"("rawMaterialId", "createdAt");

-- CreateIndex
CREATE INDEX "Party_companyId_kind_status_idx" ON "Party"("companyId", "kind", "status");

-- CreateIndex
CREATE INDEX "Party_companyId_lastTransactionAt_idx" ON "Party"("companyId", "lastTransactionAt");

-- CreateIndex
CREATE UNIQUE INDEX "Party_companyId_code_key" ON "Party"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_partyId_key" ON "CampaignRecipient"("campaignId", "partyId");

-- CreateIndex
CREATE INDEX "Quotation_companyId_status_idx" ON "Quotation"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_companyId_number_key" ON "Quotation"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ProformaInvoice_quotationId_key" ON "ProformaInvoice"("quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProformaInvoice_companyId_number_key" ON "ProformaInvoice"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_proformaId_key" ON "SalesOrder"("proformaId");

-- CreateIndex
CREATE INDEX "SalesOrder_companyId_status_orderDate_idx" ON "SalesOrder"("companyId", "status", "orderDate");

-- CreateIndex
CREATE INDEX "SalesOrder_partyId_idx" ON "SalesOrder"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_companyId_number_key" ON "SalesOrder"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_companyId_integrationId_externalOrderId_key" ON "SalesOrder"("companyId", "integrationId", "externalOrderId");

-- CreateIndex
CREATE INDEX "SalesOrderItem_orderId_idx" ON "SalesOrderItem"("orderId");

-- CreateIndex
CREATE INDEX "SalesOrderItem_variantId_idx" ON "SalesOrderItem"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_orderId_key" ON "Invoice"("orderId");

-- CreateIndex
CREATE INDEX "Invoice_companyId_status_idx" ON "Invoice"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_companyId_number_key" ON "Invoice"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PackingList_orderId_key" ON "PackingList"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PackingList_companyId_number_key" ON "PackingList"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryChallan_companyId_number_key" ON "DeliveryChallan"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_journalEntryId_key" ON "Payment"("journalEntryId");

-- CreateIndex
CREATE INDEX "Payment_companyId_paymentDate_idx" ON "Payment"("companyId", "paymentDate");

-- CreateIndex
CREATE INDEX "Payment_partyId_idx" ON "Payment"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_companyId_number_key" ON "Payment"("companyId", "number");

-- CreateIndex
CREATE INDEX "WebhookEvent_companyId_status_idx" ON "WebhookEvent"("companyId", "status");

-- CreateIndex
CREATE INDEX "WebhookEvent_source_externalId_idx" ON "WebhookEvent"("source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "CourierAccount_companyId_provider_name_key" ON "CourierAccount"("companyId", "provider", "name");

-- CreateIndex
CREATE INDEX "Shipment_companyId_status_idx" ON "Shipment"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_courierAccountId_consignmentId_key" ON "Shipment"("courierAccountId", "consignmentId");

-- CreateIndex
CREATE INDEX "ShipmentEvent_shipmentId_occurredAt_idx" ON "ShipmentEvent"("shipmentId", "occurredAt");

-- CreateIndex
CREATE INDEX "SalesReturn_companyId_status_idx" ON "SalesReturn"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SalesReturn_companyId_number_key" ON "SalesReturn"("companyId", "number");

-- CreateIndex
CREATE INDEX "SalesReturnItem_returnId_idx" ON "SalesReturnItem"("returnId");

-- CreateIndex
CREATE INDEX "SalesReturnItem_qcStatus_idx" ON "SalesReturnItem"("qcStatus");

-- CreateIndex
CREATE INDEX "ProductionProject_companyId_status_targetDate_idx" ON "ProductionProject"("companyId", "status", "targetDate");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionProject_companyId_code_key" ON "ProductionProject"("companyId", "code");

-- CreateIndex
CREATE INDEX "ProductionStageLog_projectId_idx" ON "ProductionStageLog"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierBill_journalEntryId_key" ON "SupplierBill"("journalEntryId");

-- CreateIndex
CREATE INDEX "SupplierBill_supplierId_idx" ON "SupplierBill"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierBill_companyId_number_key" ON "SupplierBill"("companyId", "number");

-- CreateIndex
CREATE INDEX "SupplierBillAllocation_projectId_idx" ON "SupplierBillAllocation"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "StockIntake_companyId_number_key" ON "StockIntake"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "StockIntakeLine_intakeId_variantId_grade_key" ON "StockIntakeLine"("intakeId", "variantId", "grade");

-- CreateIndex
CREATE INDEX "LedgerAccount_companyId_type_subType_idx" ON "LedgerAccount"("companyId", "type", "subType");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_companyId_code_key" ON "LedgerAccount"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_reversalOfId_key" ON "JournalEntry"("reversalOfId");

-- CreateIndex
CREATE INDEX "JournalEntry_companyId_date_idx" ON "JournalEntry"("companyId", "date");

-- CreateIndex
CREATE INDEX "JournalEntry_sourceType_sourceId_idx" ON "JournalEntry"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_companyId_number_key" ON "JournalEntry"("companyId", "number");

-- CreateIndex
CREATE INDEX "JournalLine_accountId_idx" ON "JournalLine"("accountId");

-- CreateIndex
CREATE INDEX "JournalLine_partyId_idx" ON "JournalLine"("partyId");

-- CreateIndex
CREATE INDEX "JournalLine_employeeId_idx" ON "JournalLine"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_ledgerAccountId_key" ON "BankAccount"("ledgerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_companyId_accountNumber_key" ON "BankAccount"("companyId", "accountNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FixedAsset_ledgerAccountId_key" ON "FixedAsset"("ledgerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "CapitalSource_ledgerAccountId_key" ON "CapitalSource"("ledgerAccountId");

-- CreateIndex
CREATE INDEX "CapitalInstallment_capitalSourceId_dueDate_idx" ON "CapitalInstallment"("capitalSourceId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseHead_companyId_name_key" ON "ExpenseHead"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_journalEntryId_key" ON "Expense"("journalEntryId");

-- CreateIndex
CREATE INDEX "Expense_companyId_date_idx" ON "Expense"("companyId", "date");

-- CreateIndex
CREATE INDEX "Expense_employeeId_idx" ON "Expense"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_companyId_number_key" ON "Expense"("companyId", "number");

-- CreateIndex
CREATE INDEX "AdSpend_companyId_date_idx" ON "AdSpend"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_companyId_code_key" ON "Employee"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_companyId_userId_key" ON "Employee"("companyId", "userId");

-- CreateIndex
CREATE INDEX "SalaryRevision_employeeId_effectiveFrom_idx" ON "SalaryRevision"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_companyId_name_key" ON "LeaveType"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveBalance_employeeId_leaveTypeId_year_key" ON "LeaveBalance"("employeeId", "leaveTypeId", "year");

-- CreateIndex
CREATE INDEX "LeaveRequest_employeeId_startDate_idx" ON "LeaveRequest"("employeeId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_companyId_year_month_key" ON "PayrollRun"("companyId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollItem_journalEntryId_key" ON "PayrollItem"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollItem_runId_employeeId_key" ON "PayrollItem"("runId", "employeeId");

-- CreateIndex
CREATE INDEX "SalaryAdvance_employeeId_status_idx" ON "SalaryAdvance"("employeeId", "status");

-- CreateIndex
CREATE INDEX "ComplianceDocument_companyId_expiryDate_idx" ON "ComplianceDocument"("companyId", "expiryDate");

-- CreateIndex
CREATE INDEX "DocumentTemplate_companyId_documentType_idx" ON "DocumentTemplate"("companyId", "documentType");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTemplate_companyId_name_key" ON "DocumentTemplate"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TemplatePlaceholder_templateId_tag_key" ON "TemplatePlaceholder"("templateId", "tag");

-- CreateIndex
CREATE INDEX "GeneratedDocument_companyId_documentType_createdAt_idx" ON "GeneratedDocument"("companyId", "documentType", "createdAt");

-- CreateIndex
CREATE INDEX "GeneratedDocument_referenceType_referenceId_idx" ON "GeneratedDocument"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "ReportExport_companyId_createdAt_idx" ON "ReportExport"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "Note_companyId_userId_tab_idx" ON "Note"("companyId", "userId", "tab");

-- CreateIndex
CREATE INDEX "Task_companyId_status_dueAt_idx" ON "Task"("companyId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "Reminder_companyId_status_remindAt_idx" ON "Reminder"("companyId", "status", "remindAt");

-- CreateIndex
CREATE INDEX "ReminderRecipient_reminderId_idx" ON "ReminderRecipient"("reminderId");

-- CreateIndex
CREATE INDEX "NotificationLog_companyId_status_idx" ON "NotificationLog"("companyId", "status");

-- CreateIndex
CREATE INDEX "BackupRun_startedAt_idx" ON "BackupRun"("startedAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMembership" ADD CONSTRAINT "CompanyMembership_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMembership" ADD CONSTRAINT "CompanyMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMembership" ADD CONSTRAINT "CompanyMembership_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSequence" ADD CONSTRAINT "DocumentSequence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldDefinition" ADD CONSTRAINT "CustomFieldDefinition_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Style" ADD CONSTRAINT "Style_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Style" ADD CONSTRAINT "Style_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Style" ADD CONSTRAINT "Style_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Color" ADD CONSTRAINT "Color_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Size" ADD CONSTRAINT "Size_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "Color"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_sizeId_fkey" FOREIGN KEY ("sizeId") REFERENCES "Size"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SizeRatioPreset" ADD CONSTRAINT "SizeRatioPreset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SizeRatioEntry" ADD CONSTRAINT "SizeRatioEntry_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "SizeRatioPreset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SizeRatioEntry" ADD CONSTRAINT "SizeRatioEntry_sizeId_fkey" FOREIGN KEY ("sizeId") REFERENCES "Size"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadStockEntry" ADD CONSTRAINT "BadStockEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadStockEntry" ADD CONSTRAINT "BadStockEntry_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadStockEntry" ADD CONSTRAINT "BadStockEntry_salesReturnItemId_fkey" FOREIGN KEY ("salesReturnItemId") REFERENCES "SalesReturnItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BadStockEntry" ADD CONSTRAINT "BadStockEntry_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMaterial" ADD CONSTRAINT "RawMaterial_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMaterial" ADD CONSTRAINT "RawMaterial_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMaterialMovement" ADD CONSTRAINT "RawMaterialMovement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMaterialMovement" ADD CONSTRAINT "RawMaterialMovement_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "RawMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMaterialMovement" ADD CONSTRAINT "RawMaterialMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMaterialMovement" ADD CONSTRAINT "RawMaterialMovement_productionProjectId_fkey" FOREIGN KEY ("productionProjectId") REFERENCES "ProductionProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMaterialMovement" ADD CONSTRAINT "RawMaterialMovement_supplierBillId_fkey" FOREIGN KEY ("supplierBillId") REFERENCES "SupplierBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReEngagementCampaign" ADD CONSTRAINT "ReEngagementCampaign_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ReEngagementCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationStylingRule" ADD CONSTRAINT "QuotationStylingRule_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProformaInvoice" ADD CONSTRAINT "ProformaInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProformaInvoice" ADD CONSTRAINT "ProformaInvoice_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProformaInvoice" ADD CONSTRAINT "ProformaInvoice_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_proformaId_fkey" FOREIGN KEY ("proformaId") REFERENCES "ProformaInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "SalesChannelIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_overrideById_fkey" FOREIGN KEY ("overrideById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingList" ADD CONSTRAINT "PackingList_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingList" ADD CONSTRAINT "PackingList_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingListItem" ADD CONSTRAINT "PackingListItem_packingListId_fkey" FOREIGN KEY ("packingListId") REFERENCES "PackingList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingListItem" ADD CONSTRAINT "PackingListItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryChallan" ADD CONSTRAINT "DeliveryChallan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryChallan" ADD CONSTRAINT "DeliveryChallan_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryChallanItem" ADD CONSTRAINT "DeliveryChallanItem_challanId_fkey" FOREIGN KEY ("challanId") REFERENCES "DeliveryChallan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryChallanItem" ADD CONSTRAINT "DeliveryChallanItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_proformaId_fkey" FOREIGN KEY ("proformaId") REFERENCES "ProformaInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_supplierBillId_fkey" FOREIGN KEY ("supplierBillId") REFERENCES "SupplierBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesChannelIntegration" ADD CONSTRAINT "SalesChannelIntegration_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "SalesChannelIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierAccount" ADD CONSTRAINT "CourierAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_courierAccountId_fkey" FOREIGN KEY ("courierAccountId") REFERENCES "CourierAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentEvent" ADD CONSTRAINT "ShipmentEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturnItem" ADD CONSTRAINT "SalesReturnItem_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "SalesReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturnItem" ADD CONSTRAINT "SalesReturnItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturnItem" ADD CONSTRAINT "SalesReturnItem_inspectedById_fkey" FOREIGN KEY ("inspectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionProject" ADD CONSTRAINT "ProductionProject_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionProject" ADD CONSTRAINT "ProductionProject_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionProject" ADD CONSTRAINT "ProductionProject_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionProject" ADD CONSTRAINT "ProductionProject_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionProject" ADD CONSTRAINT "ProductionProject_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionProject" ADD CONSTRAINT "ProductionProject_proformaId_fkey" FOREIGN KEY ("proformaId") REFERENCES "ProformaInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionStageLog" ADD CONSTRAINT "ProductionStageLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBillAllocation" ADD CONSTRAINT "SupplierBillAllocation_billId_fkey" FOREIGN KEY ("billId") REFERENCES "SupplierBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBillAllocation" ADD CONSTRAINT "SupplierBillAllocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBillAllocation" ADD CONSTRAINT "SupplierBillAllocation_expenseHeadId_fkey" FOREIGN KEY ("expenseHeadId") REFERENCES "ExpenseHead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockIntake" ADD CONSTRAINT "StockIntake_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockIntake" ADD CONSTRAINT "StockIntake_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockIntake" ADD CONSTRAINT "StockIntake_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockIntakeLine" ADD CONSTRAINT "StockIntakeLine_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "StockIntake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockIntakeLine" ADD CONSTRAINT "StockIntakeLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapitalSource" ADD CONSTRAINT "CapitalSource_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapitalSource" ADD CONSTRAINT "CapitalSource_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapitalInstallment" ADD CONSTRAINT "CapitalInstallment_capitalSourceId_fkey" FOREIGN KEY ("capitalSourceId") REFERENCES "CapitalSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapitalInstallment" ADD CONSTRAINT "CapitalInstallment_paidFromAccountId_fkey" FOREIGN KEY ("paidFromAccountId") REFERENCES "LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseHead" ADD CONSTRAINT "ExpenseHead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseHead" ADD CONSTRAINT "ExpenseHead_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_headId_fkey" FOREIGN KEY ("headId") REFERENCES "ExpenseHead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_paidFromAccountId_fkey" FOREIGN KEY ("paidFromAccountId") REFERENCES "LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_salaryAdvanceId_fkey" FOREIGN KEY ("salaryAdvanceId") REFERENCES "SalaryAdvance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_receiptFileId_fkey" FOREIGN KEY ("receiptFileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdSpend" ADD CONSTRAINT "AdSpend_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryRevision" ADD CONSTRAINT "SalaryRevision_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveType" ADD CONSTRAINT "LeaveType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAdvance" ADD CONSTRAINT "SalaryAdvance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAdvance" ADD CONSTRAINT "SalaryAdvance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAdvance" ADD CONSTRAINT "SalaryAdvance_paidFromAccountId_fkey" FOREIGN KEY ("paidFromAccountId") REFERENCES "LedgerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceSettlement" ADD CONSTRAINT "AdvanceSettlement_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "SalaryAdvance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceSettlement" ADD CONSTRAINT "AdvanceSettlement_payrollItemId_fkey" FOREIGN KEY ("payrollItemId") REFERENCES "PayrollItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceSettlement" ADD CONSTRAINT "AdvanceSettlement_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceDocument" ADD CONSTRAINT "ComplianceDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceDocument" ADD CONSTRAINT "ComplianceDocument_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplatePlaceholder" ADD CONSTRAINT "TemplatePlaceholder_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportExport" ADD CONSTRAINT "ReportExport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportExport" ADD CONSTRAINT "ReportExport_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportExport" ADD CONSTRAINT "ReportExport_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_complianceDocumentId_fkey" FOREIGN KEY ("complianceDocumentId") REFERENCES "ComplianceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderRecipient" ADD CONSTRAINT "ReminderRecipient_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "Reminder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderRecipient" ADD CONSTRAINT "ReminderRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderRecipient" ADD CONSTRAINT "ReminderRecipient_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "Reminder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupRun" ADD CONSTRAINT "BackupRun_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
