import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { FlagBadge } from "@/components/hr/badges";
import { hrHref } from "@/components/hr/labels";
import { HrNoAccess } from "@/components/hr/no-access";
import { NoticeActions, PostNoticeButton } from "@/components/hr/notice-actions";
import { NoticeText } from "@/components/hr/notice-board";
import { readText, whenText } from "@/components/hr/notice-labels";
import { ViewLinks } from "@/components/planner/view-links";
import { EmptyState } from "@/components/products/bits";
import { localDay } from "@/lib/dates";
import { formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { NoticeList } from "@/modules/hr/notice.service";
import { NOTICE_SHOWS } from "@/modules/hr/schemas";
import { getNoticesScreenAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Notices" };

const smallText = "text-[0.8125rem] text-muted-foreground";

const SHOW_LABELS: Record<(typeof NOTICE_SHOWS)[number], string> = {
  current: "Up now",
  ended: "Ended or taken down",
  all: "All",
};

/** "Ended 10 Oct 2026", "Taken down by Nasrin Akter on 12 Oct 2026 at 10:42". */
function StateBadges({
  notice: n,
  timeZone,
}: {
  notice: NoticeList["items"][number];
  timeZone: string;
}) {
  if (n.state === "TAKEN_DOWN") {
    return (
      <FlagBadge tone="closed">
        Taken down {formatDay(localDay(new Date(n.takenDownAt!), timeZone))}
      </FlagBadge>
    );
  }
  if (n.state === "ENDED")
    return <FlagBadge tone="closed">Ended {formatDay(n.showUntil!)}</FlagBadge>;
  return null;
}

/**
 * The staff notice board (hr.manage): post a notice for every employee, keep
 * it at the top or give it a last day, change it or take it down, and see who
 * has read each one and who has not yet. Staff read the board in My HR >
 * Notices and hear about a new notice in the app.
 */
export default async function NoticesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const { show } = await searchParams;
  const result = await getNoticesScreenAction({ show });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <HrNoAccess />;
    return (
      <SectionError title="Notices" heading="The notices could not load" error={result.error} />
    );
  }
  const list = result.data;
  const tz = ctx.company.timezone;
  const today = localDay(new Date(), tz);
  const { reached, noLogin } = list.audience;

  return (
    <section aria-labelledby="notices-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="notices-heading" className="font-serif text-2xl text-primary">
            Notices
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {list.counts.up === 0
              ? "No notices up. Post one for every employee: they see it in My HR and hear about it in the app."
              : `${list.counts.up} ${list.counts.up === 1 ? "notice is" : "notices are"} up.`}{" "}
            {`${reached} ${reached === 1 ? "employee has" : "employees have"} a login to read them${
              noLogin > 0
                ? `; ${noLogin} ${noLogin === 1 ? "has" : "have"} none, so tell them another way.`
                : "."
            }`}
          </p>
        </div>
        <PostNoticeButton today={today} className="grid sm:justify-items-end" />
      </div>

      <ViewLinks
        label="Which notices"
        links={NOTICE_SHOWS.map((s) => ({
          href: hrHref.notices(s === "current" ? undefined : s),
          label:
            s === "current"
              ? `${SHOW_LABELS[s]} (${list.counts.up})`
              : s === "ended"
                ? `${SHOW_LABELS[s]} (${list.counts.ended})`
                : SHOW_LABELS[s],
          current: s === list.show,
        }))}
      />

      {list.items.length === 0 ? (
        <EmptyState title={list.show === "current" ? "No notices up" : "No notices"}>
          {list.show === "current"
            ? "Post a notice: an office closure, a new rule or the Eid bonus dates."
            : "Notices that ended or were taken down are kept here with who read them."}
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-4" aria-label="Notices">
          {list.items.map((n) => {
            const read = n.readBy.length;
            const of = read + n.notYet.length;
            const percent = of === 0 ? 0 : Math.round((read / of) * 100);
            return (
              <li
                key={n.id}
                id={`notice-${n.id}`}
                className={cn(
                  "grid scroll-mt-24 gap-4 rounded-lg border bg-card p-5",
                  n.state !== "UP" && "bg-muted/30",
                )}
              >
                <NoticeText
                  notice={n}
                  timeZone={tz}
                  badges={<StateBadges notice={n} timeZone={tz} />}
                />
                {n.state === "TAKEN_DOWN" && n.takenDownBy && (
                  <p className={smallText}>
                    Taken down by {n.takenDownBy} on {whenText(n.takenDownAt!, tz)}.
                  </p>
                )}
                <div className="grid gap-2 border-t pt-3">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium">{readText(read, of)}</span>
                    {of > 0 && <span className="tabular-nums">{percent}%</span>}
                  </div>
                  {of > 0 && (
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div
                        className="h-full rounded-full bg-success"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  )}
                  {of > 0 && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-primary">Who has read it</summary>
                      <div className="mt-2 grid gap-3 sm:grid-cols-2">
                        <div>
                          <p className="font-medium">Read ({read})</p>
                          {read === 0 ? (
                            <p className={smallText}>Nobody yet.</p>
                          ) : (
                            <ul className="mt-1 grid gap-1" aria-label="Read by">
                              {n.readBy.map((r) => (
                                <li key={r.employeeId} className="flex flex-wrap gap-x-2">
                                  <span>{r.name}</span>
                                  <span className={smallText}>{whenText(r.readAt, tz)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div>
                          <p className="font-medium">Not read yet ({n.notYet.length})</p>
                          {n.notYet.length === 0 ? (
                            <p className={smallText}>Everyone has read it.</p>
                          ) : (
                            <ul className="mt-1 grid gap-1" aria-label="Not read yet">
                              {n.notYet.map((p) => (
                                <li key={p.employeeId}>{p.name}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </details>
                  )}
                </div>
                <NoticeActions notice={n} today={today} />
              </li>
            );
          })}
        </ul>
      )}
      {list.more && <p className={smallText}>Showing the 50 newest notices.</p>}
    </section>
  );
}
