import Link from "next/link";

import { Wordmark } from "@/components/brand/wordmark";
import { ROUTES } from "@/lib/routes";

import { CompanySwitcher } from "./company-switcher";
import { MainNav } from "./main-nav";
import type { ShellCompany, ShellUser } from "./types";
import { UserMenu } from "./user-menu";

/** The green top bar: the house mark, the sections, the company switcher and the person. */
export function TopBar({
  user,
  companies,
  activeCompany,
  permissions,
}: {
  user: ShellUser;
  companies: ShellCompany[];
  activeCompany: { id: string; name: string };
  permissions: string[];
}) {
  return (
    <header className="sticky top-0 z-40 bg-primary text-primary-foreground">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-5 px-4 sm:px-6 md:h-16 lg:gap-8 lg:px-8">
        <Link
          href={ROUTES.home}
          aria-label="Extras ERP, dashboard"
          className="rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-primary-foreground/30"
        >
          <Wordmark />
        </Link>
        <MainNav permissions={permissions} className="hidden md:flex" />
        <div className="ml-auto flex items-center gap-3">
          <CompanySwitcher companies={companies} activeCompany={activeCompany} />
          <UserMenu
            user={user}
            companyName={activeCompany.name}
            variant="avatar"
            className="hidden md:inline-flex"
          />
        </div>
      </div>
    </header>
  );
}
