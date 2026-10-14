import { NoAccess } from "@/components/settings/no-access";

/** What the AI Center shows to someone whose role does not open it. */
export function AiNoAccess({
  title = "The AI Center is not part of your role",
  children = "The owner sees and sets what the AI does. Your administrator can give your role the permission to see the AI Center.",
}: {
  title?: string;
  children?: React.ReactNode;
}) {
  return <NoAccess title={title}>{children}</NoAccess>;
}
