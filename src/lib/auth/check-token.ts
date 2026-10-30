/*
 * The Full check's sessions (AI Center > Full check) carry tokens that start
 * with this, so the server knows them before it looks anything up. On the live
 * site such a session only reads: src/proxy.ts lets it open screens and the API
 * routes listed below as read-only, and refuses everything else (deny by
 * default: a new route stays refused until it is listed here, and
 * tests/unit/full-check.test.ts fails until it is). Underneath, every write it
 * reaches is refused too (src/lib/read-only.ts). The routes it must never open
 * are refused on the demo site as well.
 */
export const CHECK_TOKEN_PREFIX = "fullcheck.";

export const isCheckToken = (token: string | undefined) =>
  !!token && token.startsWith(CHECK_TOKEN_PREFIX);

/**
 * API routes that answer GET and never open for a check session, on any site,
 * with the reason.
 */
export const CHECK_NEVER_ROUTES: ReadonlyArray<{ route: string; why: string }> = [
  {
    route: "/api/v1/ecommerce/health",
    why: "The online shops' API: it answers only a shop's own API key, never a session.",
  },
  {
    route: "/api/v1/ecommerce/catalog/variants",
    why: "The online shops' API: it answers only a shop's own API key, never a session.",
  },
  {
    route: "/api/v1/ecommerce/stock",
    why: "The online shops' API: it answers only a shop's own API key, never a session.",
  },
  {
    route: "/api/v1/ecommerce/account",
    why: "The online shops' API: it answers only a shop's own API key, never a session.",
  },
  {
    route: "/api/v1/ecommerce/exchanges",
    why: "The online shops' API: it answers only a shop's own API key, never a session.",
  },
  {
    route: "/api/v1/ecommerce/returns",
    why: "The online shops' API: it answers only a shop's own API key, never a session.",
  },
  {
    route: "/api/v1/ecommerce/returns/claims",
    why: "The online shops' API: it answers only a shop's own API key, never a session.",
  },
  {
    route: "/api/v1/ecommerce/returns/summary",
    why: "The online shops' API: it answers only a shop's own API key, never a session.",
  },
  {
    route: "/api/v1/ecommerce/daily-summaries",
    why: "The online shops' API: it answers only a shop's own API key, never a session.",
  },
  {
    route: "/api/v1/ecommerce/fixed-costs",
    why: "The online shops' API: it answers only a shop's own API key, never a session.",
  },
  {
    route: "/api/v1/ecommerce/stock/[sku]",
    why: "The online shops' API: it answers only a shop's own API key, never a session.",
  },
  {
    route: "/api/backups/google/connect",
    why: "It starts the Google sign-in for backups and saves its state: not a read.",
  },
  {
    route: "/api/backups/drive",
    why: "It asks Google Drive for the list of backups, with the owner's Google sign-in.",
  },
  {
    route: "/api/backups/guide",
    why: "It makes the restore guide with the restore details, and records who downloaded it.",
  },
  {
    route: "/api/backups/runs/[runId]/download",
    why: "It hands out a whole backup of the ERP: no check needs one.",
  },
  {
    route: "/api/bot/whatsapp/webhook",
    why: "It is WhatsApp's own handshake with the ERP, not a screen of the ERP.",
  },
];

