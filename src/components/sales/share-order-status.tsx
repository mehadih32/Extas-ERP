"use client";

import { LinkIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { CopyButton } from "@/components/feedback/copy-button";
import { FormAlert, Field } from "@/components/forms/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDay } from "@/lib/display";
import type { StatusLinkRow } from "@/modules/sales/order-status.service";
import { makeStatusLinkAction, stopStatusLinkAction } from "@/server/actions/order-status.actions";

import { Panel } from "./detail-bits";

const STATE_LABELS: Record<StatusLinkRow["state"], string> = {
  ACTIVE: "Working",
  ENDED: "Ended",
  STOPPED: "Stopped",
};

/**
 * "Share order status" on an order's page (sales.order.share): makes a
 * read-only link to the order's progress for the buyer, shows it once to copy,
 * and lists the order's links with Stop. Nothing is sent from here: the person
 * copies the link and shares it themselves.
 */
export function ShareOrderStatus({
  orderId,
  orderNumber,
  links,
  cancelled,
}: {
  orderId: string;
  orderNumber: string;
  links: StatusLinkRow[];
  /** A cancelled order has no progress to share: no new links. */
  cancelled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState("30");
  const [made, setMade] = useState<{ url: string; endsOn: string | null } | null>(null);
  const [error, setError] = useState<string>();
  const [stopping, setStopping] = useState<StatusLinkRow | null>(null);
  const [pending, startTransition] = useTransition();

  function make() {
    setError(undefined);
    startTransition(async () => {
      const result = await makeStatusLinkAction(orderId, {
        days: days === "never" ? null : Number(days),
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setMade({ url: `${window.location.origin}${result.data.path}`, endsOn: result.data.endsOn });
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Panel
      title="Share order status"
      id="share-status-heading"
      action={
        !open && !cancelled ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            <LinkIcon aria-hidden />
            Share order status
          </Button>
        ) : undefined
      }
    >
      <p className="mt-3 text-[0.8125rem] leading-relaxed text-muted-foreground">
        A read-only page for the buyer: the styles, pieces, cutting, sewing, finishing and packing
        progress and the ship dates. Never prices, costs or suppliers. Nothing is sent: copy the
        link and share it yourself.
      </p>

      {open && (
        <div className="mt-4 grid gap-3 rounded-md border p-4">
          <Field id="status-link-days" label="Link works for">
            <NativeSelect
              id="status-link-days"
              value={days}
              onChange={(event) => setDays(event.target.value)}
              containerClassName="sm:w-full"
            >
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="never">Until I stop it</option>
            </NativeSelect>
          </Field>
          {error && <FormAlert>{error}</FormAlert>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={make} disabled={pending}>
              {pending ? "Making the link…" : "Make the link"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {made && (
        <div className="mt-4 grid gap-2 rounded-md border border-primary/30 bg-primary/5 p-4">
          <p className="text-sm font-medium">New link for {orderNumber}</p>
          <Input
            readOnly
            aria-label="Order status link"
            value={made.url}
            onFocus={(event) => event.currentTarget.select()}
            className="font-mono text-xs"
          />
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={made.url} label="Copy link" />
            <span className="text-[0.8125rem] text-muted-foreground">
              {made.endsOn ? `Works until ${formatDay(made.endsOn)}.` : "Works until you stop it."}
            </span>
          </div>
          <p className="text-[0.8125rem] text-muted-foreground">
            Copy it now: the ERP keeps only a fingerprint of the link, so it cannot show it again.
          </p>
        </div>
      )}

      {links.length > 0 ? (
        <ul className="mt-4 grid grid-cols-1 divide-y">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <span>Made {formatDay(link.madeOn)}</span>
                  <Badge variant={link.state === "ACTIVE" ? "default" : "outline"}>
                    {STATE_LABELS[link.state]}
                  </Badge>
                </p>
                <p className="text-[0.8125rem] break-words text-muted-foreground">
                  {[
                    link.madeBy && `by ${link.madeBy}`,
                    link.state === "STOPPED"
                      ? `stopped ${formatDay(link.stoppedOn!)}${link.stoppedBy ? ` by ${link.stoppedBy}` : ""}`
                      : link.endsOn
                        ? `${link.state === "ENDED" ? "ended" : "ends"} ${formatDay(link.endsOn)}`
                        : "until stopped",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="text-[0.8125rem] text-muted-foreground">
                  {link.lastOpenedOn
                    ? `Last opened ${formatDay(link.lastOpenedOn)}`
                    : "Not opened yet"}
                </p>
              </div>
              {link.state === "ACTIVE" && (
                <Button type="button" variant="outline" size="sm" onClick={() => setStopping(link)}>
                  Stop
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        !made && <p className="mt-4 text-sm text-muted-foreground">No links made yet.</p>
      )}

      {stopping && (
        <ConfirmDialog
          title="Stop this link?"
          description="Whoever has it sees a not found page from now on. A new link can be made any time."
          confirmLabel="Stop the link"
          pendingLabel="Stopping…"
          destructive
          onClose={() => setStopping(null)}
          onConfirm={async () => {
            const result = await stopStatusLinkAction(stopping.id);
            if (!result.ok) return result.error;
            setStopping(null);
            router.refresh();
            return undefined;
          }}
        />
      )}
    </Panel>
  );
}
