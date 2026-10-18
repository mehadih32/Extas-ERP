"use client";

import { LoaderCircleIcon, MailIcon, UnlockIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { askUnlockLinkAction, unlockWithLinkAction } from "@/server/actions/auth.actions";

/*
 * Unlocking sign-in from one's own mailbox (v6.4.1 B5): after too many wrong
 * passwords from one place, "Email me an unlock link" sends a link to the
 * account's own address; the link opens this screen with "Unlock my sign-in".
 */

type Said = { tone: "success" | "error"; text: string };

/** Under a sign-in that has to wait: sends the link to the email typed. */
export function AskUnlockLink({ email }: { email?: string }) {
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<Said>();
  return (
    <div className="grid gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={pending || !email}
        onClick={() =>
          start(async () => {
            const result = await askUnlockLinkAction({ email: email ?? "" });
            setSaid(
              result.ok
                ? { tone: "success", text: result.data }
                : { tone: "error", text: result.error.message },
            );
          })
        }
      >
        {pending ? (
          <LoaderCircleIcon className="animate-spin" aria-hidden />
        ) : (
          <MailIcon aria-hidden />
        )}
        Email me an unlock link
      </Button>
      {said && <FormAlert tone={said.tone}>{said.text}</FormAlert>}
    </div>
  );
}

/** The emailed link: one press unlocks, once. */
export function UnlockWithLink({ token }: { token: string }) {
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<Said>();
  return (
    <div className="mt-6 grid gap-3 rounded-md border p-4">
      <p className="text-sm font-medium">Unlock your sign-in</p>
      <p className="text-sm text-muted-foreground">
        Wrong passwords stop sign-in to this account from that place for 15 minutes. This link ends
        the wait. It does not change your password.
      </p>
      {said?.tone !== "success" && (
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await unlockWithLinkAction({ token });
              setSaid(
                result.ok
                  ? { tone: "success", text: result.data }
                  : { tone: "error", text: result.error.message },
              );
            })
          }
        >
          {pending ? (
            <LoaderCircleIcon className="animate-spin" aria-hidden />
          ) : (
            <UnlockIcon aria-hidden />
          )}
          Unlock my sign-in
        </Button>
      )}
      {said && <FormAlert tone={said.tone}>{said.text}</FormAlert>}
    </div>
  );
}
