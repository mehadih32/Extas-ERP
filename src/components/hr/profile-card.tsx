import { BriefcaseIcon, CalendarDaysIcon, MapPinIcon } from "lucide-react";

import { formatDay } from "@/lib/display";
import type { EmployeeScreen } from "@/modules/hr/screens.service";

import { EmployeeBadge, FlagBadge } from "./badges";
import { ContactLinks } from "./contact-links";
import { EmployeeAvatar } from "./employee-avatar";

/**
 * The card at the side of an employee's 360° profile, in view whichever tab
 * is open: their photo, name, Employee ID, post, status, contact buttons, the
 * day they joined and how long they have been here.
 */
export function EmployeeProfileCard({
  employee: e,
  pendingPayChange,
}: {
  employee: EmployeeScreen["employee"];
  pendingPayChange: boolean;
}) {
  const post = [e.designation, e.department].filter(Boolean).join(" · ");
  return (
    <div className="grid justify-items-center gap-3 text-center">
      <EmployeeAvatar employeeId={e.id} photoId={e.photoId} name={e.name} size="xl" />
      <div className="min-w-0">
        <p className="eyebrow">{e.code}</p>
        <h2 className="mt-1 font-serif text-2xl leading-tight break-words text-primary">
          {e.name}
        </h2>
        <p className="mt-1 text-sm break-words text-muted-foreground">{post || "No post set"}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        <EmployeeBadge status={e.status} />
        {e.exitDate && e.isCurrent && (
          <FlagBadge tone="warn">Leaving {formatDay(e.exitDate)}</FlagBadge>
        )}
        {e.exitDate && !e.isCurrent && <FlagBadge>Left {formatDay(e.exitDate)}</FlagBadge>}
        {pendingPayChange && <FlagBadge tone="warn">Pay change to approve</FlagBadge>}
      </div>
      <ContactLinks name={e.name} phone={e.phone} whatsapp={e.whatsapp} email={e.email} />
      <dl className="mt-1 grid w-full gap-3 border-t pt-4 text-left text-sm">
        <div className="flex items-start gap-2.5">
          <CalendarDaysIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <dt className="sr-only">With the company</dt>
            <dd>
              {e.tenure ? `Joined ${formatDay(e.joinDate)}` : `Joins ${formatDay(e.joinDate)}`}
              {e.tenure && (
                <span className="block text-muted-foreground">
                  {e.isCurrent ? `${e.tenure.short} here` : `Was here ${e.tenure.short}`}
                </span>
              )}
            </dd>
          </div>
        </div>
        {post && (
          <div className="flex items-start gap-2.5">
            <BriefcaseIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <dt className="sr-only">Post</dt>
              <dd className="break-words">{post}</dd>
            </div>
          </div>
        )}
        {e.workPlace && (
          <div className="flex items-start gap-2.5">
            <MapPinIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <dt className="sr-only">Work place</dt>
              <dd className="break-words">{e.workPlace.name}</dd>
            </div>
          </div>
        )}
        {(e.phone || e.whatsapp || e.email) && (
          <div className="grid gap-1 border-t pt-3">
            {e.phone && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Phone</dt>
                <dd className="text-right break-all">{e.phone}</dd>
              </div>
            )}
            {e.whatsapp && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">WhatsApp</dt>
                <dd className="text-right break-all">{e.whatsapp}</dd>
              </div>
            )}
            {e.email && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Email</dt>
                <dd className="text-right break-all">{e.email}</dd>
              </div>
            )}
          </div>
        )}
      </dl>
    </div>
  );
}
