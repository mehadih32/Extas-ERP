"use client";

import {
  ClipboardPlusIcon,
  EllipsisVerticalIcon,
  FileDownIcon,
  LayoutGridIcon,
  ListIcon,
  PowerOffIcon,
  UserRoundIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { toast } from "@/components/feedback/toaster";
import { plannerHref } from "@/components/planner/labels";
import type { EmployeeChoice } from "@/components/planner/pickers";
import { TaskDialog } from "@/components/planner/task-form";
import { ShowMore, useLoadMore } from "@/components/sales/load-more";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { EmployeeListRow } from "@/modules/hr/screens.service";
import { listEmployeeRowsAction } from "@/server/actions/hr.actions";

import { EmployeeBadge, FlagBadge } from "./badges";
import { ContactLinks } from "./contact-links";
import { EmployeeAvatar } from "./employee-avatar";
import { hrHref } from "./labels";
import { employeeListQuery, type EmployeeListView } from "./list-view";
import { downloadReport } from "./report-actions";

export type DirectoryCan = { assignTask: boolean; deactivate: boolean };

type Layout = "grid" | "list";

// The chosen view (grid or list) stays on this device. Storage may be off (a
// private window); the choice then lasts until the page is left.
const LAYOUT_KEY = "extas.hr.employees.layout";
let chosenLayout: Layout | null = null;
const layoutListeners = new Set<() => void>();

function storedLayout(): Layout {
  if (chosenLayout) return chosenLayout;
  try {
    return window.localStorage.getItem(LAYOUT_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function chooseLayout(layout: Layout) {
  chosenLayout = layout;
  try {
    window.localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    // Kept in memory only.
  }
  for (const listener of layoutListeners) listener();
}

const subscribeLayout = (listener: () => void) => {
  layoutListeners.add(listener);
  return () => void layoutListeners.delete(listener);
};

function useLayout(): Layout {
  return useSyncExternalStore(subscribeLayout, storedLayout, () => "grid");
}

const post = (e: EmployeeListRow) =>
  [e.designation, e.department].filter(Boolean).join(" · ") || "No post set";

/** "2 yrs 3 mos", "Joins 1 Nov 2026"; for people who left, their time here. */
const service = (e: EmployeeListRow) =>
  e.tenure ? (e.isCurrent ? e.tenure : `Was here ${e.tenure}`) : `Joins ${formatDay(e.joinDate)}`;

/** Active, on leave (today's approved leave or long leave), leaving, left, joining, missing info. */
function StatusBadges({ e, today }: { e: EmployeeListRow; today: string }) {
  return (
    <>
      {!e.isCurrent ? (
        <FlagBadge tone="closed">Left {formatDay(e.exitDate!)}</FlagBadge>
      ) : e.onLeaveToday ? (
        <FlagBadge tone="warn">
          {e.onLeaveToday.halfDay ? "On leave (half day)" : "On leave"}
        </FlagBadge>
      ) : e.joinDate > today ? (
        <FlagBadge>Joins {formatDay(e.joinDate)}</FlagBadge>
      ) : (
        <EmployeeBadge status={e.status} />
      )}
      {e.isCurrent && e.exitDate && (
        <FlagBadge tone="warn">Leaving {formatDay(e.exitDate)}</FlagBadge>
      )}
      {e.vaultGaps.length > 0 && <FlagBadge tone="warn">Missing info</FlagBadge>}
    </>
  );
}

/** The ⋮ menu: the 360° profile, their 360° report, a task for them, deactivating them (HR). */
function RowMenu({
  e,
  can,
  onAssign,
  className,
}: {
  e: EmployeeListRow;
  can: DirectoryCan;
  onAssign: (e: EmployeeListRow) => void;
  className?: string;
}) {
  const assign = can.assignTask && e.isCurrent;
  const deactivate = can.deactivate && e.isCurrent && !e.isMe;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`More for ${e.name}`}
          className={cn(
            "relative z-10 size-10 shrink-0 text-muted-foreground md:size-9",
            className,
          )}
        >
          <EllipsisVerticalIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem asChild>
          <Link href={hrHref.employee(e.id)}>
            <UserRoundIcon aria-hidden />
            View 360° profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void downloadReport(e.id, e.name)}>
          <FileDownIcon aria-hidden />
          Download report
        </DropdownMenuItem>
        {assign && (
          <DropdownMenuItem onSelect={() => onAssign(e)}>
            <ClipboardPlusIcon aria-hidden />
            Assign task
          </DropdownMenuItem>
        )}
        {deactivate && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild variant="destructive">
              <Link href={hrHref.deactivate(e.id)}>
                <PowerOffIcon aria-hidden />
                Deactivate
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The name opening the profile; in a card it covers the whole card. */
function NameLink({ e, stretched = false }: { e: EmployeeListRow; stretched?: boolean }) {
  return (
    <Link
      href={hrHref.employee(e.id)}
      className={cn(
        "rounded-sm font-medium break-words text-primary outline-none hover:underline hover:underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/25",
        stretched &&
          "font-serif text-lg leading-snug font-normal after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:ring-0 focus-visible:after:ring-[3px] focus-visible:after:ring-ring/25",
      )}
    >
      {e.name}
    </Link>
  );
}

/** Grid or list, remembered on this device. */
function LayoutSwitch({ layout }: { layout: Layout }) {
  const options = [
    { value: "grid", label: "Grid", icon: LayoutGridIcon },
    { value: "list", label: "List", icon: ListIcon },
  ] as const;
  return (
    <div
      role="group"
      aria-label="Show employees as"
      className="inline-flex rounded-md border p-0.5"
    >
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={layout === value}
          onClick={() => chooseLayout(value)}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-[5px] px-3 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 md:h-8",
            layout === value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-primary",
          )}
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * The employee directory: profile cards (grid) or a list (a table on
 * computers, rows on phones), each person with their photo, Employee ID, post,
 * time here, status, a WhatsApp and a call button by their name, and a ⋮ menu
 * (the 360° profile, a task for them, deactivating them). "Show more" brings
 * the next page; salaries show only to people who see salaries.
 */
export function EmployeeList({
  initial,
  view,
  currency,
  seeSalaries,
  can,
  today,
  timeZone,
}: {
  initial: { items: EmployeeListRow[]; nextCursor?: string };
  view: EmployeeListView;
  currency: string;
  seeSalaries: boolean;
  can: DirectoryCan;
  today: string;
  timeZone: string;
}) {
  const router = useRouter();
  const layout = useLayout();
  const [assigning, setAssigning] = useState<EmployeeChoice | null>(null);
  const list = useLoadMore(initial, (cursor) =>
    listEmployeeRowsAction(employeeListQuery(view, cursor)),
  );
  const assign = (e: EmployeeListRow) =>
    setAssigning({ id: e.id, code: e.code, name: e.name, hasLogin: e.hasLogin });
  const salary = (e: EmployeeListRow) =>
    seeSalaries && e.salary ? `${money(e.salary, currency)} a month` : null;

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {list.items.length} {list.items.length === 1 ? "person" : "people"}
          {list.hasMore ? " shown" : ""}
        </p>
        <LayoutSwitch layout={layout} />
      </div>

      {layout === "grid" ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Employees">
          {list.items.map((e) => (
            <li
              key={e.id}
              className="relative flex min-w-0 flex-col rounded-lg border bg-card p-4 transition-colors hover:border-primary/40"
            >
              <div className="flex items-start gap-3">
                <EmployeeAvatar employeeId={e.id} photoId={e.photoId} name={e.name} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="eyebrow truncate">{e.code}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <NameLink e={e} stretched />
                    <ContactLinks name={e.name} phone={e.phone} whatsapp={e.whatsapp} size="sm" />
                  </div>
                  <p className="mt-1 text-sm break-words text-muted-foreground">{post(e)}</p>
                </div>
                <RowMenu e={e} can={can} onAssign={assign} className="-mt-1 -mr-2" />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <StatusBadges e={e} today={today} />
              </div>
              <div className="flex-1" aria-hidden />
              <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t pt-3 text-sm tabular-nums">
                <span className="text-muted-foreground">{service(e)}</span>
                {salary(e) && <span className="font-medium">{salary(e)}</span>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <ul className="grid divide-y rounded-lg border bg-card lg:hidden" aria-label="Employees">
            {list.items.map((e) => (
              <li key={e.id} className="flex min-w-0 items-start gap-3 p-3">
                <EmployeeAvatar employeeId={e.id} photoId={e.photoId} name={e.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <NameLink e={e} />
                    <ContactLinks name={e.name} phone={e.phone} whatsapp={e.whatsapp} size="sm" />
                  </div>
                  <p className="mt-0.5 text-[0.8125rem] break-words text-muted-foreground">
                    {e.code} · {post(e)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                    <StatusBadges e={e} today={today} />
                    <span>{service(e)}</span>
                  </div>
                </div>
                <RowMenu e={e} can={can} onAssign={assign} className="-mr-1" />
              </li>
            ))}
          </ul>
          <div className="hidden lg:block">
            <Table aria-label="Employees">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Employee</TableHead>
                  <TableHead>Post</TableHead>
                  <TableHead>Time here</TableHead>
                  <TableHead>Status</TableHead>
                  {seeSalaries && <TableHead className="text-right">Monthly salary</TableHead>}
                  <TableHead className="w-12">
                    <span className="sr-only">Menu</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="py-2.5">
                      <div className="flex items-center gap-3">
                        <EmployeeAvatar
                          employeeId={e.id}
                          photoId={e.photoId}
                          name={e.name}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <NameLink e={e} />
                            <ContactLinks
                              name={e.name}
                              phone={e.phone}
                              whatsapp={e.whatsapp}
                              size="sm"
                            />
                          </div>
                          <div className="text-[0.8125rem] text-muted-foreground">
                            {e.code}
                            {e.hasLogin && " · has a login"}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-56 truncate">{e.designation ?? "–"}</div>
                      {e.department && (
                        <div className="max-w-56 truncate text-[0.8125rem] text-muted-foreground">
                          {e.department}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {service(e)}
                      <div className="text-[0.8125rem] text-muted-foreground">
                        {e.joinDate > today ? "" : `Joined ${formatDay(e.joinDate)}`}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        <StatusBadges e={e} today={today} />
                      </div>
                    </TableCell>
                    {seeSalaries && (
                      <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                        {e.salary ? money(e.salary, currency) : "–"}
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      <RowMenu e={e} can={can} onAssign={assign} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      <ShowMore list={list} noun="employees" />
      {assigning && (
        <TaskDialog
          assignTo={assigning}
          timeZone={timeZone}
          today={today}
          onClose={() => setAssigning(null)}
          onDone={(message, id) => {
            setAssigning(null);
            toast.success(message, {
              label: "Open the task",
              onClick: () => router.push(plannerHref.task(id)),
            });
          }}
        />
      )}
    </div>
  );
}
