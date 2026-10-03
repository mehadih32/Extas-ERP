"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
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
import type { TeamMember, TeamRole } from "@/modules/rbac/member.service";
import { changeMemberRoleAction } from "@/server/actions/rbac.actions";

import { firstName } from "./member-labels";
import { roleHint } from "./role-hint";

/**
 * Moves a member to another role. Only the roles the server would accept for this
 * member are offered (the member's `roleChoices`).
 */
export function ChangeRoleDialog({
  member,
  choices,
  onClose,
  onChanged,
}: {
  member: TeamMember;
  /** The member's roleChoices, as roles. */
  choices: TeamRole[];
  onClose: () => void;
  onChanged: (roleName: string) => void;
}) {
  const [roleId, setRoleId] = useState(choices[0]?.id ?? "");
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  const chosen = choices.find((r) => r.id === roleId);
  const hint = roleHint(chosen);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await changeMemberRoleAction(member.id, roleId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onChanged(result.data.role.name);
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change {firstName(member.name)}&apos;s role</DialogTitle>
          <DialogDescription>
            {member.name} is {member.role.name} now. The new role decides what they can see and do
            from their next click.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <Field id="newRole" label="New role" hint={hint}>
            <NativeSelect
              id="newRole"
              value={roleId}
              onChange={(event) => setRoleId(event.target.value)}
              containerClassName="sm:w-full"
              className="md:h-10"
              aria-describedby={hint ? "newRole-hint" : undefined}
            >
              {choices.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {member.isYou && (
            <FormAlert tone="note">
              This is your own role. If the new role cannot manage the team, you will lose this
              screen as soon as you save.
            </FormAlert>
          )}
          {error && error.code !== "INTERNAL" && <FormAlert>{error.message}</FormAlert>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !chosen}>
              {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
              {pending ? "Saving" : "Change role"}
            </Button>
          </DialogFooter>
        </form>
        {error?.code === "INTERNAL" && (
          <ErrorDialog
            code={error.errorId ?? "ERR-UNKNOWN"}
            title="We could not change the role"
            onClose={() => setError(undefined)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
