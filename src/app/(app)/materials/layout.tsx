import { visibleMaterialsTabs } from "@/components/materials/tabs";
import { SectionTabs } from "@/components/shell/section-tabs";
import { requireCompanyPage } from "@/server/pages/guards";

/**
 * The Raw materials area: the overview, stock, purchase orders, purchases,
 * returns to suppliers and issue notes, each tab shown only to people whose
 * role opens it (components/materials/tabs.ts). Each page checks again through
 * its Server Action.
 */
export default async function MaterialsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCompanyPage();
  const tabs = visibleMaterialsTabs(ctx.permissions).map(({ href, label }) => ({ href, label }));

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <header className="grid gap-6">
        <div>
          <p className="eyebrow">{ctx.company.name}</p>
          <h1 className="mt-3 font-serif text-[2rem] leading-tight text-primary sm:text-[2.5rem]">
            Raw materials
          </h1>
        </div>
        {tabs.length > 0 && <SectionTabs label="Raw materials" tabs={tabs} />}
      </header>
      {children}
    </div>
  );
}
