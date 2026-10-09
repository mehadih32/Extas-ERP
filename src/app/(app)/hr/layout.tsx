import { visibleHrTabs } from "@/components/hr/tabs";
import { SectionTabs } from "@/components/shell/section-tabs";
import { requireCompanyPage } from "@/server/pages/guards";

/**
 * The HR & payroll area: the overview, employees, attendance, leave, payroll,
 * salary advances, and holidays and rules, each tab shown only to people whose
 * role opens it (components/hr/tabs.ts). Each page checks again through its
 * Server Action.
 */
export default async function HrLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCompanyPage();
  const tabs = visibleHrTabs(ctx.permissions).map(({ href, label }) => ({ href, label }));

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <header className="grid gap-6 print:hidden">
        <div>
          <p className="eyebrow">{ctx.company.name}</p>
          <h1 className="mt-3 font-serif text-[2rem] leading-tight text-primary sm:text-[2.5rem]">
            HR &amp; payroll
          </h1>
        </div>
        {tabs.length > 0 && <SectionTabs label="HR & payroll" tabs={tabs} />}
      </header>
      {children}
    </div>
  );
}
