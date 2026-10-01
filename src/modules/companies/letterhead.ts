import type { Company } from "@prisma/client";

/** Company details printed in the header / footer of every document. */
export function letterhead(company: Company) {
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
  };
}
