"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { warnsAboutMoney } from "@/components/settings/roles/role-labels";
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
import type { PermissionKey } from "@/modules/rbac/permissions";
import { addMemberAction } from "@/server/actions/rbac.actions";

import { firstName } from "./member-labels";
import { PERMISSION_TOTAL, PermissionMatrix } from "./permission-matrix";
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

type Details = { name: string; email: string; phone?: string };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Adds someone to the company. The role list holds only the roles this person may
 * give (Super Admin only for Super Admins), as the server checks again. For
 * people who manage roles, choosing the role opens the permission matrix next:
 * every permission A to Z with the role's ticked, to untick or add to before
 * the person is added.
 */
export function AddMemberDialog({
  roles,
  canEditPermissions,
  companyName,
  onClose,
  onAdded,
}: {
  /** The roles this person may give, Employee first if it is there. */
  roles: TeamRole[];
  /** Whether the matrix step comes after the details (company.roles.manage). */
  canEditPermissions: boolean;
  companyName: string;
  onClose: () => void;
  onAdded: (added: AddedMember) => void;
}) {
  const [roleId, setRoleId] = useState(
    (roles.find((r) => r.systemRole === "EMPLOYEE") ?? roles[0])?.id ?? "",
  );
  const [details, setDetails] = useState<Details>();
  const [step, setStep] = useState<"details" | "permissions">("details");
  const [selected, setSelected] = useState<Set<PermissionKey>>(new Set());
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  const fieldError = (name: string) => error?.fieldErrors?.[name]?.[0];
  const hasFieldErrors = ["name", "email", "phone", "roleId"].some((f) => fieldError(f));
  const role = roles.find((r) => r.id === roleId);
  const matrix = canEditPermissions && role !== undefined && role.systemRole !== "SUPER_ADMIN";

  function add(input: Details & { roleId: string; permissions?: PermissionKey[] }) {
    startTransition(async () => {
      const result = await addMemberAction(input);
      if (!result.ok) {
        setError(result.error);
        // A problem with the details is shown where they are typed.
        if (["name", "email", "phone", "roleId"].some((f) => result.error.fieldErrors?.[f])) {
          setStep("details");
        }
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

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const phone = text(form, "phone").trim();
    const typed: Details = {
      name: text(form, "name"),
      email: text(form, "email"),
      phone: phone || undefined,
    };
    setDetails(typed);
    if (!matrix) {
      add({ ...typed, roleId });
      return;
    }
    // The matrix comes next: catch the plain slips here, the server checks the rest.
    const problems: Record<string, string[]> = {};
    if (typed.name.trim().length < 2) problems.name = ["Enter their name (at least 2 characters)"];
    if (!EMAIL_PATTERN.test(typed.email.trim())) {
      problems.email = ["Enter an email like name@example.com."];
    }
    if (Object.keys(problems).length > 0) {
      setError({ code: "VALIDATION", message: "Check the details.", fieldErrors: problems });
      return;
    }
    setError(undefined);
    setSelected(new Set(role!.permissions));
    setStep("permissions");
  }

  const described = (name: string) => (fieldError(name) ? `${name}-error` : undefined);
  const hint = roleHint(role);

  if (step === "permissions" && details && role) {
    const roleKeys = new Set(role.permissions);
    const added = [...selected].filter((key) => !roleKeys.has(key)).length;
    const removed = role.permissions.filter((key) => !selected.has(key)).length;
    return (
      // Its own window (key), so it opens at the top rather than where the details were scrolled.
      <Dialog key="permissions" open onOpenChange={(open) => !open && !pending && onClose()}>
        <DialogContent className="flex flex-col gap-4 sm:max-w-2xl">
          <DialogHeader>
            <p className="eyebrow text-primary">Full disclosure permission matrix</p>
            <DialogTitle>What {firstName(details.name)} can see and do</DialogTitle>
            <DialogDescription>
              Every permission in the app, A to Z, with what {role.name} gives ticked. Untick
              anything {firstName(details.name)} should not see; it is hidden from them. Tick more
              to give it to them alone.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              add({ ...details, roleId, permissions: [...selected] });
            }}
            className="flex min-h-0 flex-1 flex-col gap-4"
            noValidate
          >
            <PermissionMatrix
              roleName={role.name}
              roleKeys={roleKeys}
              selected={selected}
              onChange={(next) => {
                setError(undefined);
                setSelected(next);
              }}
            />
            {warnsAboutMoney(role, selected) && (
              <FormAlert tone="note">
                {firstName(details.name)} will be able to record money coming in or going out. By
                default only Accounts and Super Admin can.
              </FormAlert>
            )}
            {error && error.code !== "INTERNAL" && <FormAlert>{error.message}</FormAlert>}
            <DialogFooter className="flex-row flex-wrap items-center justify-end">
              <p
                className="w-full text-sm text-muted-foreground tabular-nums sm:mr-auto sm:w-auto"
                aria-live="polite"
              >
                {selected.size} of {PERMISSION_TOTAL} permissions
                {added > 0 && ` · ${added} added`}
                {removed > 0 && ` · ${removed} taken away`}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setError(undefined);
                  setStep("details");
                }}
                disabled={pending}
              >
                Back
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
              defaultValue={details?.name}
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
              defaultValue={details?.email}
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
              defaultValue={details?.phone}
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
              {pending ? "Adding" : matrix ? "Next: permissions" : "Add to the team"}
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
