"use client";

import {
  KeyRoundIcon,
  PencilIcon,
  PowerIcon,
  RefreshCwIcon,
  SendIcon,
  ShieldOffIcon,
  StoreIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { usePinPrompt } from "@/components/ai/pin-prompt";
import { useWhen } from "@/components/ai/when";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { CopyButton } from "@/components/feedback/copy-button";
import { FormAlert } from "@/components/forms/field";
import { StatusBadge } from "@/components/sales/badges";
import { Fact, Panel } from "@/components/sales/detail-bits";
import { BackLink } from "@/components/settings/back-link";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ShopPage } from "@/modules/ecommerce/screens.service";
import {
  generateShopKeyAction,
  revokeShopKeyAction,
  sendShopTestAction,
  setShopActiveAction,
} from "@/server/actions/ecommerce.actions";

import { KeyDialog, type MadeKey } from "./key-dialog";
import { ShopFormDialog } from "./shop-form-dialog";
import { platformLabel, WEBHOOK_FILTER_OPTIONS, webhookState } from "./shop-labels";

/*
 * One online shop (CN-005): its connection and switch, its API key ("Generate
 * key" / "Rotate key" ask the PIN and show the key and secret once; "Revoke
 * key" asks first), what to give the shop, "Send test", the webhook log with a
 * filter by status, and the latest API calls. Tables on a laptop, cards on a
 * phone (390, 768, 1366 and 1920 px).
 */

type Message = { tone: "success" | "error" | "note"; text: string };
type Asking = "rotate" | "revoke" | "off" | "edit" | null;

