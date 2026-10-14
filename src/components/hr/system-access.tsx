"use client";

import {
  KeyRoundIcon,
  PowerIcon,
  PowerOffIcon,
  Settings2Icon,
  ShieldIcon,
  UserXIcon,
} from "lucide-react";
import { useState } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { MemberAccessDialog } from "@/components/settings/team/member-access-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDay } from "@/lib/display";
import type { SystemAccess } from "@/modules/hr/login.service";
import {
  changeEmployeeLoginAction,
  grantPortalAccessAction,
  revokePortalAccessAction,
} from "@/server/actions/hr.actions";

import { FlagBadge } from "./badges";
import { useNotice } from "./use-notice";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Open = "give" | "role" | "permissions" | "off" | "on" | "remove" | null;

/** The role choices: the Employee role first, as most logins are staff checking in. */
function RoleSelect({
  id,
  roles,
  defaultValue,
}: {
  id: string;
  roles: SystemAccess["roles"];
  defaultValue?: string;
}) {
  const ordered = [
    ...roles.filter((r) => r.systemRole === "EMPLOYEE"),
    ...roles.filter((r) => r.systemRole !== "EMPLOYEE"),
  ];
  return (
    <NativeSelect
      id={id}
      name="roleId"
      defaultValue={defaultValue ?? ordered[0]?.id}
      containerClassName="sm:w-full"
    >
      {ordered.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </NativeSelect>
  );
}

/**
 * The System access card on an employee's profile: their login, the role it
 * works in, whether it is on and when it last signed in. HR gives or removes
 * the login; people who manage users also choose its role and switch it off
 * or on, under the same rules as Settings > Team (`access.can`). Changing the
 * role, the ⚙ next to it and a newly given login open the permission matrix
 * (every permission as a tree, area > part > action) as on Settings > Team.
 */
export function SystemAccessCard({
  employee: e,
  access,
}: {
  employee: { id: string; name: string; email: string | null; phone: string | null };
  access: SystemAccess;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useNotice();
  const [password, setPassword] = useState<{ email: string; password: string } | null>(null);
  const { login, can, roles } = access;
  const close = () => setOpen(null);
  const done = (message: string) => {
    setNotice(message);
    close();
  };
  const actions = can.give || can.changeRole || can.switchOff || can.switchOn || can.remove;

  return (
    <div className="grid gap-4">
      {login ? (
        <dl className="grid gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {login.active ? (
              <FlagBadge tone="open">{login.invited ? "Not signed in yet" : "Login on"}</FlagBadge>
            ) : (
              <FlagBadge tone="closed">Login switched off</FlagBadge>
            )}
          </div>
          <div>
            <dt className="eyebrow">Signs in as</dt>
            <dd className="mt-1 break-words">{login.email}</dd>
          </div>
          <div>
            <dt className="eyebrow">Role</dt>
            <dd className="mt-1 flex items-center gap-1.5">
              <ShieldIcon className="size-4 text-muted-foreground" aria-hidden />
              {login.role.name}
              {(login.permissions.added.length > 0 || login.permissions.removed.length > 0) && (
                <span className="text-xs text-muted-foreground">
                  (
                  {[
                    login.permissions.added.length > 0 && `${login.permissions.added.length} added`,
                    login.permissions.removed.length > 0 &&
                      `${login.permissions.removed.length} taken away`,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  )
                </span>
              )}
              {(can.editPermissions || can.changeRole) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="-my-1 size-9 text-muted-foreground md:size-7"
                  onClick={() => setOpen("permissions")}
                  aria-label={`Edit ${e.name}'s permissions`}
                  title="Edit permissions"
                >
                  <Settings2Icon aria-hidden />
                </Button>
              )}
            </dd>
          </div>
          <div>
            <dt className="eyebrow">Last sign-in</dt>
            <dd className="mt-1 text-muted-foreground">
              {login.lastSignIn
                ? `${formatDay(login.lastSignIn.day)} at ${login.lastSignIn.time}`
                : "Never"}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">
          No login yet. With one, {e.name} checks in from their phone and sees their own HR records,
          or works in the role you choose.
        </p>
      )}

      {actions && (
        <div className="grid gap-2">
          {can.give && (
            <Button type="button" className="w-full" onClick={() => setOpen("give")}>
              <KeyRoundIcon aria-hidden />
              Give a login
            </Button>
          )}
          {can.changeRole && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setOpen("role")}
            >
              <ShieldIcon aria-hidden />
              Change the role
            </Button>
          )}
          {can.switchOff && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setOpen("off")}
            >
              <PowerOffIcon aria-hidden />
              Switch the login off
            </Button>
          )}
          {can.switchOn && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setOpen("on")}
            >
              <PowerIcon aria-hidden />
              Switch the login on
            </Button>
          )}
          {can.remove && (
            <Button
              type="button"
              variant="outline"
              className="w-full text-destructive hover:text-destructive"
              onClick={() => setOpen("remove")}
            >
              <UserXIcon aria-hidden />
              Remove the login
            </Button>
          )}
        </div>
      )}

      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {password && (
        <FormAlert tone="success">
          {e.name} signs in as {password.email} with the temporary password{" "}
          <span className="rounded-sm bg-card px-1.5 py-0.5 font-mono tracking-wide">
            {password.password}
          </span>
          . Hand it over now: it is shown once, and they choose their own when they first sign in.
        </FormAlert>
      )}

      {open === "give" && (
        <FormDialog
          title={`Give ${e.name} a login`}
          description={
            can.chooseRole
              ? "Choose what the login opens. The Employee role checks in from the phone, asks for leave and sees their own payslips and advances, and nothing else of the company's. Someone new gets a temporary password to hand over."
              : "With a login they check in from their phone, ask for leave, and see their payslips and advances, and nothing else of the company's. Someone new gets a temporary password to hand over."
          }
          submitLabel="Give the login"
          pendingLabel="Giving"
          errorTitle="We could not give the login"
          onClose={close}
          onSubmit={async (form) => {
            const email = textOf(form, "email");
            if (!EMAIL_PATTERN.test(email)) {
              return problem({ email: "Enter an email like name@example.com." });
            }
            const result = await grantPortalAccessAction(e.id, {
              email,
              phone: textOf(form, "phone") || undefined,
              ...(can.chooseRole ? { roleId: textOf(form, "roleId") } : {}),
            });
            if (!result.ok) return result.error;
            const signsInAs = result.data.email ?? email;
            if (result.data.temporaryPassword) {
              setPassword({ email: signsInAs, password: result.data.temporaryPassword });
              close();
            } else {
              setPassword(null);
              done(`${e.name} now signs in as ${signsInAs} with the password they already have.`);
            }
            // The role is given: the permission matrix shows what it opens, to adjust.
            if (can.editPermissions) setOpen("permissions");
          }}
        >
          {(fieldError) => (
            <>
              <Field
                id="login-email"
                label="Email they sign in with"
                hint={
                  can.chooseRole
                    ? "Someone already in the company keeps their password and moves to the role chosen."
                    : "Someone already in the company keeps their role and password."
                }
                error={fieldError("email")}
              >
                <Input
                  id="login-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoComplete="off"
                  defaultValue={e.email ?? undefined}
                  aria-invalid={Boolean(fieldError("email"))}
                  aria-describedby={fieldError("email") ? "login-email-error" : "login-email-hint"}
                  autoFocus
                />
              </Field>
              <Field id="login-phone" label="Phone (optional)" error={fieldError("phone")}>
                <Input
                  id="login-phone"
                  name="phone"
                  type="tel"
                  maxLength={30}
                  defaultValue={e.phone ?? undefined}
                />
              </Field>
              {can.chooseRole && (
                <Field id="login-role" label="Role" error={fieldError("roleId")}>
                  <RoleSelect id="login-role" roles={roles} />
                </Field>
              )}
            </>
          )}
        </FormDialog>
      )}

      {(open === "role" || open === "permissions") && login && (
        <MemberAccessDialog
          member={{
            id: login.id,
            name: e.name,
            isYou: login.isYou,
            roleId: login.role.id,
            permissions: login.permissions,
          }}
          roles={roles}
          initialRoleId={
            open === "role" ? roles.find((r) => r.id !== login.role.id)?.id : undefined
          }
          canChangeRole={can.changeRole}
          canEditPermissions={can.editPermissions}
          onClose={close}
          onSaved={done}
        />
      )}

      {(open === "off" || open === "on") && login && (
        <FormDialog
          title={open === "off" ? `Switch ${e.name}'s login off?` : `Switch ${e.name}'s login on?`}
          description={
            open === "off"
              ? `${login.email} is signed out of this company at once and cannot open it until the login is switched on again. Their HR records and role stay.`
              : `${login.email} can sign in again, as ${login.role.name}.`
          }
          submitLabel={open === "off" ? "Switch off" : "Switch on"}
          pendingLabel="Saving"
          destructive={open === "off"}
          errorTitle="We could not change the login"
          onClose={close}
          onSubmit={async () => {
            const result = await changeEmployeeLoginAction(e.id, { active: open === "on" });
            if (!result.ok) return result.error;
            done(
              result.data.active
                ? `${e.name}'s login is on again.`
                : `${e.name}'s login is switched off.`,
            );
          }}
        >
          {() => null}
        </FormDialog>
      )}

      {open === "remove" && (
        <FormDialog
          title={`Remove ${e.name}'s login?`}
          description={`${login?.email ?? "Their login"} stops opening their HR records. A login that only had the Employee role is switched off for this company; anyone with another role keeps it.`}
          submitLabel="Remove the login"
          pendingLabel="Removing"
          destructive
          errorTitle="We could not remove the login"
          onClose={close}
          onSubmit={async () => {
            const result = await revokePortalAccessAction(e.id);
            if (!result.ok) return result.error;
            setPassword(null);
            done(`${e.name} no longer has a login.`);
          }}
        >
          {() => null}
        </FormDialog>
      )}
    </div>
  );
}
