import { requireCompanyPage } from "@/server/pages/guards";

/**
 * The Tech Pack area: every tech pack of the company, a new one from the
 * buyer's brief, and each tech pack's page. Each page checks its permission
 * again through its Server Action (production.view to see, production.manage
 * to change).
 */
export default async function TechPacksLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCompanyPage();
  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <header>
        <p className="eyebrow">{ctx.company.name}</p>
        <h1 className="mt-3 font-serif text-[2rem] leading-tight text-primary sm:text-[2.5rem]">
          Tech Pack
        </h1>
      </header>
      {children}
    </div>
  );
}
