import { visibleAiTabs } from "@/components/ai/tabs";
import { SectionTabs } from "@/components/shell/section-tabs";
import { requireCompanyPage } from "@/server/pages/guards";

/**
 * The AI Center: the switch and what waits for an answer (AI Home), what the
 * AI may do (Control), its models, its logs and its settings, each tab shown
 * only to people whose role opens it (components/ai/tabs.ts). Each page checks
 * again through its Server Action.
 */
export default async function AiLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCompanyPage();
  const tabs = visibleAiTabs(ctx.permissions).map(({ href, label }) => ({ href, label }));

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <header className="grid gap-6">
        <div>
          <p className="eyebrow">{ctx.company.name}</p>
          <h1 className="mt-3 font-serif text-[2rem] leading-tight text-primary sm:text-[2.5rem]">
            AI Center
          </h1>
        </div>
        {tabs.length > 0 && <SectionTabs label="AI Center" tabs={tabs} />}
      </header>
      {children}
    </div>
  );
}
