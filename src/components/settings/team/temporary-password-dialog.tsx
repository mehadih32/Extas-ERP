"use client";

import { KeyRoundIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { CopyButton } from "@/components/feedback/copy-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ROUTES } from "@/lib/routes";

import { firstName, signInDetails } from "./member-labels";

export type IssuedPassword = {
  reason: "added" | "reset";
  name: string;
  email: string;
  temporaryPassword: string;
};

const noSubscribe = () => () => undefined;

/** This app's sign-in address as the browser sees it ("https://erp.example.com/sign-in"). */
function useSignInAddress(): string {
  return useSyncExternalStore(
    noSubscribe,
    () => `${window.location.origin}${ROUTES.signIn}`,
    () => ROUTES.signIn,
  );
}

/**
 * The one time a temporary password is shown. Nothing is sent from the app yet
 * (messaging comes with the integrations at the end), so the admin copies the
 * sign-in details and hands them over. The window only closes on "Done", so the
 * password is not lost by a stray tap outside it.
 */
export function TemporaryPasswordDialog({
  issued,
  companyName,
  onDone,
}: {
  issued: IssuedPassword;
  companyName: string;
  onDone: () => void;
}) {
  const address = useSignInAddress();
  const first = firstName(issued.name);
  const details = signInDetails({
    name: issued.name,
    email: issued.email,
    temporaryPassword: issued.temporaryPassword,
    signInAddress: address,
    companyName,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <p className="eyebrow text-primary">
            {issued.reason === "added" ? "Added to the team" : "Password reset"}
          </p>
          <DialogTitle>Temporary password for {issued.name}</DialogTitle>
          <DialogDescription>
            {issued.reason === "added"
              ? `${first} signs in with this password and then chooses their own.`
              : `${first} has been signed out on every device. They sign in with this password and then choose their own.`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <p className="eyebrow">Temporary password</p>
          <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/60 py-1.5 pr-1.5 pl-3">
            <span className="flex min-w-0 items-center gap-2">
              <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span
                className="truncate font-mono text-base tracking-wider select-all"
                data-testid="temporary-password"
              >
                {issued.temporaryPassword}
              </span>
            </span>
            <CopyButton text={issued.temporaryPassword} label="Copy" variant="ghost" />
          </div>
          <p className="text-[0.8125rem] text-muted-foreground">
            Sign-in email: <span className="text-foreground">{issued.email}</span>
          </p>
        </div>

        <div className="grid gap-3 rounded-md border border-primary/15 bg-secondary/60 p-4 text-sm leading-relaxed">
          <p>
            This is the only time the password is shown. Send {first} the sign-in details yourself,
            for example by WhatsApp or on paper.
          </p>
          <CopyButton text={details} label="Copy sign-in details" className="w-full sm:w-fit" />
        </div>

        <DialogFooter>
          <Button type="button" onClick={onDone}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
