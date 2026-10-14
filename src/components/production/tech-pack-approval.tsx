"use client";

import { LockIcon, ShieldCheckIcon } from "lucide-react";
import { useState } from "react";

import { FormAlert } from "@/components/forms/field";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import type { TechPack } from "@/modules/production/tech-pack-approval.service";
import { approveTechPackAction, lockFabricPartAction } from "@/server/actions/production.actions";

/*
 * A style's tech pack approval on its page: draft, its fabric part locked
 * (Fabric first) or approved for production, and what changed in its fabric
 * since, in red, until it is locked or approved again. Locking and approving
 * are the owner's (production.techpack.approve).
 */

export function TechPackApprovalPanel({
  projectId,
  code,
  techPack: t,
}: {
  projectId: string;
  code: string;
  techPack: TechPack;
}) {
  const [asking, setAsking] = useState<"lock" | "approve" | null>(null);
  const [notice, setNotice] = useState<string>();
  const approved = t.status === "APPROVED";
  const state = approved
    ? `Approved for production${t.approvedBy ? ` by ${t.approvedBy}` : ""}.`
    : t.fabricLocked
      ? `Fabric part locked${t.fabricLockedBy ? ` by ${t.fabricLockedBy}` : ""}: its fabric can be booked first. The rest of the tech pack is still a draft.`
      : t.hasFabric
        ? "Draft. Lock the fabric part to book the fabric first, or approve the whole tech pack."
        : "Draft. Add the style's fabric to its materials per piece first.";
  return (
    <Panel title="Tech pack approval" id="tech-pack-approval-heading">
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{state}</p>
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
      {notice && (
        <div className="mt-4">
          <FormAlert tone="success">{notice}</FormAlert>
        </div>
      )}
      {(t.can.lock || t.can.approve) && (
        <div className="mt-5 flex flex-wrap gap-2">
          {t.can.lock && !approved && (
            <Button type="button" size="sm" variant="outline" onClick={() => setAsking("lock")}>
              <LockIcon aria-hidden />
              {t.fabricLocked ? "Lock the fabric part again" : "Lock fabric part"}
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
            const result = await lockFabricPartAction(projectId);
            if (!result.ok) return result.error;
            setNotice(`The fabric part of ${code} is locked.`);
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
            const result = await approveTechPackAction(projectId);
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
