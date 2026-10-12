"use client";

import { IdCardIcon } from "lucide-react";
import Link from "next/link";

import { Fact } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatDay } from "@/lib/display";
import type { MyHrScreen } from "@/modules/hr/screens.service";

import { EmployeeBadge, FlagBadge } from "./badges";
import { EmployeeAvatar } from "./employee-avatar";
import { hrHref } from "./labels";

type Profile = MyHrScreen["profile"];

const missing = <span className="text-muted-foreground">Not given yet</span>;

/** One group of the bio: a small heading over its facts. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 border-t pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-medium">{title}</h3>
      <dl className="grid gap-4 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

/**
 * The top of My HR: the employee's photo, name, Employee ID, post and time
 * here, with "View my full bio" opening everything HR holds about them (NID,
 * blood group, date of birth, emergency contact, reference person, address).
 */
export function MyProfileWidget({
  profile: p,
  photoId,
  tenure,
}: {
  profile: Profile;
  photoId: string | null;
  /** "2 yrs 3 mos", or null before the join day. */
  tenure: string | null;
}) {
  const post = [p.designation, p.department].filter(Boolean).join(" · ");
  const reference = [p.referenceName, p.referenceRelation].filter(Boolean).join(", ");

  return (
    <section
      aria-labelledby="me-heading"
      className="flex flex-col gap-4 rounded-lg border bg-card p-5 sm:flex-row sm:items-center sm:p-6"
    >
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <EmployeeAvatar employeeId={p.id} photoId={photoId} name={p.name} size="lg" />
        <div className="min-w-0">
          <p className="eyebrow">{p.code}</p>
          <h2
            id="me-heading"
            className="font-serif text-2xl leading-tight break-words text-primary"
          >
            {p.name}
          </h2>
          <p className="mt-0.5 text-sm break-words text-muted-foreground">
            {[post, tenure ? (p.isCurrent ? `${tenure} here` : `Was here ${tenure}`) : null]
              .filter(Boolean)
              .join(" · ") || "No post set"}
          </p>
        </div>
      </div>
      <Dialog>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" className="w-full sm:w-auto">
            <IdCardIcon aria-hidden />
            View my full bio
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader className="flex-row items-center gap-4 pr-6">
            <EmployeeAvatar employeeId={p.id} photoId={photoId} name={p.name} size="md" />
            <div className="min-w-0">
              <DialogTitle className="break-words">{p.name}</DialogTitle>
              <DialogDescription>
                {p.code}
                {post ? ` · ${post}` : ""}
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-1.5">
              <EmployeeBadge status={p.status} />
              {p.exitDate && <FlagBadge tone="warn">Leaving {formatDay(p.exitDate)}</FlagBadge>}
            </div>
            <Group title="About me">
              <Fact label="National ID">{p.nid ?? missing}</Fact>
              <Fact label="Date of birth">
                {p.dateOfBirth ? formatDay(p.dateOfBirth) : missing}
              </Fact>
              <Fact label="Blood group">{p.bloodGroup ?? missing}</Fact>
            </Group>
            <Group title="In an emergency">
              <Fact label="Emergency contact">{p.emergencyContact ?? missing}</Fact>
              <Fact label="Reference person">
                {reference || missing}
                {p.referencePhone && (
                  <span className="block text-muted-foreground">{p.referencePhone}</span>
                )}
              </Fact>
            </Group>
            <Group title="Contact">
              <Fact label="Phone">{p.phone ?? missing}</Fact>
              <Fact label="WhatsApp">{p.whatsapp ?? missing}</Fact>
              <Fact label="Email">{p.email ?? missing}</Fact>
              <Fact label="Address" className="sm:col-span-2">
                {p.address ? <span className="whitespace-pre-line">{p.address}</span> : missing}
              </Fact>
            </Group>
            <Group title="With the company">
              <Fact label="Joined">{formatDay(p.joinDate)}</Fact>
              {tenure && <Fact label="Time here">{tenure}</Fact>}
              {p.workPlace && <Fact label="Checks in at">{p.workPlace.name}</Fact>}
            </Group>
          </div>
          <DialogFooter>
            <Button asChild variant="outline">
              <Link href={hrHref.myProfile}>Update my details</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
