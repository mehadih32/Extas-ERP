import type { Metadata } from "next";

import { EcommerceScreen } from "@/components/business/ecommerce-screen";
import { SectionError } from "@/components/dashboard/section-error";
import { NoAccess } from "@/components/settings/no-access";
import { ecommercePageAction } from "@/server/actions/retail.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "E-commerce" };

/** Business > Retail > E-commerce: every online store together and side by side. */
export default async function EcommercePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompanyPage();
  const query = await searchParams;
  const one = (v: unknown) => (typeof v === "string" ? v : undefined);
  const result = await ecommercePageAction({
    period: one(query.period),
    from: one(query.from),
    to: one(query.to),
  });
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
        title="E-commerce"
        heading="The online stores could not load"
        error={result.error}
      />
    );
  }
  return <EcommerceScreen page={result.data} />;
}
