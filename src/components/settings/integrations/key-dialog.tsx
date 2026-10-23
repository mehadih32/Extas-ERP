"use client";

import { KeyRoundIcon, TriangleAlertIcon } from "lucide-react";

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

export type MadeKey = { apiKey: string; webhookSecret: string; hint: string };

/** One secret on its own line, with its copy button. */
function Secret({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="grid gap-2">
      <p className="eyebrow">{label}</p>
      <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/60 py-1.5 pr-1.5 pl-3">
        <span className="flex min-w-0 items-center gap-2">
          <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 font-mono text-sm break-all select-all" data-testid={testId}>
            {value}
          </span>
        </span>
        <CopyButton text={value} label="Copy" variant="ghost" />
      </div>
    </div>
  );
}

/**
 * The one time a shop's API key and webhook secret are shown (CN-005): only
 * the key's hash is kept, so nobody can show it again. The window closes only
 * on "Done", so they are not lost by a stray tap outside it.
 */
export function KeyDialog({
  made,
  shopName,
  apiAddress,
  onDone,
}: {
  made: MadeKey;
  shopName: string;
  apiAddress: string;
  onDone: () => void;
}) {
  const all = [
    `ERP API address: ${apiAddress}`,
    `API key: ${made.apiKey}`,
    `Webhook secret: ${made.webhookSecret}`,
  ].join("\n");

  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <DialogHeader>
          <p className="eyebrow text-primary">Shown once</p>
          <DialogTitle>The key of {shopName}</DialogTitle>
          <DialogDescription>
            Enter these in the shop&apos;s “Keys & connections” page. The shop sends the key with
            every request and signs with the webhook secret.
          </DialogDescription>
        </DialogHeader>

        <Secret label="API key" value={made.apiKey} testId="shop-api-key" />
        <Secret label="Webhook secret" value={made.webhookSecret} testId="shop-webhook-secret" />

        <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm leading-relaxed">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <p>
            This is the only time they are shown: the ERP keeps only a fingerprint of the key. Copy
            both now and keep them somewhere safe. If they are lost, use “Rotate key” for new ones.
          </p>
        </div>
        <CopyButton text={all} label="Copy all three" className="w-full sm:w-fit" />

        <DialogFooter>
          <Button type="button" onClick={onDone}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
