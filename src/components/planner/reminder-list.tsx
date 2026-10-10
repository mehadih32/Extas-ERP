"use client";

import { RepeatIcon } from "lucide-react";

import { RowCard, RowLink, ShowMore, useLoadMore } from "@/components/sales/load-more";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ReminderRow } from "@/modules/reminders/screens.service";
import { listReminderRowsAction } from "@/server/actions/reminders.actions";

import { KindBadge, ReminderBadge } from "./badges";
import { plannerHref, REMINDER_TYPE_LABELS, whenText } from "./labels";
import { reminderListQuery, type ReminderListView } from "./list-view";

/** "You", "You and Sabbir Ahmed", "Rahim, Sabbir and 3 more". */
export function recipientsText(recipients: ReminderRow["recipients"], meId: string): string {
  const names = recipients.map((r) =>
    r.kind === "user" && r.id === meId ? "You" : (r.name ?? "Someone who has left"),
  );
  if (names.length === 0) return "Nobody";
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

const kindOf = (r: ReminderRow) =>
  r.automatic ? `Automatic · ${REMINDER_TYPE_LABELS[r.type]}` : REMINDER_TYPE_LABELS[r.type];

/**
 * Reminders, latest first: cards on phones, a table on computers, each opening
 * the reminder, with "Show more" for the next page.
 */
export function ReminderList({
  initial,
  view,
  meId,
}: {
  initial: { items: ReminderRow[]; nextCursor?: string };
  view: ReminderListView;
  meId: string;
}) {
  const list = useLoadMore(initial, (cursor) =>
    listReminderRowsAction(reminderListQuery(view, cursor)),
  );

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Reminders">
        {list.items.map((r) => (
          <RowCard
            key={r.id}
            href={plannerHref.reminder(r.id)}
            eyebrow={kindOf(r)}
            badges={<ReminderBadge status={r.status} awaits={r.awaits} />}
            title={r.title}
            details={`To ${recipientsText(r.recipients, meId)}`}
            footer={
              <>
                <span className="text-muted-foreground">{whenText(r.day, r.time)}</span>
                {r.repeat && (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <RepeatIcon aria-hidden className="size-3.5" />
                    {r.repeat.description}
                  </span>
                )}
              </>
            }
          />
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Reminders">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Reminder</TableHead>
              <TableHead>To</TableHead>
              <TableHead>When</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="max-w-96 py-3">
                  <RowLink href={plannerHref.reminder(r.id)} className="whitespace-normal">
                    {r.title}
                  </RowLink>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                    {r.automatic ? (
                      <KindBadge>Automatic</KindBadge>
                    ) : (
                      r.type !== "CUSTOM" && <span>{REMINDER_TYPE_LABELS[r.type]}</span>
                    )}
                    {r.automatic && <span>{REMINDER_TYPE_LABELS[r.type]}</span>}
                  </div>
                </TableCell>
                <TableCell className="max-w-64 whitespace-normal text-muted-foreground">
                  {recipientsText(r.recipients, meId)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {whenText(r.day, r.time)}
                  {r.repeat && (
                    <span className="mt-0.5 flex items-center gap-1 text-[0.8125rem]">
                      <RepeatIcon aria-hidden className="size-3.5" />
                      {r.repeat.description}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <ReminderBadge status={r.status} awaits={r.awaits} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ShowMore list={list} noun="reminders" />
    </div>
  );
}
