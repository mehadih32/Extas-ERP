import type { Metadata } from "next";

import { StoresScreen } from "@/components/business/stores-screen";
import { SectionError } from "@/components/dashboard/section-error";
import { NoAccess } from "@/components/settings/no-access";
import { listStoresAction } from "@/server/actions/retail.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Retail stores" };

/** Business > Retail stores: every store and "Add store" (retail.view / retail.manage). */
export default async function StoresPage() {
  await requireCompanyPage();
  const result = await listStoresAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <NoAccess title="Retail stores are not part of your role">
          Your administrator can give your role the permission to see the retail stores.
        </NoAccess>
      );
    }
    return (
      <SectionError
        title="Retail stores"
        heading="The retail stores could not load"
        error={result.error}
      />
    );
  }
  return <StoresScreen list={result.data} />;
}
