import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { InboxList } from "@/components/planner/inbox";
import { PLANNER_PAGE_SIZE } from "@/components/planner/list-view";
import { ViewLinks } from "@/components/planner/view-links";
import { localDay } from "@/lib/dates";
import { getInboxScreenAction } from "@/server/actions/reminders.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Inbox" };

/**
 * The person's in-app messages in this company, newest first: reminders that
 * went out, tasks given or finished. Everyone has one. WhatsApp and email
 * copies come later.
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const unreadOnly = (await searchParams).unread === "1";
  const result = await getInboxScreenAction({
    ...(unreadOnly ? { unread: true } : {}),
    take: PLANNER_PAGE_SIZE,
  });
  if (!result.ok) {
    return <SectionError title="Inbox" heading="Your inbox could not load" error={result.error} />;
  }
  const { items, nextCursor, unread } = result.data;
  const today = localDay(new Date(), ctx.company.timezone);

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <header>
        <p className="eyebrow">{ctx.company.name}</p>
        <h1 className="mt-3 font-serif text-[2rem] leading-tight text-primary sm:text-[2.5rem]">
          Inbox
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {unread === 0
            ? "Everything is read. Reminders and tasks for you arrive here."
            : `${unread} unread ${unread === 1 ? "message" : "messages"}. Reminders and tasks for you arrive here.`}
        </p>
      </header>

      <section aria-label="Messages" className="grid max-w-3xl gap-6">
        <ViewLinks
          label="Which messages"
          links={[
            { href: "/inbox", label: "All", current: !unreadOnly },
            { href: "/inbox?unread=1", label: `Unread (${unread})`, current: unreadOnly },
          ]}
        />
        {items.length === 0 ? (
          <p className="rounded-lg border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
            {unreadOnly ? "No unread messages." : "No messages yet."}
          </p>
        ) : (
          <InboxList
            key={unreadOnly ? "unread" : "all"}
            initial={{ items, nextCursor }}
            unreadOnly={unreadOnly}
            unread={unread}
            today={today}
          />
        )}
      </section>
    </div>
  );
}
