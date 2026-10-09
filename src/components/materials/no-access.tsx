import { NoAccess } from "@/components/settings/no-access";

/** What the Raw materials pages show to someone whose role does not open them. */
export function MaterialsNoAccess({
  title = "Raw materials are not part of your role",
  children = "The store, buying and Production Managers keep raw materials. Your administrator can give your role the permission to see them.",
}: {
  title?: string;
  children?: React.ReactNode;
}) {
  return <NoAccess title={title}>{children}</NoAccess>;
}

/** For the purchase and return pages, which carry prices. */
export function PricesNoAccess() {
  return (
    <MaterialsNoAccess title="Material prices are not part of your role">
      Purchases and returns to suppliers show to buyers, Production Managers and Accounts.
    </MaterialsNoAccess>
  );
}
