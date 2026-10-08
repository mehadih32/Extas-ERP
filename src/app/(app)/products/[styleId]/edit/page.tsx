import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { StyleForm } from "@/components/products/style-form";
import { BackLink } from "@/components/settings/back-link";
import { NoAccess } from "@/components/settings/no-access";
import { getStyleFormAction } from "@/server/actions/inventory.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Edit style" };

/** A style's details: for inventory.manage, the permission updateStyleAction checks. */
export default async function EditStylePage({ params }: { params: Promise<{ styleId: string }> }) {
  const ctx = await requireCompanyPage();
  if (!ctx.can("inventory.manage")) {
    return (
      <NoAccess title="Changing styles is not part of your role">
        Your administrator can give your role the permission to manage the catalogue and stock.
      </NoAccess>
    );
  }
  const { styleId } = await params;
  const result = await getStyleFormAction(styleId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return <SectionError title="Style" heading="The style could not load" error={result.error} />;
  }
  const { style, categories, brands } = result.data;
  if (!style) notFound();

  return (
    <div className="grid gap-6">
      <BackLink href={`/products/${style.id}`}>{style.name}</BackLink>
      <div>
        <p className="eyebrow">{style.code}</p>
        <h2 className="mt-2 font-serif text-2xl text-primary">Edit {style.name}</h2>
      </div>
      <StyleForm
        style={style}
        categories={categories}
        brands={brands}
        currency={ctx.company.currency}
      />
    </div>
  );
}
