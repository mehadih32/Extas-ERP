"use client";

import { MailIcon, MessageCircleIcon, SendIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { StatusBadge } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { CampaignBuyers } from "@/modules/parties/campaign.service";
import {
  createCampaignAction,
  updateCampaignRecipientAction,
} from "@/server/actions/parties.actions";

/*
 * Buyers & suppliers > Campaigns (Release 5): a message to many buyers, sent
 * by a person one buyer at a time. The ERP fills in each buyer's name and opens
 * the message in WhatsApp or the email app; the person presses send there.
 * Nothing is ever sent by the ERP itself.
 */

export type CampaignRow = {
  id: string;
  name: string;
  channel: string;
  status: string;
  createdAt: Date | string;
  recipients: number;
  sent: number;
  responded: number;
};

const CHANNEL_LABEL: Record<string, string> = { WHATSAPP: "WhatsApp", EMAIL: "Email", SMS: "SMS" };

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Not started",
  SCHEDULED: "Not started",
  SENDING: "In progress",
  SENT: "Finished",
  CANCELLED: "Cancelled",
};

/** The campaigns, newest first, each with how far it got. */
export function CampaignList({ rows }: { rows: CampaignRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="mt-3 text-sm text-muted-foreground">
        No campaigns yet. Press “New campaign” to write one.
      </p>
    );
  }
  return (
    <ul className="mt-3 grid gap-3" aria-label="Campaigns">
      {rows.map((c) => (
        <li key={c.id}>
          <Link
            href={`/parties/campaigns/${c.id}`}
            className="block rounded-lg border bg-card p-4 transition-colors outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/25"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 font-medium break-words text-primary">{c.name}</p>
              <div className="flex shrink-0 flex-wrap gap-1.5">
                <StatusBadge tone="plain">{CHANNEL_LABEL[c.channel] ?? c.channel}</StatusBadge>
                <StatusBadge tone={c.status === "SENT" ? "done" : "open"}>
                  {STATUS_LABEL[c.status] ?? c.status}
                </StatusBadge>
              </div>
            </div>
            <p className="mt-2 text-sm text-muted-foreground tabular-nums">
              {c.sent} of {c.recipients} sent · {c.responded} replied
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

type Show = "all" | "dormant";

/** Writing a campaign: its name, channel and message, then the buyers it goes to. */
export function NewCampaignForm({ picker }: { picker: CampaignBuyers }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<"WHATSAPP" | "EMAIL">("WHATSAPP");
  const [message, setMessage] = useState(
    "Dear {name}, we have new styles ready for the coming season. Shall I send you our latest catalogue?",
  );
  const [show, setShow] = useState<Show>("dormant");
  const [country, setCountry] = useState("");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});

  const reachable = (b: CampaignBuyers["buyers"][number]) =>
    channel === "EMAIL" ? b.email : b.whatsapp;
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return picker.buyers.filter(
      (b) =>
        (show === "all" || b.dormant) &&
        (!country || b.country === country) &&
        (!q ||
          b.name.toLowerCase().includes(q) ||
          b.code.toLowerCase().includes(q) ||
          (b.contactPerson ?? "").toLowerCase().includes(q)),
    );
  }, [picker.buyers, show, country, search]);
  const pickable = shown.filter(reachable);
  const chosen = picker.buyers.filter((b) => picked.has(b.id) && reachable(b));

  const toggle = (id: string, on: boolean) =>
    setPicked((now) => {
      const next = new Set(now);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const save = () =>
    startTransition(async () => {
      setError(undefined);
      setFieldErrors({});
      const result = await createCampaignAction({
        name,
        channel,
        message,
        inactivityMonths: picker.dormantMonths,
        partyIds: chosen.map((b) => b.id),
      });
      if (!result.ok) {
        setError(result.error.message);
        setFieldErrors((result.error as { details?: Record<string, string[]> }).details ?? {});
        return;
      }
      router.push(`/parties/campaigns/${result.data.campaign.id}`);
    });

  return (
    <div className="grid gap-6">
      <Panel title="The message" id="campaign-message-heading">
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field id="campaign-name" label="Campaign name" error={fieldErrors.name?.[0]}>
            <Input
              id="campaign-name"
              value={name}
              maxLength={120}
              placeholder="Winter 2027 catalogue"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field id="campaign-channel" label="Send by">
            <NativeSelect
              id="campaign-channel"
              containerClassName="sm:w-full"
              value={channel}
              onChange={(e) => setChannel(e.target.value as "WHATSAPP" | "EMAIL")}
            >
              <option value="WHATSAPP">WhatsApp</option>
              <option value="EMAIL">Email</option>
            </NativeSelect>
          </Field>
          <Field
            id="campaign-text"
            label="Message"
            className="md:col-span-2"
            hint="{name} becomes each buyer's name."
            error={fieldErrors.message?.[0]}
          >
            <Textarea
              id="campaign-text"
              rows={5}
              maxLength={2000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </Field>
        </div>
      </Panel>

      <Panel
        title="Buyers"
        id="campaign-buyers-heading"
        action={
          <span className="text-sm text-muted-foreground tabular-nums">{chosen.length} picked</span>
        }
      >
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Field id="campaign-show" label="Show">
            <NativeSelect
              id="campaign-show"
              containerClassName="sm:w-full"
              value={show}
              onChange={(e) => setShow(e.target.value as Show)}
            >
              <option value="dormant">Dormant buyers</option>
              <option value="all">All buyers</option>
            </NativeSelect>
          </Field>
          <Field id="campaign-country" label="Country">
            <NativeSelect
              id="campaign-country"
              containerClassName="sm:w-full"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            >
              <option value="">Every country</option>
              {picker.countries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="campaign-search" label="Search">
            <Input
              id="campaign-search"
              value={search}
              placeholder="Name or code"
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pickable.length === 0}
            onClick={() => pickable.forEach((b) => toggle(b.id, true))}
          >
            Pick all shown
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={picked.size === 0}
            onClick={() => setPicked(new Set())}
          >
            Clear
          </Button>
        </div>
        {shown.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No buyers match.</p>
        ) : (
          <ul className="mt-4 grid gap-2" aria-label="Buyers to pick">
            {shown.map((b) => {
              const ok = reachable(b);
              return (
                <li key={b.id} className="flex items-start gap-3 rounded-md border p-3">
                  <Checkbox
                    id={`pick-${b.id}`}
                    className="mt-0.5"
                    checked={ok && picked.has(b.id)}
                    disabled={!ok}
                    onCheckedChange={(on) => toggle(b.id, on === true)}
                  />
                  <label htmlFor={`pick-${b.id}`} className="grid min-w-0 gap-0.5 text-sm">
                    <span className="font-medium break-words">{b.name}</span>
                    <span className="text-[0.8125rem] break-words text-muted-foreground">
                      {[b.code, b.country, b.dormant ? "Dormant" : null]
                        .filter(Boolean)
                        .join(" · ")}
                      {!ok &&
                        (channel === "EMAIL" ? " · No email address" : " · No WhatsApp number")}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {error && <FormAlert tone="error">{error}</FormAlert>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending || chosen.length === 0} onClick={save}>
          <SendIcon aria-hidden />
          Make the list
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/parties/campaigns">Cancel</Link>
        </Button>
      </div>
    </div>
  );
}

export type CampaignRecipientRow = {
  id: string;
  status: string;
  respondedAt: Date | string | null;
  message: string;
  link: string | null;
  party: { id: string; code: string; name: string; contactPerson: string | null };
};

const isSent = (status: string) => status !== "PENDING" && status !== "FAILED";

/**
 * One campaign: each buyer with a button that opens the filled-in message for
 * the person to send, and ticks for "Sent" and "Replied".
 */
export function CampaignRecipients({
  campaignId,
  channel,
  open,
  rows: initial,
}: {
  campaignId: string;
  channel: string;
  /** False once the campaign is cancelled: nothing changes any more. */
  open: boolean;
  rows: CampaignRecipientRow[];
}) {
  const [rows, setRows] = useState(initial);
  const [error, setError] = useState<string>();
  const [, startTransition] = useTransition();
  const email = channel === "EMAIL";

  const save = (id: string, input: { status?: string; responded?: boolean }) => {
    const row = rows.find((r) => r.id === id)!;
    const status = input.status ?? (isSent(row.status) ? row.status : "SENT");
    setRows((all) =>
      all.map((r) =>
        r.id === id
          ? {
              ...r,
              status,
              respondedAt:
                input.responded === undefined
                  ? r.respondedAt
                  : input.responded
                    ? new Date().toISOString()
                    : null,
            }
          : r,
      ),
    );
    startTransition(async () => {
      const result = await updateCampaignRecipientAction(campaignId, id, {
        status,
        ...(input.responded !== undefined ? { responded: input.responded } : {}),
      });
      if (!result.ok) setError(result.error.message);
    });
  };

  const sent = rows.filter((r) => isSent(r.status)).length;
  const replied = rows.filter((r) => r.respondedAt).length;

  return (
    <div className="grid gap-6">
      <dl className="grid grid-cols-3 gap-3">
        {[
          ["Buyers", rows.length],
          ["Sent", sent],
          ["Replied", replied],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border bg-card p-4">
            <dt className="eyebrow">{label}</dt>
            <dd className="mt-1 font-serif text-2xl text-primary tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      <ul className="grid gap-3" aria-label="Buyers in this campaign">
        {rows.map((r) => (
          <li key={r.id} className="grid gap-3 rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium break-words text-primary">{r.party.name}</p>
                <p className="text-[0.8125rem] break-words text-muted-foreground">
                  {[r.party.code, r.party.contactPerson].filter(Boolean).join(" · ")}
                </p>
              </div>
              {r.link && open ? (
                <Button type="button" size="sm" asChild>
                  <a
                    href={r.link}
                    target={email ? undefined : "_blank"}
                    rel="noreferrer"
                    onClick={() => {
                      if (!isSent(r.status)) save(r.id, { status: "SENT" });
                    }}
                  >
                    {email ? <MailIcon aria-hidden /> : <MessageCircleIcon aria-hidden />}
                    {email ? "Open email" : "Open WhatsApp"}
                  </a>
                </Button>
              ) : null}
            </div>
            <p className="rounded-md bg-secondary p-3 text-sm break-words whitespace-pre-wrap">
              {r.message}
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`sent-${r.id}`}
                  checked={isSent(r.status)}
                  disabled={!open}
                  onCheckedChange={(on) => save(r.id, { status: on === true ? "SENT" : "PENDING" })}
                />
                <label htmlFor={`sent-${r.id}`}>Sent</label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`replied-${r.id}`}
                  checked={Boolean(r.respondedAt)}
                  disabled={!open}
                  onCheckedChange={(on) => save(r.id, { responded: on === true })}
                />
                <label htmlFor={`replied-${r.id}`}>Replied</label>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
