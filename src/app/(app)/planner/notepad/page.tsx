import { SearchIcon, XIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { dayHeading, dayWords, NOTE_TAB_LABELS, plannerHref } from "@/components/planner/labels";
import { NotepadNoAccess } from "@/components/planner/no-access";
import { NoteRows, QuickAdd, WriteNoteButton } from "@/components/planner/notepad";
import { ViewLinks } from "@/components/planner/view-links";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NOTE_TABS } from "@/modules/reminders/screens.service";
import { getNotepadScreenAction } from "@/server/actions/notepad.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Notepad" };

const box = "rounded-lg border bg-card p-3 sm:p-4";

/**
 * The person's own notepad (notepad.use), in three tabs: a daily routine that
 * starts fresh each morning, the work plan for today and the next two days
 * (unfinished items carried over), and general notes, pinned ones first. Only
 * they see it.
 */
export default async function NotepadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompanyPage();
  const { tab, q } = await searchParams;
  const result = await getNotepadScreenAction({ tab, search: q });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <NotepadNoAccess />;
    return (
      <SectionError title="Notepad" heading="Your notepad could not load" error={result.error} />
    );
  }
  const screen = result.data;
  const { today } = screen;

  return (
    <section aria-labelledby="notepad-heading" className="grid gap-6">
      <div>
        <h2 id="notepad-heading" className="font-serif text-2xl text-primary">
          Notepad
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Your own routine, work plan and notes. Only you see them.
        </p>
      </div>

      <ViewLinks
        label="Notepad pages"
        fill
        links={NOTE_TABS.map((t) => ({
          href: plannerHref.notepad(t),
          label: NOTE_TAB_LABELS[t],
          current: t === screen.tab,
        }))}
      />

      {screen.tab === "DAILY_ROUTINE" && (
        <div className="grid max-w-3xl gap-4">
          <p className="text-sm text-muted-foreground">
            {screen.items.length === 0
              ? "Things you do every day. Ticks clear each morning."
              : `${screen.done} of ${screen.items.length} done today. Ticks clear each morning.`}
          </p>
          {screen.items.length > 0 && (
            <div className={box}>
              <NoteRows
                notes={screen.items}
                tab="DAILY_ROUTINE"
                today={today}
                label="Daily routine"
              />
            </div>
          )}
          <QuickAdd tab="DAILY_ROUTINE" today={today} placeholder="Add to the daily routine" />
        </div>
      )}

      {screen.tab === "NEXT_3_DAYS" && (
        <div className="grid max-w-3xl gap-4">
          <QuickAdd tab="NEXT_3_DAYS" today={today} placeholder="Add to the work plan" />
          {screen.overdue.length > 0 && (
            <section aria-labelledby="plan-overdue" className={`${box} border-destructive/30`}>
              <h3 id="plan-overdue" className="px-2 text-sm font-medium text-destructive">
                Carried over ({screen.overdue.length})
              </h3>
              <p className="mt-1 px-2 text-[0.8125rem] text-muted-foreground">
                Not done on their day:{" "}
                {[...new Set(screen.overdue.map((n) => n.planDate!))]
                  .map((d) => dayWords(d, today))
                  .join(", ")}
                .
              </p>
              <NoteRows
                notes={screen.overdue}
                tab="NEXT_3_DAYS"
                today={today}
                label="Carried over"
                movable={false}
              />
            </section>
          )}
          {screen.days.map((d) => (
            <section key={d.date} aria-labelledby={`plan-${d.date}`} className={box}>
              <h3 id={`plan-${d.date}`} className="px-2 text-sm font-medium text-primary">
                {dayHeading(d.date, today)}
              </h3>
              {d.items.length === 0 ? (
                <p className="px-2 pt-2 pb-1 text-sm text-muted-foreground">Nothing planned.</p>
              ) : (
                <NoteRows
                  notes={d.items}
                  tab="NEXT_3_DAYS"
                  today={today}
                  label={dayHeading(d.date, today)}
                />
              )}
            </section>
          ))}
        </div>
      )}

      {screen.tab === "GENERAL" && (
        <div className="grid max-w-3xl gap-4">
          <div className="grid gap-3 sm:flex sm:items-center sm:justify-between">
            <form role="search" action="/planner/notepad" className="relative w-full sm:max-w-xs">
              <input type="hidden" name="tab" value="GENERAL" />
              <SearchIcon
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                name="q"
                defaultValue={screen.search}
                enterKeyHint="search"
                autoComplete="off"
                placeholder="Search your notes"
                aria-label="Search your notes"
                className="pl-9"
              />
            </form>
            <WriteNoteButton today={today} />
          </div>
          {screen.search && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>
                {screen.items.length} {screen.items.length === 1 ? "note" : "notes"} with &ldquo;
                {screen.search}&rdquo;
              </span>
              <Button asChild variant="ghost" size="sm">
                <Link href={plannerHref.notepad("GENERAL")}>
                  <XIcon aria-hidden />
                  Clear the search
                </Link>
              </Button>
            </div>
          )}
          {screen.items.length === 0 ? (
            <p className="rounded-lg border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
              {screen.search
                ? "No notes have these words."
                : "No notes yet. Write down anything you want to keep: numbers, ideas, what a buyer said."}
            </p>
          ) : (
            <div className={box}>
              <NoteRows
                notes={screen.items}
                tab="GENERAL"
                today={today}
                label="General notes"
                movable={!screen.search}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
