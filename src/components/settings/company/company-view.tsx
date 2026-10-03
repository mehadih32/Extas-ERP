import type { CompanyDetails } from "@/modules/companies/company.service";

import { CompanyLogo } from "./company-logo";
import { MONTHS } from "./company-options";

function Row({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[14rem_1fr] sm:gap-6">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words whitespace-pre-line">
        {value === null || value === "" ? "—" : value}
      </dd>
    </div>
  );
}

/** The company details for people who may read but not change them (no company.settings). */
export function CompanyView({ details }: { details: CompanyDetails }) {
  return (
    <section className="grid gap-6 rounded-lg border bg-card p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <CompanyLogo logo={details.logo} />
        <div>
          <p className="font-serif text-2xl text-primary">{details.name}</p>
          {details.legalName && (
            <p className="mt-1 text-sm text-muted-foreground">{details.legalName}</p>
          )}
        </div>
      </div>
      <dl className="divide-y border-t">
        <Row label="Phone" value={details.phone} />
        <Row label="Email" value={details.email} />
        <Row label="Website" value={details.website} />
        <Row label="Address" value={details.address} />
        <Row label="Letterhead footer" value={details.letterheadFooter} />
        <Row label="Currency" value={details.currency} />
        <Row label="Time zone" value={details.timezone.replaceAll("_", " ")} />
        <Row
          label="Financial year starts in"
          value={MONTHS[details.fiscalYearStartMonth - 1] ?? null}
        />
        <Row label="Low stock alert at" value={`${details.lowStockThreshold} pieces`} />
        <Row label="Advance on orders" value={`${details.defaultAdvancePercent}%`} />
        <Row
          label="Buyer counts as dormant after"
          value={`${details.dormantAfterMonths} ${details.dormantAfterMonths === 1 ? "month" : "months"}`}
        />
      </dl>
    </section>
  );
}
