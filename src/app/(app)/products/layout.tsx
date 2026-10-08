import { visibleProductsTabs } from "@/components/products/tabs";
import { SectionTabs } from "@/components/shell/section-tabs";
import { requireCompanyPage } from "@/server/pages/guards";

/**
 * The Products area: styles and their stock matrix, stock counts, bad stock and
 * the catalogue setup, each tab shown only to people whose role opens it
 * (components/products/tabs.ts). Each page checks again through its Server Action.
 */
export default async function ProductsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCompanyPage();
  const tabs = visibleProductsTabs(ctx.permissions).map(({ href, label }) => ({ href, label }));

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <header className="grid gap-6">
        <div>
          <p className="eyebrow">{ctx.company.name}</p>
          <h1 className="mt-3 font-serif text-[2rem] leading-tight text-primary sm:text-[2.5rem]">
            Products
          </h1>
        </div>
        {tabs.length > 0 && <SectionTabs label="Products" tabs={tabs} />}
      </header>
      {children}
    </div>
  );
}
