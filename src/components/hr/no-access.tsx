import { SectionError } from "@/components/dashboard/section-error";
import { NoAccess } from "@/components/settings/no-access";
import type { ActionError } from "@/lib/result";

/** What the HR & payroll pages show to someone whose role does not open them. */
export function HrNoAccess({
  title = "HR & payroll is not part of your role",
  children = "HR keeps employees, attendance and leave, and Accounts pays salaries. Your administrator can give your role the permission to see them.",
}: {
  title?: string;
  children?: React.ReactNode;
}) {
  return <NoAccess title={title}>{children}</NoAccess>;
}

/** For payroll, payslips and statements, which carry salaries. */
export function SalariesNoAccess() {
  return (
    <HrNoAccess title="Salaries are not part of your role">
      Payroll, payslips and salaries show to HR managers, the people who prepare payroll and
      Accounts.
    </HrNoAccess>
  );
}

/** My HR for someone whose login is not linked to an employee yet. */
export function NotLinked({ message }: { message: string }) {
  return <NoAccess title="Your HR records are not set up yet">{message}</NoAccess>;
}

/** My HR for someone whose role does not include their own HR records. */
export function MyHrNoAccess() {
  return (
    <NoAccess title="My HR is not part of your role">
      My HR shows your own attendance, leave and payslips. Your administrator can give your role the
      permission to see them.
    </NoAccess>
  );
}

/** What a My HR page shows when it can't load: no access, no linked employee, or the error. */
export function MyHrProblem({
  error,
  title,
  heading,
}: {
  error: ActionError;
  title: string;
  heading: string;
}) {
  if (error.code === "FORBIDDEN") return <MyHrNoAccess />;
  if (error.code === "NOT_FOUND") return <NotLinked message={error.message} />;
  return <SectionError title={title} heading={heading} error={error} />;
}
