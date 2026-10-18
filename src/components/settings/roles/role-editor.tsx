"use client";

import { LoaderCircleIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/result";
import type { PermissionKey } from "@/modules/rbac/permissions";
import type { RoleSummary } from "@/modules/rbac/role.service";
import {
  createRoleAction,
  deleteRoleAction,
  updateRoleAction,
} from "@/server/actions/rbac.actions";

import { AccessTree } from "./access-tree-view";
import { PERMISSION_COUNT, warnsAboutMoney } from "./role-labels";

const ROLES_PATH = "/settings/roles";

type Props = (
  | {
      mode: "create";
      /** Existing roles whose permissions a new role can start from. */
      templates: RoleSummary[];
    }
  | {
      mode: "edit";
      /** A role this person may edit (role.can.edit); renaming and deleting follow role.can. */
      role: RoleSummary;
    }
) & {
  /** Permissions only a Super Admin may add to a role: locked unless the role holds them now. */
  lockedPermissions?: readonly PermissionKey[];
};

function sameKeys(a: ReadonlySet<string>, b: readonly string[]): boolean {
  return a.size === b.length && b.every((key) => a.has(key));
}

/**
 * Creates a role or changes one: its name (custom roles only), description and
 * permissions, grouped as in the catalogue. The Super Admin role never comes
 * here; it always has every permission.
 */
export function RoleEditor(props: Props) {
  const router = useRouter();
  const role = props.mode === "edit" ? props.role : null;
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [selected, setSelected] = useState<Set<PermissionKey>>(
    () => new Set(role?.permissions ?? []),
  );
  const locked = new Set(
    (props.lockedPermissions ?? []).filter((key) => !role?.permissions.includes(key)),
  );
  const [startFrom, setStartFrom] = useState("");
  const [error, setError] = useState<ActionError>();
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useRef<HTMLFormElement>(null);

  // After a refused save, take the person to the first field that needs fixing.
  useEffect(() => {
    if (error?.fieldErrors)
      form.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
  }, [error]);

  /** A name already in use is said under the name. */
  function fail(refusal: ActionError) {
    setError(
      refusal.code === "CONFLICT" && !refusal.fieldErrors
        ? { ...refusal, fieldErrors: { name: [refusal.message] } }
        : refusal,
    );
  }

  const canRename = role ? role.can.rename : true;
  const fieldError = (field: string) => error?.fieldErrors?.[field]?.[0];
  const changed =
    !role ||
    (canRename && name.trim() !== role.name) ||
    description.trim() !== (role.description ?? "") ||
    !sameKeys(selected, role.permissions);

  function edit<T>(set: (value: T) => void) {
    return (value: T) => {
      setSaved(false);
      set(value);
    };
  }
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const permissions = [...selected];
    startTransition(async () => {
      if (!role) {
        const result = await createRoleAction({
          name,
          description: description.trim() || undefined,
          permissions,
        });
        if (!result.ok) {
          fail(result.error);
          return;
        }
        router.push(`${ROLES_PATH}/${result.data.id}?created=1`);
        return;
      }
      const result = await updateRoleAction(role.id, {
        ...(canRename ? { name } : {}),
        description: description.trim() || null,
        permissions,
      });
      if (!result.ok) {
        fail(result.error);
        return;
      }
      setError(undefined);
      setSaved(true);
    });
  }

  const nameHint = canRename ? undefined : "Built-in roles keep their name.";

  return (
    <form ref={form} onSubmit={submit} className="grid gap-8" noValidate>
      <section className="grid gap-5 rounded-lg border bg-card p-5 sm:p-6">
        <Field id="role-name" label="Name" hint={nameHint} error={fieldError("name")}>
          <Input
            id="role-name"
            value={name}
            onChange={(event) => edit(setName)(event.target.value)}
            disabled={!canRename}
            maxLength={60}
            aria-invalid={Boolean(fieldError("name"))}
            aria-describedby={
              fieldError("name") ? "role-name-error" : nameHint ? "role-name-hint" : undefined
            }
            autoFocus={!role}
            required
          />
        </Field>
        <Field
          id="role-description"
          label="What it is for (optional)"
          error={fieldError("description")}
        >
          <Textarea
            id="role-description"
            value={description}
            onChange={(event) => edit(setDescription)(event.target.value)}
            maxLength={300}
            rows={2}
            className="min-h-16"
            aria-invalid={Boolean(fieldError("description"))}
            aria-describedby={fieldError("description") ? "role-description-error" : undefined}
          />
        </Field>
        {props.mode === "create" && (
          <Field
            id="start-from"
            label="Start from"
            hint="Copies that role's permissions here; you can change them below."
          >
            <NativeSelect
              id="start-from"
              value={startFrom}
              onChange={(event) => {
                const from = props.templates.find((t) => t.id === event.target.value);
                setStartFrom(event.target.value);
                // A permission only a Super Admin may give is not copied.
                edit(setSelected)(
                  new Set((from?.permissions ?? []).filter((key) => !locked.has(key))),
                );
              }}
              containerClassName="sm:w-full"
              className="md:h-10"
              aria-describedby="start-from-hint"
            >
              <option value="">No permissions</option>
              {props.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
      </section>

      <section aria-labelledby="permissions-heading" className="grid gap-4">
        <div>
          <h2 id="permissions-heading" className="font-serif text-2xl text-primary">
            Permissions
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tick what people in this role may see and do. Everything else stays hidden from them.
            Ticking an area gives all of it; open it with its arrow to tick only some.
          </p>
        </div>
        {fieldError("permissions") && <FormAlert>{fieldError("permissions")}</FormAlert>}
        <AccessTree
          label="Permissions"
          selected={selected}
          locked={locked}
          onChange={(next) => edit(setSelected)(next)}
        />
      </section>

      {warnsAboutMoney(role, selected) && (
        <FormAlert tone="note">
          People in this role will be able to record money coming in or going out. By default only
          Accounts and Super Admin can.
        </FormAlert>
      )}
      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 -mx-4 flex flex-wrap items-center gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6 md:bottom-0 lg:-mx-8 lg:px-8">
        {error && error.code !== "INTERNAL" && !error.fieldErrors && (
          <div className="w-full">
            <FormAlert>{error.message}</FormAlert>
          </div>
        )}
        <p className="mr-auto text-sm text-muted-foreground tabular-nums" aria-live="polite">
          {saved ? (
            <span className="text-primary">Saved</span>
          ) : (
            `${selected.size} of ${PERMISSION_COUNT} permissions`
          )}
        </p>
        {role?.can.delete && (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:bg-destructive/5 hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
            disabled={pending}
          >
            <Trash2Icon aria-hidden />
            Delete
          </Button>
        )}
        <Button type="button" variant="outline" asChild>
          <Link href={ROLES_PATH}>{role ? "Back" : "Cancel"}</Link>
        </Button>
        <Button type="submit" disabled={pending || !changed}>
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {pending ? "Saving" : role ? "Save changes" : "Create role"}
        </Button>
      </div>

      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title="We could not save the role"
          onClose={() => setError(undefined)}
        />
      )}
      {role && confirmDelete && (
        <ConfirmDialog
          title={`Delete the role "${role.name}"?`}
          description="No one holds this role, so nobody loses access. This cannot be undone."
          confirmLabel="Delete role"
          pendingLabel="Deleting"
          destructive
          errorTitle="We could not delete the role"
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            const result = await deleteRoleAction(role.id);
            if (!result.ok) return result.error;
            router.push(`${ROLES_PATH}?deleted=1`);
          }}
        />
      )}
    </form>
  );
}