export function ShopScreen({ page }: { page: ShopPage }) {
  const { shop } = page;
  const router = useRouter();
  const when = useWhen({ year: true });
  const { withPin, dialog: pinDialog } = usePinPrompt();
  const [message, setMessage] = useState<Message>();
  const [asking, setAsking] = useState<Asking>(null);
  const [made, setMade] = useState<MadeKey | null>(null);
  const [pending, startTransition] = useTransition();

  function makeKey() {
    startTransition(async () => {
      const result = await withPin((pin) => generateShopKeyAction(shop.id, { pin }));
      if (result.ok) {
        setMessage(undefined);
        setMade(result.data);
      } else {
        setMessage({ tone: "error", text: result.error.message });
      }
    });
  }

  function switchOn() {
    startTransition(async () => {
      const result = await setShopActiveAction(shop.id, true);
      setMessage(
        result.ok
          ? { tone: "success", text: "The shop is on: its key works again." }
          : { tone: "error", text: result.error.message },
      );
      router.refresh();
    });
  }

  function sendTest() {
    startTransition(async () => {
      const result = await sendShopTestAction(shop.id);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error.message });
        return;
      }
      const test = result.data;
      setMessage(
        test.ok
          ? {
              tone: "success",
              text: test.mock
                ? "The ERP's built-in mock shop checked the test: the signature and the time are right. Enter the shop's webhook URL to test the real shop."
                : `The shop answered ${test.status} in ${test.ms} ms: it can hear the ERP.`,
            }
          : {
              tone: "error",
              text: `The test did not go through: ${test.error ?? "no answer"}`,
            },
      );
      router.refresh();
    });
  }

  return (
    <div className="grid min-w-0 gap-6">
      <BackLink href="/settings/integrations">All online shops</BackLink>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={shop.isActive ? "done" : "closed"}>
            {shop.isActive ? "On" : "Off"}
          </StatusBadge>
          <span className="text-sm text-muted-foreground">{platformLabel(shop.platform)}</span>
        </div>
        <h2 className="mt-3 font-serif text-2xl break-words text-primary">{shop.name}</h2>
      </div>

      {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}

      <Panel
        title="Connection"
        id="shop-connection"
        action={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setAsking("edit")}>
              <PencilIcon aria-hidden />
              Edit
            </Button>
            {shop.isActive ? (
              <Button type="button" variant="outline" onClick={() => setAsking("off")}>
                <PowerIcon aria-hidden />
                Switch off
              </Button>
            ) : (
              <Button type="button" disabled={pending} onClick={switchOn}>
                <PowerIcon aria-hidden />
                Switch on
              </Button>
            )}
          </div>
        }
      >
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Fact label="Company">{page.companyName}</Fact>
          <Fact label="Warehouse">{shop.warehouse?.name ?? "None: choose one with Edit"}</Fact>
          <Fact label="Last sync">{shop.lastSyncedAt ? when(shop.lastSyncedAt) : "Never"}</Fact>
          <Fact label="Shop webhook URL" className="sm:col-span-2 xl:col-span-3">
            <span className="wrap-anywhere">
              {shop.webhookUrl ?? "Not set yet: “Send test” uses the ERP's built-in mock shop."}
            </span>
          </Fact>
          <Fact label="IP allow-list">
            {shop.ipAllowList.length ? (
              <span className="font-mono wrap-anywhere">{shop.ipAllowList.join(", ")}</span>
            ) : (
              "Any address"
            )}
          </Fact>
          <Fact label="Requests a minute">{shop.rateLimitPerMinute}</Fact>
          <Fact label="Waiting webhooks">{page.waiting}</Fact>
        </dl>
      </Panel>

      <Panel
        title="API key"
        id="shop-key"
        action={
          <div className="flex flex-wrap gap-2">
            {shop.hasKey ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setAsking("rotate")}
                >
                  <RefreshCwIcon aria-hidden />
                  Rotate key
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setAsking("revoke")}
                >
                  <ShieldOffIcon aria-hidden />
                  Revoke key
                </Button>
              </>
            ) : (
              <Button type="button" disabled={pending} onClick={makeKey}>
                <KeyRoundIcon aria-hidden />
                Generate key
              </Button>
            )}
          </div>
        }
      >
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Fact label="Key">
            {shop.hasKey ? (
              <span className="font-mono wrap-anywhere">{shop.apiKeyHint}</span>
            ) : shop.apiKeyRevokedAt ? (
              "Revoked: the shop cannot call the ERP"
            ) : (
              "No key yet"
            )}
          </Fact>
          <Fact label="Key made on">
            {shop.hasKey && shop.apiKeyCreatedAt ? when(shop.apiKeyCreatedAt) : "—"}
          </Fact>
          {!shop.hasKey && shop.apiKeyRevokedAt && (
            <Fact label="Revoked on">{when(shop.apiKeyRevokedAt)}</Fact>
          )}
        </dl>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          The key and its webhook secret are shown once, when they are made. The ERP keeps only a
          fingerprint of the key, so it cannot show it again: if it is lost, rotate it.
        </p>
      </Panel>

      <Panel
        title="Give these to the shop"
        id="shop-give"
        action={
          <Button type="button" variant="outline" disabled={pending} onClick={sendTest}>
            <SendIcon aria-hidden />
            Send test
          </Button>
        }
      >
        <div className="mt-4 grid gap-2">
          <p className="eyebrow">ERP API address</p>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/60 py-1.5 pr-1.5 pl-3">
            <span className="min-w-0 font-mono text-sm break-all select-all">
              {page.apiAddress}
            </span>
            <CopyButton text={page.apiAddress} label="Copy address" variant="ghost" />
          </div>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            In the shop&apos;s “Keys & connections” page, enter this address, the API key and the
            webhook secret. “Send test” sends a signed test message to the shop&apos;s webhook URL
            at once (or to the ERP&apos;s built-in mock shop while there is none).
          </p>
        </div>
      </Panel>

      <WebhookLog page={page} />
      <ApiCalls page={page} />

      {asking === "edit" && (
        <ShopFormDialog
          shop={shop}
          companyName={page.companyName}
          warehouses={page.warehouses}
          onClose={() => setAsking(null)}
        />
      )}
      {asking === "off" && (
        <ConfirmDialog
          title="Switch the shop off?"
          description="Its key is refused and nothing is sent to it until you switch it on again. Its orders already in the ERP stay as they are."
          confirmLabel="Switch off"
          pendingLabel="Switching off"
          destructive
          onClose={() => setAsking(null)}
          onConfirm={async () => {
            const result = await setShopActiveAction(shop.id, false);
            if (!result.ok) return result.error;
            setAsking(null);
            setMessage({ tone: "note", text: "The shop is off: its key is refused." });
            router.refresh();
            return undefined;
          }}
        />
      )}
      {asking === "rotate" && (
        <ConfirmDialog
          title="Rotate the key?"
          description="A new key and webhook secret are made, and the old ones stop at once: the shop cannot reach the ERP until the new ones are entered in it. It asks for your PIN."
          confirmLabel="Rotate key"
          pendingLabel="Rotating"
          onClose={() => setAsking(null)}
          onConfirm={async () => {
            setAsking(null);
            makeKey();
            return undefined;
          }}
        />
      )}
      {asking === "revoke" && (
        <ConfirmDialog
          title="Revoke the key?"
          description="The key stops at once: the shop cannot call the ERP and gets no more webhooks. Use “Generate key” later to connect it again."
          confirmLabel="Revoke key"
          pendingLabel="Revoking"
          destructive
          onClose={() => setAsking(null)}
          onConfirm={async () => {
            const result = await revokeShopKeyAction(shop.id);
            if (!result.ok) return result.error;
            setAsking(null);
            setMessage({ tone: "note", text: "The key was revoked." });
            router.refresh();
            return undefined;
          }}
        />
      )}
      {made && (
        <KeyDialog
          made={made}
          shopName={shop.name}
          apiAddress={page.apiAddress}
          onDone={() => {
            setMade(null);
            setMessage({ tone: "success", text: "The new key works now." });
            router.refresh();
          }}
        />
      )}
      {pinDialog}
    </div>
  );
}

