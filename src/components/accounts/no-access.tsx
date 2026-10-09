import { NoAccess } from "@/components/settings/no-access";

/** What the Accounts pages show to someone whose role does not open them. */
export function AccountsNoAccess({
  title = "The books are not part of your role",
  children = "Balances, ledgers and financial reports show to Accounts and the owner. Your administrator can give your role the permission to see them.",
}: {
  title?: string;
  children?: React.ReactNode;
}) {
  return <NoAccess title={title}>{children}</NoAccess>;
}
