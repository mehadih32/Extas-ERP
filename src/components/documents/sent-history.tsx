"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Panel } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import type { SentHistory } from "@/modules/documents/send.service";
import { stopDocumentLinkAction } from "@/server/actions/documents.actions";

const CHANNEL_LABELS = { EMAIL: "Email", WHATSAPP: "WhatsApp", SHARE: "Phone share" } as const;

const LINK_LABELS = {
  ACTIVE: "Link works",
  EXPIRED: "Link expired",
  STOPPED: "Link stopped",
} as const;

/**
 * "Sent": every time this document (or anything to this buyer) was sent, newest
 * first: how, to whom, by whom and when; a WhatsApp link's state with "Stop
 * link" while it works.
 */
export function SentHistoryPanel({
  history,
  showTitle = false,
  id = "sent-heading",
}: {
  history: SentHistory;
  /** Show which document each send was (on a buyer's page). */
  showTitle?: boolean;
  id?: string;
}) {
  return (
    <Panel title="Sent" id={id}>
      {history.items.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Not sent to the buyer yet.</p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 divide-y">
          {history.items.map((item) => (
            <li key={item.id} className="grid min-w-0 gap-1 py-3 text-sm first:pt-0 last:pb-0">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{CHANNEL_LABELS[item.channel]}</span>
                {item.status === "FAILED" && <span className="text-destructive">Not sent</span>}
                {showTitle && <span className="min-w-0 break-words">{item.title}</span>}
              </p>
              <p className="text-[0.8125rem] break-words text-muted-foreground">
                {[item.recipients, item.sentBy && `by ${item.sentBy}`, item.sentText]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {item.error && <p className="text-[0.8125rem] text-destructive">{item.error}</p>}
              {item.link && (
                <LinkState link={item.link} canStop={history.canStop} title={item.title} />
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function LinkState({
  link,
  canStop,
  title,
}: {
  link: NonNullable<SentHistory["items"][number]["link"]>;
  canStop: boolean;
  title: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem]">
      <span>
        {LINK_LABELS[link.state]}
        {link.state === "ACTIVE" && ` until ${link.expiresText}`}
        {link.openCount > 0 && ` · opened ${link.openCount} times`}
      </span>
      {canStop && link.state === "ACTIVE" && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          aria-label={`Stop link to ${title}`}
          onClick={() =>
            startTransition(async () => {
              const result = await stopDocumentLinkAction(link.id);
              if (!result.ok) setError(result.error.message);
              else router.refresh();
            })
          }
        >
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          Stop link
        </Button>
      )}
      {error && <span className="text-destructive">{error}</span>}
    </div>
  );
}
