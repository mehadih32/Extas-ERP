import { NoAccess } from "@/components/settings/no-access";

/** What the Production pages show to someone whose role does not open them. */
export function ProductionNoAccess({
  title = "Production is not part of your role",
  children = "Your administrator can give your role the permission to see production projects and factory deliveries.",
}: {
  title?: string;
  children?: React.ReactNode;
}) {
  return <NoAccess title={title}>{children}</NoAccess>;
}
