import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { SetupScreen } from "@/components/products/setup/setup-screen";
import { NoAccess } from "@/components/settings/no-access";
import { getCatalogSetupAction } from "@/server/actions/inventory.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Catalogue setup" };

/**
 * Colours, sizes, categories, brands and warehouses (inventory.view to read them,
 * inventory.manage to change them, as the inventory actions check).
 */
export default async function SetupPage() {
  await requireCompanyPage();
  const result = await getCatalogSetupAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <NoAccess title="Products are not part of your role">
          Your administrator can give your role the permission to see the stock and the product
          matrix.
        </NoAccess>
      );
    }
    return <SectionError title="Setup" heading="The setup could not load" error={result.error} />;
  }

  return (
    <section aria-labelledby="setup-heading" className="grid gap-6">
      <div>
        <h2 id="setup-heading" className="font-serif text-2xl text-primary">
          Setup
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          What styles are built from, and where the stock is kept.
        </p>
      </div>
      <SetupScreen setup={result.data} />
    </section>
  );
}
