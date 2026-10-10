import { visiblePlannerTabs } from "@/components/planner/tabs";
import { SectionTabs } from "@/components/shell/section-tabs";
import { requireCompanyPage } from "@/server/pages/guards";

/**
 * The Planner: what is coming up, the notepad, tasks for staff, reminders and
 * the automatic reminder settings, each tab shown only to people whose role
 * opens it (components/planner/tabs.ts). Each page checks again through its
 * Server Action.
 */
export default async function PlannerLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCompanyPage();
  const tabs = visiblePlannerTabs(ctx.permissions).map(({ href, label }) => ({ href, label }));

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <header className="grid gap-6 print:hidden">
        <div>
          <p className="eyebrow">{ctx.company.name}</p>
          <h1 className="mt-3 font-serif text-[2rem] leading-tight text-primary sm:text-[2.5rem]">
            Planner
          </h1>
        </div>
        {tabs.length > 0 && <SectionTabs label="Planner" tabs={tabs} />}
      </header>
      {children}
    </div>
  );
}
