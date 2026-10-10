import { NoAccess } from "@/components/settings/no-access";

/** What the Compliance pages show to someone whose role does not open them. */
export function ComplianceNoAccess() {
  return (
    <NoAccess title="Licences are not part of your role">
      The trade licence, VAT and tax registrations and their renewals are kept here. Your
      administrator can give your role the permission to see them.
    </NoAccess>
  );
}
