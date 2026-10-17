import { AiNav } from "@/components/ai/ai-nav";
import { visibleAiTabs } from "@/components/ai/tabs";
import { AiTimeZone } from "@/components/ai/when";
import { requireCompanyPage } from "@/server/pages/guards";

/**
 * The AI Center: the switch and what waits for an answer (AI Home), what the
 * AI may do (Control), its models, its logs and its settings, in four groups
 * (Mehedi & Agents, Work, Money, System), each page shown only to people whose
 * role opens it (components/ai/tabs.ts). Each page checks again through its
 * Server Action. Times on these screens are in the company's time zone
 * (components/ai/when.tsx).
 */
export default async function AiLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCompanyPage();
  const tabs = visibleAiTabs(ctx.permissions, ctx.user.isSuperAdmin).map(
    ({ href, label, group }) => ({ href, label, group }),
  );

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <header className="grid gap-6">
        <div>
          <p className="eyebrow">{ctx.company.name}</p>
          <h1 className="mt-3 font-serif text-[2rem] leading-tight text-primary sm:text-[2.5rem]">
            AI Center
          </h1>
        </div>
        {tabs.length > 0 && <AiNav tabs={tabs} />}
      </header>
      <AiTimeZone timeZone={ctx.company.timezone}>{children}</AiTimeZone>
    </div>
  );
}
