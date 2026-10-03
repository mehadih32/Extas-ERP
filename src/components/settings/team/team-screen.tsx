"use client";

import { SearchIcon, UserPlusIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { FormAlert } from "@/components/forms/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import type { Team, TeamMember } from "@/modules/rbac/member.service";
import { resetMemberPasswordAction, setMemberActiveAction } from "@/server/actions/rbac.actions";

import { type AddedMember, AddMemberDialog } from "./add-member-dialog";
import { ChangeRoleDialog } from "./change-role-dialog";
import { type MemberAction, MemberActions } from "./member-actions";
import { firstName, matchesSearch, memberStanding } from "./member-labels";
import { type IssuedPassword, TemporaryPasswordDialog } from "./temporary-password-dialog";

type Open =
  | { kind: "add" }
  | { kind: MemberAction; member: TeamMember }
  | { kind: "password"; issued: IssuedPassword }
  | { kind: "existing"; added: AddedMember }
  | null;

function StandingBadge({ member }: { member: TeamMember }) {
  const standing = memberStanding(member);
  if (standing.tone === "active") return null;
  return (
    <Badge
      variant={standing.tone === "alert" ? "alert" : "outline"}
      className={cn(standing.tone === "muted" && "text-muted-foreground")}
    >
      {standing.label}
    </Badge>
  );
}

function RoleBadge({ member }: { member: TeamMember }) {
  return (
    <Badge variant={member.role.systemRole === "SUPER_ADMIN" ? "default" : "secondary"}>
      {member.role.name}
    </Badge>
  );
}

function WhoBadges({ member }: { member: TeamMember }) {
  return (
    <>
      {member.isYou && <Badge variant="outline">You</Badge>}
      {member.isPlatformOwner && <Badge variant="outline">Platform owner</Badge>}
    </>
  );
}

const lastSignedIn = (member: TeamMember) =>
  member.lastSignedInOn ? formatDay(member.lastSignedInOn) : "Never";

/**
 * The Team screen: everyone in the company, with only the actions the server
 * allows the person looking on each member (worked out by rbac/rules.ts). A
 * table on computers, cards on phones.
 */
export function TeamScreen({ team, companyName }: { team: Team; companyName: string }) {
  const [query, setQuery] = useState("");
  const [showing, setShowing] = useState<"active" | "deactivated">("active");
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 8000);
    return () => clearTimeout(timer);
  }, [notice]);

  const active = team.members.filter((m) => m.isActive);
  const deactivated = team.members.filter((m) => !m.isActive);
  const view = deactivated.length === 0 ? "active" : showing;
  const members = (view === "active" ? active : deactivated).filter((m) => matchesSearch(m, query));
  const rolesById = new Map(team.roles.map((r) => [r.id, r]));
  const grantable = team.grantableRoleIds.flatMap((id) => rolesById.get(id) ?? []);
  const close = () => setOpen(null);
  const act = (kind: MemberAction, member: TeamMember) => {
    setNotice(undefined);
    setOpen({ kind, member });
  };

  return (
    <section aria-labelledby="team-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="team-heading" className="font-serif text-2xl text-primary">
            Team
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {active.length} {active.length === 1 ? "person" : "people"} can sign in to {companyName}
            . Each person&apos;s role decides what they can see and do.
          </p>
        </div>
        {grantable.length > 0 && (
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={() => {
              setNotice(undefined);
              setOpen({ kind: "add" });
            }}
          >
            <UserPlusIcon aria-hidden />
            Add a person
          </Button>
        )}
      </div>

      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, email, phone or role"
            aria-label="Search the team"
            className="pl-9"
          />
        </div>
        {deactivated.length > 0 && (
          <div
            role="group"
            aria-label="Show"
            className="grid grid-cols-2 rounded-md border bg-card p-1 text-sm sm:inline-grid"
          >
            {(
              [
                ["active", `Active (${active.length})`],
                ["deactivated", `Deactivated (${deactivated.length})`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                onClick={() => setShowing(value)}
                className={cn(
                  "h-9 cursor-pointer rounded-sm px-3 whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 md:h-8",
                  view === value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {members.length === 0 ? (
        <div className="rounded-md border border-dashed px-6 py-10 text-center">
          <p className="font-serif text-lg text-primary">
            {query.trim() ? "No one matches your search" : "No one here yet"}
          </p>
          {query.trim() && (
            <p className="mt-1 text-sm text-muted-foreground">
              Try part of a name, an email address or a role.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="hidden rounded-lg border bg-card px-5 py-1 md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Person</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last signed in</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="max-w-[22rem] min-w-[14rem] whitespace-normal">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium">{member.name}</span>
                        <WhoBadges member={member} />
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {member.email}
                        {member.phone && ` · ${member.phone}`}
                      </div>
                    </TableCell>
                    <TableCell>
                      <RoleBadge member={member} />
                    </TableCell>
                    <TableCell>
                      {memberStanding(member).tone === "active" ? (
                        <span className="text-muted-foreground">Active</span>
                      ) : (
                        <StandingBadge member={member} />
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{lastSignedIn(member)}</TableCell>
                    <TableCell className="text-right">
                      <MemberActions member={member} onAction={act} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="grid gap-3 md:hidden" aria-label="Team">
            {members.map((member) => (
              <li key={member.id} className="rounded-lg border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{member.name}</p>
                    <p className="truncate text-sm text-muted-foreground">{member.email}</p>
                    {member.phone && (
                      <p className="truncate text-sm text-muted-foreground">{member.phone}</p>
                    )}
                  </div>
                  <div className="-mt-2 -mr-2">
                    <MemberActions member={member} onAction={act} />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <RoleBadge member={member} />
                  <StandingBadge member={member} />
                  <WhoBadges member={member} />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Last signed in: {lastSignedIn(member)}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      {open?.kind === "add" && (
        <AddMemberDialog
          roles={grantable}
          companyName={companyName}
          onClose={close}
          onAdded={(added) =>
            setOpen(
              added.temporaryPassword
                ? {
                    kind: "password",
                    issued: {
                      reason: "added",
                      name: added.name,
                      email: added.email,
                      temporaryPassword: added.temporaryPassword,
                    },
                  }
                : { kind: "existing", added },
            )
          }
        />
      )}

      {open?.kind === "role" && (
        <ChangeRoleDialog
          member={open.member}
          choices={open.member.roleChoices.flatMap((id) => rolesById.get(id) ?? [])}
          onClose={close}
          onChanged={(roleName) => {
            setNotice(`${open.member.name} is now ${roleName}.`);
            close();
          }}
        />
      )}

      {open?.kind === "deactivate" && (
        <ConfirmDialog
          title={`Deactivate ${open.member.name}?`}
          description={`${firstName(open.member.name)} loses access to ${companyName} straight away. Their records stay, and you can reactivate them at any time.`}
          confirmLabel="Deactivate"
          pendingLabel="Deactivating"
          destructive
          errorTitle="We could not deactivate this person"
          onClose={close}
          onConfirm={async () => {
            const result = await setMemberActiveAction(open.member.id, false);
            if (!result.ok) return result.error;
            setNotice(`${open.member.name} no longer has access to ${companyName}.`);
            close();
          }}
        />
      )}

      {open?.kind === "reactivate" && (
        <ConfirmDialog
          title={`Reactivate ${open.member.name}?`}
          description={`${firstName(open.member.name)} can sign in to ${companyName} again, as ${open.member.role.name}.`}
          confirmLabel="Reactivate"
          pendingLabel="Reactivating"
          errorTitle="We could not reactivate this person"
          onClose={close}
          onConfirm={async () => {
            const result = await setMemberActiveAction(open.member.id, true);
            if (!result.ok) return result.error;
            setNotice(`${open.member.name} can sign in to ${companyName} again.`);
            close();
          }}
        />
      )}

      {open?.kind === "reset" && (
        <ConfirmDialog
          title={`Reset ${firstName(open.member.name)}'s password?`}
          description={`${open.member.name} is signed out on every device and gets a temporary password, which you hand over. Their current password stops working.`}
          confirmLabel="Reset password"
          pendingLabel="Resetting"
          destructive
          errorTitle="We could not reset the password"
          onClose={close}
          onConfirm={async () => {
            const result = await resetMemberPasswordAction(open.member.id);
            if (!result.ok) return result.error;
            setOpen({
              kind: "password",
              issued: {
                reason: "reset",
                name: open.member.name,
                email: open.member.email,
                temporaryPassword: result.data.temporaryPassword,
              },
            });
          }}
        />
      )}

      {open?.kind === "password" && (
        <TemporaryPasswordDialog issued={open.issued} companyName={companyName} onDone={close} />
      )}

      {open?.kind === "existing" && (
        <Dialog open onOpenChange={(isOpen) => !isOpen && close()}>
          <DialogContent>
            <DialogHeader>
              <p className="eyebrow text-primary">Added to the team</p>
              <DialogTitle>{open.added.name} already has an account</DialogTitle>
              <DialogDescription>
                {open.added.email} keeps their own password, so there is no temporary one. They can
                now open {companyName} from their company list, as {open.added.roleName}.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" onClick={close}>
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