/** API routes that answer GET and only read: the check may open them on the live site. */
export const CHECK_READ_ROUTES: readonly string[] = [
  "/api/accounts/assets",
  "/api/accounts/assets/[assetId]",
  "/api/accounts/bank-accounts",
  "/api/accounts/bank-accounts/[bankAccountId]",
  "/api/accounts/bank-accounts/[bankAccountId]/statement",
  "/api/accounts/capital",
  "/api/accounts/capital/[sourceId]",
  "/api/accounts/cash-accounts",
  "/api/accounts/chart",
  "/api/accounts/chart/[accountId]",
  "/api/accounts/chart/[accountId]/ledger",
  "/api/accounts/depreciation",
  "/api/accounts/installments",
  "/api/accounts/journal",
  "/api/accounts/journal/[entryId]",
  "/api/accounts/overview",
  "/api/accounts/reports/balance-sheet",
  "/api/accounts/reports/books-check",
  "/api/accounts/reports/profit-and-loss",
  "/api/accounts/reports/trial-balance",
  "/api/accounts/supplier-payments",
  "/api/accounts/supplier-payments/[paymentId]",
  "/api/ai/costs/export",
  "/api/audit-logs",
  "/api/auth/appearance",
  "/api/auth/me",
  "/api/backups/drill",
  "/api/backups/runs",
  "/api/backups/runs/[runId]",
  "/api/backups/settings",
  "/api/business/report",
  "/api/business/stores/[storeId]/logo",
  "/api/business/year-reports/[reportId]",
  "/api/companies",
  "/api/company",
  "/api/company/logo",
  "/api/compliance",
  "/api/compliance/[recordId]",
  "/api/compliance/[recordId]/scan",
  "/api/compliance/summary",
  "/api/dashboard/action-zone",
  "/api/dashboard/activity",
  "/api/dashboard/cards",
  "/api/dashboard/home",
  "/api/dashboard/insights",
  "/api/dashboard/pipeline",
  "/api/dashboard/predictive",
  "/api/dashboard/preferences",
  "/api/dashboard/section-order",
  "/api/documents",
  "/api/documents/[documentId]",
  "/api/documents/[documentId]/download",
  "/api/expenses",
  "/api/expenses/[expenseId]",
  "/api/expenses/heads",
  "/api/files/[fileId]",
  "/api/full-check/shots/[problemId]",
  "/api/health",
  "/api/hr/advances",
  "/api/hr/advances/[advanceId]",
  "/api/hr/attendance",
  "/api/hr/attendance/summary",
  "/api/hr/claims",
  "/api/hr/employees",
  "/api/hr/employees/[employeeId]",
  "/api/hr/employees/[employeeId]/attendance",
  "/api/hr/employees/[employeeId]/clearance",
  "/api/hr/employees/[employeeId]/photo",
  "/api/hr/employees/[employeeId]/report",
  "/api/hr/employees/[employeeId]/score",
  "/api/hr/employees/[employeeId]/statement",
  "/api/hr/employees/[employeeId]/vault",
  "/api/hr/employees/directory",
  "/api/hr/holidays",
  "/api/hr/items",
  "/api/hr/leave",
  "/api/hr/leave-types",
  "/api/hr/leave/[leaveId]",
  "/api/hr/leave/balances",
  "/api/hr/money",
  "/api/hr/money/breakdown",
  "/api/hr/notices",
  "/api/hr/overtime",
  "/api/hr/pay-details-requests",
  "/api/hr/payroll",
  "/api/hr/payroll/[runId]",
  "/api/hr/payroll/[runId]/items/[itemId]/payslip",
  "/api/hr/settings",
  "/api/hr/staff-map",
  "/api/hr/terms",
  "/api/hr/work-places",
  "/api/integrations/status",
  "/api/inventory/brands",
  "/api/inventory/categories",
  "/api/inventory/colors",
  "/api/inventory/lookup",
  "/api/inventory/ratio-presets",
  "/api/inventory/sizes",
  "/api/inventory/stock/bad-stock",
  "/api/inventory/stock/lots",
  "/api/inventory/stock/movements",
  "/api/inventory/stock/summary",
  "/api/inventory/styles",
  "/api/inventory/styles/[styleId]",
  "/api/inventory/styles/[styleId]/matrix",
  "/api/inventory/tree",
  "/api/inventory/variants/[variantId]",
  "/api/inventory/warehouses",
  "/api/materials",
  "/api/materials/[materialId]",
  "/api/materials/[materialId]/stock-card",
  "/api/materials/issues",
  "/api/materials/issues/[issueId]",
  "/api/materials/movements",
  "/api/materials/purchase-orders",
  "/api/materials/purchase-orders/[orderId]",
  "/api/materials/purchase-orders/[orderId]/pdf",
  "/api/materials/purchases",
  "/api/materials/purchases/[billId]",
  "/api/materials/summary",
  "/api/materials/supplier-returns",
  "/api/materials/supplier-returns/[returnId]",
  "/api/members",
  "/api/notepad",
  "/api/notifications",
  "/api/notifications/unread-count",
  "/api/parties",
  "/api/parties/[partyId]",
  "/api/parties/[partyId]/buyer-360",
  "/api/parties/[partyId]/statement",
  "/api/parties/[partyId]/supplier-360",
  "/api/parties/campaigns",
  "/api/parties/campaigns/[campaignId]",
  "/api/parties/dormant",
  "/api/parties/receivables-payables",
  "/api/permissions",
  "/api/portal/advances",
  "/api/portal/attendance",
  "/api/portal/claims",
  "/api/portal/items",
  "/api/portal/leave",
  "/api/portal/ledger",
  "/api/portal/location/duty",
  "/api/portal/me",
  "/api/portal/notices",
  "/api/portal/payslips",
  "/api/portal/payslips/[itemId]",
  "/api/portal/profile",
  "/api/portal/score",
  "/api/portal/tasks",
  "/api/production/batches",
  "/api/production/batches/[batchId]",
  "/api/production/batches/[batchId]/action-log",
  "/api/production/batches/[batchId]/booking-book",
  "/api/production/batches/[batchId]/bookings",
  "/api/production/batches/[batchId]/cm-settlement",
  "/api/production/batches/[batchId]/contracts",
  "/api/production/batches/[batchId]/date-warnings",
  "/api/production/batches/[batchId]/issue",
  "/api/production/batches/[batchId]/materials",
  "/api/production/batches/[batchId]/payments",
  "/api/production/batches/[batchId]/receive",
  "/api/production/batches/[batchId]/summary",
  "/api/production/batches/[batchId]/summary/pdf",
  "/api/production/bills",
  "/api/production/bills/[billId]",
  "/api/production/bookings",
  "/api/production/bookings/[bookingId]",
  "/api/production/bookings/[bookingId]/pdf",
  "/api/production/cm-settlements/[settlementId]/pdf",
  "/api/production/contracts/[contractId]",
  "/api/production/contracts/[contractId]/pdf",
  "/api/production/cost-heads",
  "/api/production/faults",
  "/api/production/intakes",
  "/api/production/intakes/[intakeId]",
  "/api/production/overview",
  "/api/production/projects",
  "/api/production/projects/[projectId]",
  "/api/production/projects/[projectId]/action-log",
  "/api/production/projects/[projectId]/challans",
  "/api/production/projects/[projectId]/costs",
  "/api/production/projects/[projectId]/cutting",
  "/api/production/projects/[projectId]/finishing",
  "/api/production/projects/[projectId]/material-needs",
  "/api/production/projects/[projectId]/materials",
  "/api/production/projects/[projectId]/tech-pack",
  "/api/production/projects/[projectId]/tech-pack/approval",
  "/api/production/projects/[projectId]/tech-pack/logos/[logoId]/brief",
  "/api/production/projects/[projectId]/tech-pack/logos/[logoId]/file",
  "/api/production/projects/[projectId]/tech-pack/measurements",
  "/api/production/suppliers/[supplierId]/report-card",
  "/api/reminders",
  "/api/reminders/[reminderId]",
  "/api/reminders/rules",
  "/api/reminders/upcoming",
  "/api/reports/builder",
  "/api/reports/exports",
  "/api/reports/exports/[exportId]",
  "/api/reports/exports/[exportId]/download",
  "/api/reports/preview",
  "/api/roles",
  "/api/sales/buyers/[partyId]/dues",
  "/api/sales/challans",
  "/api/sales/challans/[challanId]",
  "/api/sales/cheques",
  "/api/sales/custom-fields",
  "/api/sales/invoices",
  "/api/sales/invoices/[invoiceId]",
  "/api/sales/orders",
  "/api/sales/orders/[orderId]",
  "/api/sales/packing-lists/[packingListId]",
  "/api/sales/payments",
  "/api/sales/payments/[paymentId]",
  "/api/sales/proformas",
  "/api/sales/proformas/[proformaId]",
  "/api/sales/quotations",
  "/api/sales/quotations/[quotationId]",
  "/api/sales/refunds",
  "/api/sales/refunds/[refundId]",
  "/api/sales/returns",
  "/api/sales/returns/[returnId]",
  "/api/sales/summary",
  "/api/tasks",
  "/api/tasks/[taskId]",
  "/api/tech-packs/[techPackId]/logos/[logoId]/brief",
  "/api/tech-packs/[techPackId]/logos/[logoId]/file",
  "/api/tech-packs/[techPackId]/measurements",
  "/api/tech-packs/[techPackId]/pdf",
  "/api/templates",
  "/api/templates/[templateId]",
  "/api/templates/[templateId]/file",
  "/api/templates/catalog",
  "/api/terms",
];

