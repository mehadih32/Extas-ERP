-- Why a payroll line's other deductions were taken, shown on the payslip.
-- Additive: existing lines keep no reason until their payroll is changed.
ALTER TABLE "PayrollItem" ADD COLUMN "deductionReason" TEXT;
