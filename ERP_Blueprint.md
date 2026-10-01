# Version: 1.6 (Complete Enterprise Apparel ERP with PWA, Multi-Company, Matrix Wholesale, AI Stock Intake, Courier Sync, Returns QC, Force Override, Dynamic Template Builder, Smart WhatsApp Reminders, RBAC, 360° Lifetime Ledgers, Grading, Verified Badges & Dormant Buyer Re-engagement)
# Role: Expert Full-Stack Developer, DevOps & ERP Architect

## Project Overview & Rules of Engagement
You are building a custom, highly scalable ERP for a Premium Apparel Brand operating in E-commerce, Wholesale, and Custom B2B Pre-orders. 
**USER PERSONA:** The user is a NON-TECHNICAL Project Manager. 
**CRITICAL RULE (NO CONTEXT COLLAPSE):** Do NOT generate the entire application code at once. You must build iteratively. 
**WORKFLOW:** 
1. First, generate the complete `schema.prisma` file. Ask the user: "Should I proceed with setting up the Next.js project and Database connection?"
2. Wait for the user's "Yes".
3. Build ONE module at a time, asking for permission before moving to the next.

## Tech Stack & Architecture
* **Framework:** Next.js (App Router, Server Actions).
* **Database:** PostgreSQL with Prisma ORM.
* **Styling:** Tailwind CSS + shadcn/ui.
* **Mobile & PWA:** 100% Mobile-Friendly (Responsive tables with horizontal scroll, Bottom Navigation on mobile). Implement **PWA (Progressive Web App)** support so users and employees can "Add to Home Screen" on iOS/Android for a native app experience.
* **Deployment (Azure VPS):** Must provide a complete `docker-compose.yml` and a step-by-step terminal copy-paste guide for an Ubuntu VPS.
* **Theme Colors & Top-Notch Aesthetics:** Use #0B3D2E (Dark Green) as primary, #BE1434 (Deep Red) for alerts/accents, and #F8F8F8 (Off-White) for backgrounds. Maintain a high-end, minimalist **"Ralph Lauren editorial"** luxury multinational aesthetic across all UI components, typography, and PDF/Letterhead printouts.
* **Global Error Handling:** Implement a strict Error Boundary. Never show a blank screen or technical stack trace. Show a styled modal: "An error occurred. Error Code: [Random ID]. Please share this with your technical support."

## Comprehensive Database & Module Specs

### 1. Global Master Dashboard, RBAC, Audit Logs & Reports
* **Multi-Company Switcher:** A top-nav dropdown to seamlessly switch between distinct business entities (e.g., "Extras" and "Fabric Apparel") ensuring complete data isolation per company.
* **Role-Based Access Control (RBAC):** Strict permission layers for Super Admin, Production Manager, Sales Executive, Warehouse Team, and Employee Portal.
* **Metrics Cards (With 👁 Hide/Show Icon):** Total Active Stock Value, Fixed Assets, Liabilities (Loans/Investors), Today's Sales, Net Profit.
* **Insights Widget:** Top Selling SKUs, Highest Stock items, Dead/Slow Stock Alert, Low Stock Warning (< 5 pieces).
* **Marketing Sync:** Today's Ad Spend vs. Retail Sales (ROAS indicator).
* **Top Nav & Blank Pad Generator:** Global `(+) Quick Add` button (Dropdown: Expense, Quick Sale, Conveyance, Quotation, New Production). Include a one-click option to print/download a clean, professional **Blank Company Letterhead Pad** (header and footer with office info/logo, blank middle body).
* **Audit Trail / Activity Log:** Background security log tracking critical actions (e.g., force-overrides, invoice edits, deletions) with timestamp and user ID.
* **Report Builder:** A modal to generate downloadable PDF/Excel reports (1-week, 1-month, 1-year) selecting specific metrics.

### 2. Sales, Orders, Retail, Wholesale & Dormant Buyer Pipeline
* **Quotation Builder & Dynamic Custom Fields:** 
  * Fields: Buyer Details, Product Category, Quantity, Fabric.
  * Allow user to input highly specific styling rules (e.g., "The placket should not have a black border", "Collar, cuff, and logo — the golden color should be a little brighter"). Output: Premium PDF quotation on company letterhead.
* **Retail E-commerce & Courier Integration:**
  * **Website Sync:** Real-time order sync via API/Webhook from e-commerce platforms or manual POS entry for social commerce.
  * **Courier API (Pathao / Steadfast):** Create consignments directly from ERP. Auto-update status to "Delivered" upon successful payout/delivery.
  * **Pending Returns Pool & QC Check:** When parcels are marked "Returned", items land in a transit pool ("Pending Returns to Check: X pcs"). Staff physically inspects items: option to **"Move to Main Stock"** (restocks active inventory) or **"Move to Bad Stock"** (logs as inventory loss).
* **Matrix Order Entry & Ratio Auto-Fill (Wholesale):**
  * When selecting a master style, open a popup **Matrix Grid** (Rows: Colors with visual hex codes, Columns: Sizes S to 3XL) showing current available stock per cell, with a **"Ratio Fill"** shortcut.
* **Stock Limit Validation & Force Override:**
  * Strict validation preventing invoice creation if requested quantity exceeds available stock, with a `[✔] Force Override & Sell` popup warning option.
