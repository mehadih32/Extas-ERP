import { NoAccess } from "@/components/settings/no-access";

/** What the Reports & documents pages show to someone whose role does not open them. */
export function ReportsNoAccess({
  title = "Reports are not part of your role",
  children = "Reports of sales, profit and stock are made by the owner, Accounts and production managers. Your administrator can give your role the permission to make them.",
}: {
  title?: string;
  children?: React.ReactNode;
}) {
  return <NoAccess title={title}>{children}</NoAccess>;
}

export function DocumentsNoAccess() {
  return (
    <ReportsNoAccess title="Printed documents are not part of your role">
      The PDFs made from the app show to the people who may print them: sales documents for sales,
      statements for whoever sees the ledgers, payslips for HR and Accounts.
    </ReportsNoAccess>
  );
}

export function TemplatesNoAccess() {
  return (
    <ReportsNoAccess title="Templates are not part of your role">
      The owner uploads and sets up the company&apos;s own document designs. Your administrator can
      give your role the permission to change them.
    </ReportsNoAccess>
  );
}
