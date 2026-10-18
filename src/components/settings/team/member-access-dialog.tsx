"use client";

import type { SystemRole } from "@prisma/client";
import { LoaderCircleIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { roleSummary, warnsAboutMoney } from "@/components/settings/roles/role-labels";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionError } from "@/lib/result";
import type { PermissionKey } from "@/modules/rbac/permissions";
import { setMemberAccessAction } from "@/server/actions/rbac.actions";

import { firstName } from "./member-labels";
import { PERMISSION_TOTAL, PermissionMatrix } from "./permission-matrix";

/** A role as the matrix needs it: what it gives (every permission for Super Admin). */
export type AccessRole = {
  id: string;
  name: string;
  description?: string | null;
  systemRole: SystemRole | null;
  permissions: PermissionKey[];
};

export type AccessMember = {
  /** The membership. */
  id: string;
  name: string;
  isYou: boolean;
  roleId: string;
  /** Their own changes to the role's permissions. */
  permissions: { added: PermissionKey[]; removed: PermissionKey[] };
};

/** The role's permissions with the member's own changes on top. */
function effective(role: AccessRole, member: AccessMember): Set<PermissionKey> {
  const keys = new Set(role.permissions);
  for (const key of member.permissions.added) keys.add(key);
  for (const key of member.permissions.removed) keys.delete(key);
  return keys;
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((key) => b.has(key));

/**
 * The full disclosure permission matrix for one member, in a window: their role
 * (when they may be moved) and every permission in the app as a tree (area >
 * part > action), with what the role gives ticked. Unticking hides that part of the app from them;
 * ticking more gives it to them alone. Choosing another role starts from that
 * role's permissions. Opens when a role is given (Change role, a new login) and
 * from the ⚙ next to someone's role.
 */
export function MemberAccessDialog({
  member,
  roles,
  initialRoleId,
  canChangeRole,
  canEditPermissions,
  lockedPermissions = [],
  onClose,
  onSaved,
}: {
  member: AccessMember;
  /** Their role and the roles they may be moved to. */
  roles: AccessRole[];
  /** The role picked when the window opens (Change role picks the first other one). */
  initialRoleId?: string;
  canChangeRole: boolean;
  /** Whether the person looking may tick permissions for this member (the server's rule). */
  canEditPermissions: boolean;
  /** Permissions only a Super Admin may give: they stay locked unless the member holds them now. */
  lockedPermissions?: readonly PermissionKey[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const current = roles.find((r) => r.id === member.roleId);
  const [roleId, setRoleId] = useState(initialRoleId ?? member.roleId);
  const role = roles.find((r) => r.id === roleId) ?? current;
  const [selected, setSelected] = useState<Set<PermissionKey>>(() =>
    role
      ? role.id === member.roleId
        ? effective(role, member)
        : new Set(role.permissions)
      : new Set(),
  );
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  if (!role) return null;

  const first = firstName(member.name);
  const moving = role.id !== member.roleId;
  const superAdmin = role.systemRole === "SUPER_ADMIN";
  const editable = canEditPermissions && !superAdmin && !member.isYou;
  const roleKeys = new Set(role.permissions);
  const shownKeys = superAdmin ? roleKeys : selected;
  const saved = current ? effective(current, member) : new Set<PermissionKey>();
  const locked = new Set(lockedPermissions.filter((key) => !saved.has(key)));
  const changed = moving || (editable && !sameSet(selected, saved));
  const added = [...shownKeys].filter((key) => !roleKeys.has(key)).length;
  const removed = [...roleKeys].filter((key) => !shownKeys.has(key)).length;
  const others = roles.filter((r) => r.id !== member.roleId);
  const hint = roleSummary({ description: role.description ?? null, systemRole: role.systemRole });

  function pickRole(id: string) {
    const next = roles.find((r) => r.id === id);
    if (!next) return;
    setRoleId(id);
    setError(undefined);
    setSelected(
      id === member.roleId && current ? effective(current, member) : new Set(next.permissions),
    );
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = {
      ...(moving ? { roleId: role!.id } : {}),
      ...(editable ? { permissions: [...selected] } : {}),
    };
    startTransition(async () => {
      const result = await setMemberAccessAction(member.id, input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(
        moving
          ? `${member.name} is now ${result.data.roleName}.`
          : `${member.name}'s permissions are saved.`,
      );
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="flex flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <p className="eyebrow text-primary">Full disclosure permission matrix</p>
          <DialogTitle>
            {moving || (canChangeRole && initialRoleId)
              ? `Change ${first}'s role`
              : `${first}'s permissions`}
          </DialogTitle>
          <DialogDescription>
            Every permission in the app, by area. {first} can see and use what is ticked; everything
            left unticked is hidden from them. Open an area with its arrow to tick only some of it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4 sm:min-h-0 sm:flex-1" noValidate>
          {canChangeRole && others.length > 0 ? (
            <Field id="access-role" label="Role" hint={hint ?? undefined}>
              <NativeSelect
                id="access-role"
                value={role.id}
                onChange={(event) => pickRole(event.target.value)}
                containerClassName="sm:w-full"
                className="md:h-10"
                aria-describedby={hint ? "access-role-hint" : undefined}
              >
                {[...(current ? [current] : []), ...others].map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id === member.roleId ? `${r.name} (now)` : r.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : (
            <p className="text-sm">
              Role: <span className="font-medium">{role.name}</span>
            </p>
          )}

          {superAdmin ? (
            <FormAlert tone="note">A Super Admin always has every permission.</FormAlert>
          ) : member.isYou ? (
            <FormAlert tone="note">
              You cannot change your own role or permissions. Another admin can.
            </FormAlert>
          ) : (
            !canEditPermissions && (
              <FormAlert tone="note">
                This is what the role gives. Ticking or unticking for one person needs the
                permission to manage roles.
              </FormAlert>
            )
          )}

          <PermissionMatrix
            key={role.id}
            roleName={role.name}
            roleKeys={roleKeys}
            selected={shownKeys}
            locked={locked}
            onChange={
              editable
                ? (next) => {
                    setError(undefined);
                    setSelected(next);
                  }
                : undefined
            }
          />

          {editable && warnsAboutMoney(role, selected) && (
            <FormAlert tone="note">
              {first} will be able to record money coming in or going out. By default only Accounts
              and Super Admin can.
            </FormAlert>
          )}
          {error && error.code !== "INTERNAL" && <FormAlert>{error.message}</FormAlert>}

          <DialogFooter className="flex-row flex-wrap items-center justify-end">
            <p
              className="w-full text-sm text-muted-foreground tabular-nums sm:mr-auto sm:w-auto"
              aria-live="polite"
            >
              {shownKeys.size} of {PERMISSION_TOTAL} permissions
              {added > 0 && ` · ${added} added`}
              {removed > 0 && ` · ${removed} taken away`}
            </p>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {changed ? "Cancel" : "Close"}
            </Button>
            <Button type="submit" disabled={pending || !changed}>
              {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
              {pending ? "Saving" : moving ? "Save role and permissions" : "Save permissions"}
            </Button>
          </DialogFooter>
        </form>
        {error?.code === "INTERNAL" && (
          <ErrorDialog
            code={error.errorId ?? "ERR-UNKNOWN"}
            title="We could not save the permissions"
            onClose={() => setError(undefined)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
