"use client";

import { ClipboardListIcon, LockIcon, ScissorsIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { FormAlert } from "@/components/forms/field";
import { productionHref } from "@/components/production/labels";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/display";
import type { TechPack } from "@/modules/production/tech-pack-approval.service";
import {
  approveTechPackAction,
  approveTrimsPartAction,
  lockFabricPartAction,
} from "@/server/actions/production.actions";
import {
  approveTechPackOfAction,
  approveTrimsPartOfAction,
  lockFabricPartOfAction,
} from "@/server/actions/tech-pack.actions";

/*
 * A style's tech pack approval on its page: draft, its fabric part locked
 * (Fabric first) or approved for production, and what changed in its fabric
 * since, in red, until it is locked or approved again, and the red cells of
 * the tech pack that keep it from approval. Once approved, a change to its
 * trims, collar or cuff shows what changed, who changed it and when, and waits
 * for "Approve the trims again" (v6.4.2): until then the style's trims bookings
 * wait; its fabric bookings do not. Locking and approving are the owner's
 * (production.techpack.approve). A tech pack not linked to a style in
 * production yet waits for one: its fabric part comes from there.
 */

export function TechPackApprovalPanel({
  projectId,
  code,
  techPack: t,
  onTechPack = false,
}: {
  /** The style in production (null on a tech pack not linked to one yet). */
  projectId: string | null;
  code: string;
  techPack: TechPack;
  /** On the tech pack page itself: no "Open the tech pack" button. */
  onTechPack?: boolean;
}) {
  const [asking, setAsking] = useState<"lock" | "approve" | "trims" | null>(null);
  const [notice, setNotice] = useState<string>();
  const approved = t.status === "APPROVED";
  // On the tech pack's page it is approved by the tech pack, else by the style.
  const byTechPack = onTechPack && t.techPackId ? t.techPackId : null;
  const lock = () =>
    byTechPack ? lockFabricPartOfAction(byTechPack) : lockFabricPartAction(projectId ?? "");
  const approve = () =>
    byTechPack ? approveTechPackOfAction(byTechPack) : approveTechPackAction(projectId ?? "");
  const approveTrims = () =>
    byTechPack ? approveTrimsPartOfAction(byTechPack) : approveTrimsPartAction(projectId ?? "");
  const trimsWait = approved && t.trimsChanges.length > 0;
  const state = t.needsProject
    ? "Draft. Link it to a production project to lock its fabric part or approve it: its fabric and pieces come from the project."
    : approved
      ? `Approved for production${t.approvedBy ? ` by ${t.approvedBy}` : ""}.${
          trimsWait ? " Its trims changed since: they wait to be approved again." : ""
        }`
      : t.fabricLocked
        ? `Fabric part locked${t.fabricLockedBy ? ` by ${t.fabricLockedBy}` : ""}: its fabric can be booked first. The rest of the tech pack is still a draft.`
        : t.hasFabric
          ? "Draft. Lock the fabric part to book the fabric first, or approve the whole tech pack."
          : "Draft. Add the style's fabric to its materials per piece first.";
  return (
    <Panel title="Tech pack approval" id="tech-pack-approval-heading">
      {t.number && !onTechPack && <p className="eyebrow mt-2">{t.number}</p>}
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{state}</p>
      {!onTechPack && projectId && (
        <p className="mt-3">
          <Button asChild size="sm" variant="outline">
            <Link
              href={
                t.techPackId
                  ? productionHref.techPackOf(t.techPackId)
                  : productionHref.techPackPage(projectId)
              }
            >
              <ClipboardListIcon aria-hidden />
              {t.techPackId ? "Open the tech pack" : "Start or link a tech pack"}
            </Link>
          </Button>
        </p>
      )}
      {t.gaps.length > 0 && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive">Red cells keep it from approval</p>
          <ul className="mt-2 grid gap-1 text-[0.8125rem]">
            {t.gaps.map((g) => (
              <li key={g} className="break-words">
                {g}
              </li>
            ))}
          </ul>
        </div>
      )}
      {t.changes.length > 0 && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive">
            The fabric changed since it was {approved ? "approved" : "locked"}
          </p>
          <ul className="mt-2 grid gap-1 text-[0.8125rem]">
            {t.changes.map((c) => (
              <li key={`${c.item}|${c.was}|${c.now}`} className="break-words">
                {c.item}: <span className="text-muted-foreground line-through">{c.was}</span>{" "}
                <span aria-hidden>→</span>
                <span className="sr-only">now</span>{" "}
                <span className="text-destructive">{c.now}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[0.8125rem] text-muted-foreground">
            Bookings already approved on the old fabric show the change too.
          </p>
        </div>
      )}
      {trimsWait && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive">
            The trims changed since they were approved
          </p>
          <ul className="mt-2 grid gap-1 text-[0.8125rem]" aria-label="What changed in the trims">
            {t.trimsChanges.map((c) => (
              <li key={`${c.item}|${c.was}|${c.now}`} className="break-words">
                {c.item}: <span className="text-muted-foreground line-through">{c.was}</span>{" "}
                <span aria-hidden>→</span>
                <span className="sr-only">now</span>{" "}
                <span className="text-destructive">{c.now}</span>
              </li>
            ))}
          </ul>
          {t.trimsLog.length > 0 && (
            <ul
              className="mt-3 grid gap-1 text-[0.75rem] text-muted-foreground"
              aria-label="Who changed them"
            >
              {t.trimsLog.map((entry) => (
                <li key={`${String(entry.at)}|${entry.by ?? ""}`} className="break-words">
                  Changed by {entry.by ?? "someone no longer here"} on {formatDay(entry.day)}:{" "}
                  {entry.changes.map((c) => c.item).join(", ")}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[0.8125rem] text-muted-foreground">
            Trims, collar and cuff bookings for {code} wait until someone who approves tech packs
            approves the trims again. Fabric bookings go on as before.
          </p>
        </div>
      )}
      {notice && (
        <div className="mt-4">
          <FormAlert tone="success">{notice}</FormAlert>
        </div>
      )}
      {(t.can.lock || t.can.approve || t.can.approveTrims) && (
        <div className="mt-5 flex flex-wrap gap-2">
          {t.can.lock && !approved && (
            <Button type="button" size="sm" variant="outline" onClick={() => setAsking("lock")}>
              <LockIcon aria-hidden />
              {t.fabricLocked ? "Lock the fabric part again" : "Lock fabric part"}
            </Button>
          )}
          {t.can.approveTrims && (
            <Button type="button" size="sm" onClick={() => setAsking("trims")}>
              <ScissorsIcon aria-hidden />
              Approve the trims again
            </Button>
          )}
          {t.can.approve && (
            <Button type="button" size="sm" onClick={() => setAsking("approve")}>
              <ShieldCheckIcon aria-hidden />
              {approved ? "Approve again" : "Approve tech pack"}
            </Button>
          )}
        </div>
      )}
      {asking === "lock" && (
        <FormDialog
          title={`Lock the fabric part of ${code}?`}
          description="Its fabrics, their use per piece and the pieces per colour and size are kept as they are now, so its fabric can be booked first (Fabric first). The style can still change; a change shows in red."
          submitLabel="Lock fabric part"
          pendingLabel="Locking"
          errorTitle="We could not lock the fabric part"
          onClose={() => setAsking(null)}
          onSubmit={async () => {
            const result = await lock();
            if (!result.ok) return result.error;
            setNotice(`The fabric part of ${code} is locked.`);
            setAsking(null);
          }}
        >
          {() => null}
        </FormDialog>
      )}
      {asking === "trims" && (
        <FormDialog
          title={`Approve the trims of ${code} again?`}
          description="Its trims, collar and cuff are approved as they are now, so their bookings can be approved. The fabric part is not touched."
          submitLabel="Approve the trims again"
          pendingLabel="Approving"
          errorTitle="We could not approve the trims"
          onClose={() => setAsking(null)}
          onSubmit={async () => {
            const result = await approveTrims();
            if (!result.ok) return result.error;
            setNotice(`The trims of ${code} are approved again.`);
            setAsking(null);
          }}
        >
          {() => null}
        </FormDialog>
      )}
      {asking === "approve" && (
        <FormDialog
          title={`Approve the tech pack of ${code}?`}
          description="The style is approved for production as it is now, its fabric part with it, and its trims can be booked. The style can still change; a change shows in red."
          submitLabel="Approve tech pack"
          pendingLabel="Approving"
          errorTitle="We could not approve the tech pack"
          onClose={() => setAsking(null)}
          onSubmit={async () => {
            const result = await approve();
            if (!result.ok) return result.error;
            setNotice(`The tech pack of ${code} is approved for production.`);
            setAsking(null);
          }}
        >
          {() => null}
        </FormDialog>
      )}
    </Panel>
  );
}
