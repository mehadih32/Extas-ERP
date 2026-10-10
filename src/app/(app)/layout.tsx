import { BottomNav } from "@/components/shell/bottom-nav";
import { initialsOf, roleLabel } from "@/components/shell/labels";
import { visibleNavItems } from "@/components/shell/nav-items";
import { TopBar } from "@/components/shell/top-bar";
import type { ShellUser } from "@/components/shell/types";
import { getCurrentSession } from "@/modules/auth/context";
import { ROUTES } from "@/lib/routes";
import { getMe } from "@/modules/auth/me.service";
import { unreadNotificationsAction } from "@/server/actions/reminders.actions";

/**
 * The app frame: top bar with the company switcher, and the bottom navigation on
 * phones. Each screen checks the session and permissions itself (see
 * server/pages/guards.ts); without a usable session and company the frame stays
 * out of the way while the screen sends the person to sign in or choose.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const current = await getCurrentSession();
  const me = current && !current.user.mustChangePassword ? await getMe(current) : null;
  if (!me?.activeCompany) return children;

  const user: ShellUser = {
    name: me.user.name,
    email: me.user.email,
    initials: initialsOf(me.user.name, me.user.email),
    roleName: roleLabel(me.role, me.user.isSuperAdmin),
    myHr:
      me.permissions.includes("portal.self") &&
      !visibleNavItems(me.permissions).some((item) => item.href === ROUTES.myHr),
  };
  // The bell's count; it refreshes whenever something changes (every change revalidates the layout).
  const inbox = await unreadNotificationsAction();
  const unread = inbox.ok ? inbox.data.unread : 0;
  const companies = me.companies.map((c) => ({ id: c.id, name: c.name, roleName: c.roleName }));
  const activeCompany = { id: me.activeCompany.id, name: me.activeCompany.name };

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-card px-4 py-2 text-sm focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <TopBar
        user={user}
        companies={companies}
        activeCompany={activeCompany}
        permissions={me.permissions}
        unread={unread}
      />
      <main
        id="main"
        className="mx-auto w-full max-w-7xl flex-1 px-4 pt-7 pb-28 sm:px-6 md:pt-10 md:pb-16 lg:px-8 print:max-w-none print:p-0"
      >
        {children}
      </main>
      <BottomNav permissions={me.permissions} user={user} companyName={activeCompany.name} />
    </div>
  );
}
