import { SectionTabs } from "@/components/shell/section-tabs";
import { requireCompanyPage } from "@/server/pages/guards";

/**
 * Business (plan v6): the retail side of the company, under "Dashboard" in the
 * menu. Its pages: Retail stores and Returns.
 */
export default async function BusinessLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCompanyPage();

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <header className="grid gap-6">
        <div>
          <p className="eyebrow">{ctx.company.name}</p>
          <h1 className="mt-3 font-serif text-[2rem] leading-tight text-primary sm:text-[2.5rem]">
            Business
          </h1>
        </div>
        <SectionTabs
          label="Business"
          tabs={[
            { href: "/business/stores", label: "Retail stores" },
            { href: "/business/returns", label: "Returns" },
          ]}
        />
      </header>
      {children}
    </div>
  );
}
