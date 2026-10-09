import { MY_HR_TABS } from "@/components/hr/tabs";
import { SectionTabs } from "@/components/shell/section-tabs";
import { requireCompanyPage } from "@/server/pages/guards";

/**
 * My HR: the signed-in employee's own attendance, leave, payslips and
 * advances (portal.self). Each page reads only the employee linked to the
 * login, through its Server Action.
 */
export default async function MyHrLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCompanyPage();
  const tabs = ctx.permissions.has("portal.self") ? [...MY_HR_TABS] : [];

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <header className="grid gap-6 print:hidden">
        <div>
          <p className="eyebrow">{ctx.company.name}</p>
          <h1 className="mt-3 font-serif text-[2rem] leading-tight text-primary sm:text-[2.5rem]">
            My HR
          </h1>
        </div>
        {tabs.length > 0 && <SectionTabs label="My HR" tabs={tabs} />}
      </header>
      {children}
    </div>
  );
}
