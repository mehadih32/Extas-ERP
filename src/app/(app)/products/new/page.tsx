import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { StyleForm } from "@/components/products/style-form";
import { BackLink } from "@/components/settings/back-link";
import { NoAccess } from "@/components/settings/no-access";
import { getStyleFormAction } from "@/server/actions/inventory.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "New style" };

/** A new style: for inventory.manage, the permission createStyleAction checks. */
export default async function NewStylePage() {
  const ctx = await requireCompanyPage();
  if (!ctx.can("inventory.manage")) {
    return (
      <NoAccess title="Adding styles is not part of your role">
        Your administrator can give your role the permission to manage the catalogue and stock.
      </NoAccess>
    );
  }
  const result = await getStyleFormAction();
  if (!result.ok) {
    return (
      <SectionError title="New style" heading="The form could not load" error={result.error} />
    );
  }
  const { categories, brands } = result.data;

  return (
    <div className="grid gap-6">
      <BackLink href="/products">All styles</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">New style</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          After adding the style, choose its colours and sizes to make its SKUs.
        </p>
      </div>
      {categories.length === 0 ? (
        <FormAlert tone="note">
          A style belongs to a category. Add one on the{" "}
          <Link href="/products/setup" className="font-medium underline underline-offset-4">
            Setup tab
          </Link>{" "}
          first.
        </FormAlert>
      ) : (
        <StyleForm
          style={null}
          categories={categories}
          brands={brands}
          currency={ctx.company.currency}
        />
      )}
    </div>
  );
}
