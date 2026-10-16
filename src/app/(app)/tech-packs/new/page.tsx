import type { Metadata } from "next";

import { productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { BackLink } from "@/components/settings/back-link";
import { NewTechPackForm } from "@/components/tech-packs/new-tech-pack-form";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "New tech pack" };

/**
 * New tech pack: from the buyer's brief and references, before any order or
 * production project exists (production.manage, checked again when it is saved).
 */
export default async function NewTechPackPage() {
  const ctx = await requireCompanyPage();
  if (!ctx.can("production.manage")) {
    return (
      <ProductionNoAccess title="Starting tech packs is not part of your role">
        Your administrator can give your role the permission to manage production, which starts and
        changes tech packs.
      </ProductionNoAccess>
    );
  }
  return (
    <div className="grid gap-6">
      <BackLink href={productionHref.techPacks()}>All tech packs</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">New tech pack</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Start it from what the buyer sent: the brief, photos, a PDF or a link. No order or
          production project is needed; link it to one when the order comes.
        </p>
      </div>
      <NewTechPackForm />
    </div>
  );
}
