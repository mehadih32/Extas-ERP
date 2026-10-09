import { NoAccess } from "@/components/settings/no-access";

/** What the Buyers & suppliers pages show to someone whose role does not open them. */
export function PartiesNoAccess({
  title = "Buyers and suppliers are not part of your role",
  children = "Your administrator can give your role the permission to see buyers and suppliers.",
}: {
  title?: string;
  children?: React.ReactNode;
}) {
  return <NoAccess title={title}>{children}</NoAccess>;
}
