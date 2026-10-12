import { CheckCheckIcon, CheckIcon } from "lucide-react";

import { localDay, localTime } from "@/lib/dates";
import { formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";

/**
 * A task's read receipt, as on a chat: ✓✓ "Seen 12 Oct 2026 at 10:42" once
 * the employee has opened it in My HR, ✓ "Not seen yet" until then. Nothing
 * for a task nobody has, or an employee with no login (they cannot open it).
 */
export function SeenMark({
  task,
  timeZone,
  className,
}: {
  task: { assignee: { hasLogin: boolean } | null; seenAt: Date | string | null };
  timeZone: string;
  className?: string;
}) {
  if (!task.assignee) return null;
  if (task.seenAt) {
    const at = new Date(task.seenAt);
    return (
      <span className={cn("inline-flex items-center gap-1 text-verified", className)}>
        <CheckCheckIcon className="size-3.5 shrink-0" aria-hidden />
        Seen {formatDay(localDay(at, timeZone))} at {localTime(at, timeZone)}
      </span>
    );
  }
  if (!task.assignee.hasLogin) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 text-muted-foreground", className)}>
      <CheckIcon className="size-3.5 shrink-0" aria-hidden />
      Not seen yet
    </span>
  );
}
