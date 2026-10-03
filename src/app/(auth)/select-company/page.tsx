import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { ROUTES } from "@/lib/routes";
import { getMe } from "@/modules/auth/me.service";
import { requireSessionPage } from "@/server/pages/guards";

import { CompanyChoices } from "./company-choices";

export const metadata: Metadata = { title: "Choose a company" };

export default async function SelectCompanyPage() {
  const current = await requireSessionPage();
  if (current.user.mustChangePassword) redirect(ROUTES.changePassword);
  const me = await getMe(current);

  return (
    <>
      <p className="eyebrow">{me.user.name}</p>
      <h1 className="mt-3 font-serif text-4xl text-primary">
        {me.companies.length > 0 ? "Choose a company" : "No company yet"}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {me.companies.length > 0
          ? "Pick the company to work in. You can switch at any time from the top of the screen."
          : "Your account is not part of an active company yet. Ask your administrator to add you, then sign in again."}
      </p>
      {me.companies.length > 0 && (
        <CompanyChoices
          companies={me.companies.map((c) => ({ id: c.id, name: c.name, roleName: c.roleName }))}
          activeCompanyId={me.activeCompany?.id ?? null}
        />
      )}
      <div className="mt-8 border-t pt-6">
        <SignOutButton variant="outline" className="w-full">
          Sign out
        </SignOutButton>
      </div>
    </>
  );
}
