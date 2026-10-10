import { NoAccess } from "@/components/settings/no-access";

/** What the Planner pages show to someone whose role does not open them. */
export function PlannerNoAccess({
  title = "This part of the Planner is not part of your role",
  children = "Your administrator can give your role the permission to use it.",
}: {
  title?: string;
  children?: React.ReactNode;
}) {
  return <NoAccess title={title}>{children}</NoAccess>;
}

export function NotepadNoAccess() {
  return (
    <PlannerNoAccess title="The notepad is not part of your role">
      The notepad keeps your own daily routine, work plan and notes. Your administrator can give
      your role the permission to use it.
    </PlannerNoAccess>
  );
}

export function TasksNoAccess() {
  return (
    <PlannerNoAccess title="Giving tasks is not part of your role">
      Managers give tasks to staff here. Tasks given to you are in My HR.
    </PlannerNoAccess>
  );
}

export function RulesNoAccess() {
  return (
    <PlannerNoAccess title="Automatic reminders are not part of your role">
      The owner sets when the app reminds people about deadlines, deliveries, shipments, renewals
      and tasks.
    </PlannerNoAccess>
  );
}