* **Order Conversion & 3-Document Flow:**
  * One-click convert Quotation to Proforma Invoice (PI) with 30% Advance trigger (routes funds to Accounts & creates Production project).
  * **Multi-Document Generation on Checkout (Optional checkboxes):**
    1. **Commercial Invoice:** Sent to buyer with prices, totals, paid/due breakdown. Saved permanently in backend buyer profile.
    2. **Packing List / Pick-List:** Detailed breakdown for warehouse/sales team.
    3. **Delivery Challan:** Price-free official transport document. Historical lookup available anytime.
* **Inactive / Dormant B2B Buyer Re-engagement:** Filter wholesale buyers by inactivity timeframes (e.g., no transaction in 6/12 months) to view dormant lists and trigger one-click re-engagement campaigns or catalog shares.

### 3. Production & Batch Costing Module
* **Production Overview Dashboard:** Display dedicated project cards for each active production with timelines (Elapsed & Remaining days, turning RED if overdue) and stage badges (Fabric Sourcing, Cutting, Sewing, Wash/QC, Finishing).
* **Create Production Project Modal:** Project Name, Item Category, Factory Name, Target Completion Date, Target Quantity, Buyer Name (or "In-House").
* **Cost Allocation & Cash vs. Due Purchases:** Expense heads with payment type (**Cash/Bank** directly from cash balance or **Due** to supplier ledger).
* **Split Bill Logic:** Split single supplier bills dynamically across multiple active batches/projects.
* **Move to Stock (AI Photo Intake & Manual Bridge):** Upload factory packing list photo/PDF for AI OCR parsing of sizes/colors, allocating costs across A-Grade and B-Grade quantities.

### 4. Smart Inventory, 360° Profiles & Financial Overviews
* **Tree-Navigation:** Category -> Brand -> Style -> Matrix View. Plus dedicated **"Raw Materials & Accessories Stock"** tracking as Current Assets.
* **One-Click Stock Availability Share:** Select brand/style and export a price-free, quantity-only stock availability matrix on company letterhead via WhatsApp/Email/PDF.
* **360° Buyer & Supplier Profiles (Grading & Verified):**
  * Profiles equipped with **Grading System** (A+, A, B, C), **"Blue Verified" Badge** 💙, and account status (`Active` vs `Closed / Dormant` with settling phase for pending dues).
* **Lifetime Ledger & Statement Generator:** One-click lifetime financial summary and itemized statement PDF (Summary on Page 1, detailed date-wise transaction log on subsequent pages).
* **Total Receivables & Payables Master Overview:** One-click reports displaying total market dues from buyers and total market payables to suppliers with structured breakdown pages.
* **Bad Stock Management:** Move SKU quantities to "Bad Stock" and log purchase value as inventory loss.

### 5. Accounts, Finance & Automated Backup
* **Asset & Capital Ledgers:** Fixed Assets, Capital & Investors, Installment Payouts.
* **Bank Statements Sub-Module:** Formal bank-compliant PDF reports for loan applications.
* **Automated P&L:** Gross Profit (Sales - COGS) and Net Profit (Gross Profit - Expenses).
* **Automated Daily Backups:** Scheduled cron job backing up PostgreSQL database and uploaded media, syncing to **Google Drive (Google One)** with local PC download option.

### 6. HR, Payroll, Compliance Profile & Dynamic Template Manager
* **Company Compliance Dashboard:** Store company legal credentials (Trade License, VAT/Tax ID) with **Expiry Date / Renewal Alerts**.
* **Dynamic Document & Template Manager:** Dedicated section allowing management to upload custom templates (PDF, Word, Image, HTML) for invoices or letterheads with tag mapping (`{CompanyName}`, `{BuyerName}`, `{TotalAmount}`).
* **Employee Profiles & Simplified Employee Portal:** 360-degree profile, leave balance, historical salary, and a mobile-friendly employee view for orders and expenses.
* **Smart Conveyance Tracking:** Expenses tagged as "Conveyance/Food" force selection of employee and purpose, generating printable physical forms and auto-deducting salary advances.

### 7. Notepad, Daily Workflow & Smart WhatsApp Reminders
* **Digital Notepad & Planner:** Built-in section featuring tabs for `[Daily Routine]`, `[Next 3 Days Work Plan]`, and `[General Notes]`.
* **Smart Automated Reminder System:** Trigger-based notifications for production deadlines, goods in-house dates, and shipments. Integrated with **WhatsApp Business API & Email** to alert both Management and assigned staff (e.g., reminding employee Nazrul about factory visits) with in-app task tracking.

## First Action Required from AI:
Acknowledge these strict rules. Output the complete, fully relational `schema.prisma` file that covers everything above (Multi-Tenant Companies, RBAC, Production Projects, Retail/Courier Sync, Returns QC, Wholesale Matrix & 3-Document Flow, 360° Buyer/Supplier Ledgers with Grading & Verified Badges, Dormant Buyer Re-engagement, Inventory & Raw Materials, HR, Compliance, Dynamic Templates, Reminders, Audit Logs, Backups, and Notepad). Do not output any UI code yet. Ask for my confirmation to proceed.
