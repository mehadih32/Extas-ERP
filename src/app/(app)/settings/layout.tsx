import { SettingsTabs } from "@/components/settings/settings-tabs";
import { visibleSettingsTabs } from "@/components/settings/tabs";
import { requireCompanyPage } from "@/server/pages/guards";

/**
 * The settings area: the team, the roles and the company details, each tab shown
 * only to people whose role opens it (components/settings/tabs.ts).
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCompanyPage();
  const tabs = visibleSettingsTabs(ctx.permissions).map(({ href, label }) => ({ href, label }));

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <header className="grid gap-6">
        <div>
          <p className="eyebrow">{ctx.company.name}</p>
          <h1 className="mt-3 font-serif text-[2rem] leading-tight text-primary sm:text-[2.5rem]">
            Settings
          </h1>
        </div>
        <SettingsTabs tabs={tabs} />
      </header>
      {children}
    </div>
  );
}
