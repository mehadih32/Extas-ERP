import { requireCompanyPage } from "@/server/pages/guards";

/**
 * Compliance: the company's licences and registrations (trade licence, VAT /
 * BIN, TIN, IRC / ERC...), their scans and renewals. Each page checks
 * compliance.view or compliance.manage through its Server Action.
 */
export default async function ComplianceLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCompanyPage();

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <header className="print:hidden">
        <p className="eyebrow">{ctx.company.name}</p>
        <h1 className="mt-3 font-serif text-[2rem] leading-tight text-primary sm:text-[2.5rem]">
          Compliance
        </h1>
      </header>
      {children}
    </div>
  );
}
