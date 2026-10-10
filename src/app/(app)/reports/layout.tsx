import { visibleReportsTabs } from "@/components/reports/tabs";
import { SectionTabs } from "@/components/shell/section-tabs";
import { requireCompanyPage } from "@/server/pages/guards";

/**
 * The Reports & documents area: reports made with the Report Builder, the PDFs
 * printed from the app, and the company's own document templates, each tab shown
 * only to people whose role opens it (components/reports/tabs.ts). Each page
 * checks again through its Server Action.
 */
export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCompanyPage();
  const tabs = visibleReportsTabs(ctx.permissions).map(({ href, label }) => ({ href, label }));

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <header className="grid gap-6 print:hidden">
        <div>
          <p className="eyebrow">{ctx.company.name}</p>
          <h1 className="mt-3 font-serif text-[2rem] leading-tight text-primary sm:text-[2.5rem]">
            Reports &amp; documents
          </h1>
        </div>
        {tabs.length > 0 && <SectionTabs label="Reports & documents" tabs={tabs} />}
      </header>
      {children}
    </div>
  );
}
