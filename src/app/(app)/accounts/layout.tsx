import { visibleAccountsTabs } from "@/components/accounts/tabs";
import { SectionTabs } from "@/components/shell/section-tabs";
import { requireCompanyPage } from "@/server/pages/guards";

/**
 * The Accounts area: the overview, cash and bank, supplier payments, expenses,
 * the journal, the chart of accounts and the reports, each tab shown only to
 * people whose role opens it (components/accounts/tabs.ts). People who only
 * record their own expenses see that one screen, titled Expenses. Each page
 * checks again through its Server Action.
 */
export default async function AccountsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCompanyPage();
  const tabs = visibleAccountsTabs(ctx.permissions).map(({ href, label }) => ({ href, label }));
  const onlyExpenses = tabs.length === 1 && tabs[0]!.href === "/accounts/expenses";

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <header className="grid gap-6">
        <div>
          <p className="eyebrow">{ctx.company.name}</p>
          <h1 className="mt-3 font-serif text-[2rem] leading-tight text-primary sm:text-[2.5rem]">
            {onlyExpenses ? "Expenses" : "Accounts"}
          </h1>
        </div>
        {tabs.length > 1 && <SectionTabs label="Accounts" tabs={tabs} />}
      </header>
      {children}
    </div>
  );
}
