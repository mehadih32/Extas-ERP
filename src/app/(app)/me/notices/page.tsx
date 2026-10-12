import type { Metadata } from "next";

import { MyHrProblem } from "@/components/hr/no-access";
import { MyNoticeBoard } from "@/components/hr/notice-board";
import { EmptyState } from "@/components/products/bits";
import { getMyNoticesAction } from "@/server/actions/portal.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Notices" };

/**
 * The staff notice board (portal.self): the notices HR has up now, pinned
 * first, the ones new to this person marked "New". Opening the board counts
 * as reading them; HR sees who has read each one.
 */
export default async function MyNoticesPage() {
  const ctx = await requireCompanyPage();
  const result = await getMyNoticesAction();
  if (!result.ok) {
    return (
      <MyHrProblem error={result.error} title="Notices" heading="The notices could not load" />
    );
  }
  const { items, unread } = result.data;

  return (
    <section aria-labelledby="my-notices-heading" className="grid gap-6">
      <div>
        <h2 id="my-notices-heading" className="font-serif text-2xl text-primary">
          Notices
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {items.length === 0
            ? "Notices from HR for everyone show here."
            : `Notices from HR for everyone${unread > 0 ? `: ${unread} new to you` : ""}. HR sees when you have read them.`}
        </p>
      </div>
      {items.length === 0 ? (
        <EmptyState title="No notices right now">
          When HR posts a notice, you see it here and hear about it in the app.
        </EmptyState>
      ) : (
        <MyNoticeBoard items={items} timeZone={ctx.company.timezone} />
      )}
    </section>
  );
}
