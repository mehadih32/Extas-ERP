import { visibleProductionTabs } from "@/components/production/tabs";
import { SectionTabs } from "@/components/shell/section-tabs";
import { requireCompanyPage } from "@/server/pages/guards";

/**
 * The Production area: the overview, projects, factory deliveries, supplier
 * bills and cost heads, each tab shown only to people whose role opens it
 * (components/production/tabs.ts). Each page checks again through its Server Action.
 */
export default async function ProductionLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCompanyPage();
  const tabs = visibleProductionTabs(ctx.permissions).map(({ href, label }) => ({ href, label }));

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <header className="grid gap-6">
        <div>
          <p className="eyebrow">{ctx.company.name}</p>
          <h1 className="mt-3 font-serif text-[2rem] leading-tight text-primary sm:text-[2.5rem]">
            Production
          </h1>
        </div>
        {tabs.length > 0 && <SectionTabs label="Production" tabs={tabs} />}
      </header>
      {children}
    </div>
  );
}
