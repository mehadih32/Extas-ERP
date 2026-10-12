import { localDay, localTime } from "@/lib/dates";
import { formatDay } from "@/lib/display";
import type { NoticeView } from "@/modules/hr/notice.service";

/** The words for the staff notice board (hr/notice.service.ts). */

/** "12 Oct 2026 at 10:42" in company time. */
export const whenText = (at: Date | string, timeZone: string) => {
  const d = new Date(at);
  return `${formatDay(localDay(d, timeZone))} at ${localTime(d, timeZone)}`;
};

/** "Posted 12 Oct 2026 at 10:42 by Nasrin Akter · Changed 13 Oct 2026 at 09:00". */
export function postedText(n: NoticeView, timeZone: string) {
  return [
    `Posted ${whenText(n.createdAt, timeZone)}${n.postedBy ? ` by ${n.postedBy}` : ""}`,
    n.editedAt ? `Changed ${whenText(n.editedAt, timeZone)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "Read by 7 of 12 staff". */
export const readText = (read: number, of: number) =>
  of === 0 ? "No staff with a login yet" : `Read by ${read} of ${of} staff`;