/** The webhooks sent to the shop, newest first, with a filter by status. */
function WebhookLog({ page }: { page: ShopPage }) {
  const when = useWhen({ year: true });
  const base = `/settings/integrations/ecommerce/${page.shop.id}`;
  const rows = page.webhooks;

  return (
    <Panel title="Webhook log" id="shop-webhooks">
      <nav aria-label="Webhook status" className="mt-4 flex flex-wrap gap-2">
        {WEBHOOK_FILTER_OPTIONS.map((option) => (
          <Link
            key={option.value}
            href={option.value === "ALL" ? base : `${base}?status=${option.value}`}
            scroll={false}
            aria-current={page.filter === option.value ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25",
              page.filter === option.value
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card hover:border-primary/40",
            )}
          >
            {option.label}
          </Link>
        ))}
      </nav>
      <p className="mt-3 text-sm text-muted-foreground">
        The latest 50. The shop also asks the ERP what changed every few minutes, so a missed
        webhook never leaves its stock wrong.
      </p>
      {rows.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No webhooks here yet.
        </p>
      ) : (
        <>
          <div className="mt-4 hidden md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Time</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Tries</TableHead>
                  <TableHead>Shop&apos;s answer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const state = webhookState(row);
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {when(row.receivedAt)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.eventType}</TableCell>
                      <TableCell className="font-mono text-xs break-all whitespace-normal">
                        {row.externalId ?? "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={state.tone}>{state.text}</StatusBadge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.attempts}</TableCell>
                      <TableCell className="max-w-[24rem] min-w-[12rem] whitespace-normal">
                        <span className="tabular-nums">{row.responseStatus ?? "—"}</span>
                        {row.error && (
                          <span className="block text-xs break-words text-muted-foreground">
                            {row.error}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <ul className="mt-4 grid gap-3 md:hidden" aria-label="Webhook log">
            {rows.map((row) => {
              const state = webhookState(row);
              return (
                <li key={row.id} className="grid gap-2 rounded-lg border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs">{row.eventType}</span>
                    <StatusBadge tone={state.tone}>{state.text}</StatusBadge>
                  </div>
                  {row.externalId && (
                    <p className="font-mono text-sm break-all">{row.externalId}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {when(row.receivedAt)} · Tries: {row.attempts} · Shop&apos;s answer:{" "}
                    {row.responseStatus ?? "—"}
                  </p>
                  {row.error && (
                    <p className="text-xs break-words text-muted-foreground">{row.error}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Panel>
  );
}

/** The shop's latest calls to the API (the call log). */
function ApiCalls({ page }: { page: ShopPage }) {
  const when = useWhen({ year: true });
  const rows = page.calls;

  return (
    <Panel title="Latest API calls" id="shop-calls">
      {rows.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          <StoreIcon className="mx-auto mb-2 size-6" aria-hidden />
          The shop has not called the ERP yet.
        </p>
      ) : (
        <>
          <div className="mt-4 hidden md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Time</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                  <TableHead>Error code</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {when(row.createdAt)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.method}</TableCell>
                    <TableCell className="font-mono text-xs break-all whitespace-normal">
                      {row.path}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        row.status >= 400 && "text-destructive",
                      )}
                    >
                      {row.status}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.errorCode ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="mt-4 grid gap-3 md:hidden" aria-label="Latest API calls">
            {rows.map((row) => (
              <li key={row.id} className="grid gap-1 rounded-lg border bg-card p-4">
                <p className="font-mono text-sm break-all">
                  {row.method} {row.path}
                </p>
                <p className="text-xs text-muted-foreground">
                  {when(row.createdAt)} · Status:{" "}
                  <span className={cn(row.status >= 400 && "text-destructive")}>{row.status}</span>
                  {row.errorCode && ` · ${row.errorCode}`}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