/** "/api/sales/orders/[orderId]" as a test of a path: each [part] is one segment. */
const toPattern = (route: string) =>
  new RegExp(
    `^${route
      .split("/")
      .map((part) =>
        /^\[[^\]]+\]$/.test(part) ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      )
      .join("/")}$`,
  );

const NEVER = CHECK_NEVER_ROUTES.map((n) => toPattern(n.route));
const READ = CHECK_READ_ROUTES.map(toPattern);

/** A path the check may not be trusted with: dots, empty or encoded parts. */
const odd = (pathname: string) => /(^|\/)\.{1,2}(\/|$)|\/\/|%2e|%2f|%5c|\\/i.test(pathname);

/**
 * Whether a request may go ahead. Everyone else's are untouched. A check
 * session never opens the routes it must never open; on the demo site it may do
 * anything else (the demo site's data is made up); on the live site it only
 * reads screens and the read-only API routes.
 */
export function checkMayDo(
  method: string,
  token: string | undefined,
  demoSite: boolean,
  pathname: string,
): boolean {
  if (!isCheckToken(token)) return true;
  if (odd(pathname)) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  if (NEVER.some((re) => re.test(path))) return false;
  if (demoSite) return true;
  if (method !== "GET" && method !== "HEAD") return false;
  if (path === "/api" || path.startsWith("/api/")) return READ.some((re) => re.test(path));
  return true;
}
