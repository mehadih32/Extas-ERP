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
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionError } from "@/lib/result";
import type { TeamRole } from "@/modules/rbac/member.service";
import { addMemberAction } from "@/server/actions/rbac.actions";

import { roleHint } from "./role-hint";

export type AddedMember = {
  name: string;
  email: string;
  roleName: string;
  /** Only for a new account; someone who already has one keeps their password. */
  temporaryPassword?: string;
};

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Adds someone to the company. The role list holds only the roles this person may
 * give (Super Admin only for Super Admins), as the server checks again.
 */
export function AddMemberDialog({
  roles,
  companyName,
  onClose,
  onAdded,
}: {
  /** The roles this person may give, Employee first if it is there. */
  roles: TeamRole[];
  companyName: string;
  onClose: () => void;
  onAdded: (added: AddedMember) => void;
}) {
  const [roleId, setRoleId] = useState(
    (roles.find((r) => r.systemRole === "EMPLOYEE") ?? roles[0])?.id ?? "",
  );
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  const fieldError = (name: string) => error?.fieldErrors?.[name]?.[0];
  const hasFieldErrors = ["name", "email", "phone", "roleId"].some((f) => fieldError(f));

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const phone = text(form, "phone").trim();
    const input = {
      name: text(form, "name"),
      email: text(form, "email"),
      phone: phone || undefined,
      roleId,
    };
    startTransition(async () => {
      const result = await addMemberAction(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const { membership, temporaryPassword } = result.data;
      onAdded({
        name: membership.user.name,
        email: membership.user.email,
        roleName: membership.role.name,
        temporaryPassword,
      });
    });
  }

  const described = (name: string) => (fieldError(name) ? `${name}-error` : undefined);
  const hint = roleHint(roles.find((r) => r.id === roleId));

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a person</DialogTitle>
          <DialogDescription>
            They can sign in to {companyName} with their email. Someone new gets a temporary
            password to hand over; someone who already has an account keeps their own.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <Field id="name" label="Full name" error={fieldError("name")}>
            <Input
              id="name"
              name="name"
              autoComplete="off"
              aria-invalid={Boolean(fieldError("name"))}
              aria-describedby={described("name")}
              required
              autoFocus
            />
          </Field>
          <Field id="email" label="Email" error={fieldError("email")}>
            <Input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={Boolean(fieldError("email"))}
              aria-describedby={described("email")}
              required
            />
          </Field>
          <Field
            id="phone"
            label="Phone (optional)"
            hint="For your records; nothing is sent to it."
            error={fieldError("phone")}
          >
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              aria-invalid={Boolean(fieldError("phone"))}
              aria-describedby={fieldError("phone") ? "phone-error" : "phone-hint"}
            />
          </Field>
          <Field id="roleId" label="Role" hint={hint} error={fieldError("roleId")}>
            <NativeSelect
              id="roleId"
              value={roleId}
              onChange={(event) => setRoleId(event.target.value)}
              containerClassName="sm:w-full"
              className="md:h-10"
              aria-invalid={Boolean(fieldError("roleId"))}
              aria-describedby={described("roleId") ?? (hint ? "roleId-hint" : undefined)}
            >
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </NativeSelect>
          </Field>

          {error && error.code !== "INTERNAL" && !hasFieldErrors && (
            <FormAlert>{error.message}</FormAlert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
              {pending ? "Adding" : "Add to the team"}
            </Button>
          </DialogFooter>
        </form>
        {error?.code === "INTERNAL" && (
          <ErrorDialog
            code={error.errorId ?? "ERR-UNKNOWN"}
            title="We could not add this person"
            onClose={() => setError(undefined)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
