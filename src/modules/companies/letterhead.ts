import type { CompanyContext } from "@/modules/auth/context";
import { complianceNumbers } from "@/modules/compliance/compliance.service";

/**
 * The registration numbers every document prints under the company's details:
 * the VAT registration (BIN) and the trade licence number, from the licence
 * records in force (a renewal that changes the number changes what prints).
 * Null when the company has not recorded one.
 */
export async function registrationNumbers(companyId: string) {
  const { bin, tradeLicense } = await complianceNumbers(companyId);
  return { bin, tradeLicense };
}

/** Company details printed in the header / footer of every document. */
export async function letterhead(ctx: CompanyContext) {
  const { company } = ctx;
  return {
    name: company.name,
    legalName: company.legalName,
    logoUrl: company.logoUrl,
    address: company.address,
    phone: company.phone,
    email: company.email,
    website: company.website,
    footer: company.letterheadFooter,
    primaryColor: company.primaryColor,
    accentColor: company.accentColor,
    currency: company.currency,
    ...(await registrationNumbers(company.id)),
  };
}
