import { NoAccess } from "@/components/settings/no-access";

/** What the Sales pages show to someone whose role does not open them. */
export function SalesNoAccess({
  title = "Sales is not part of your role",
  children = "Your administrator can give your role the permission to see quotations, orders and invoices.",
}: {
  title?: string;
  children?: React.ReactNode;
}) {
  return <NoAccess title={title}>{children}</NoAccess>;
}
