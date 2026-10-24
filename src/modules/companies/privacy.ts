import { prisma } from "@/lib/prisma";

/** Who the privacy policy names: the server's first active company, as its record says. */
export type PrivacyContact = {
  name: string;
  email: string | null;
  website: string | null;
};

/*
 * The public privacy policy (/privacy) is read before anyone signs in, and Google
 * shows its link on the Google Drive sign-in screen. One ERP server is one
 * installation, so it names the company that was set up first (and is still
 * active), from the Company record: its name, its email and its website, which the
 * company prints on its documents anyway. Nothing else about the company is shown.
 */
export async function privacyContact(): Promise<PrivacyContact> {
  const company = await prisma.company.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { name: true, legalName: true, email: true, website: true },
  });
  if (!company) return { name: "Extas ERP", email: null, website: null };
  return {
    name: company.legalName?.trim() || company.name,
    email: company.email?.trim() || null,
    website: company.website?.trim() || null,
  };
}
