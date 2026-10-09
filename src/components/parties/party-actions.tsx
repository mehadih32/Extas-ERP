"use client";

import type { PartyGrade, PartyStatus } from "@prisma/client";
import {
  ArchiveIcon,
  BadgeCheckIcon,
  BadgeXIcon,
  EllipsisVerticalIcon,
  FileTextIcon,
  LandmarkIcon,
  MoonIcon,
  PencilIcon,
  RotateCcwIcon,
  StarIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import type { PartyScreen } from "@/modules/parties/screens.service";
import {
  changePartyStatusAction,
  setPartyGradeAction,
  setPartyVerifiedAction,
} from "@/server/actions/parties.actions";

import { GradeDialog } from "./grade-dialog";
import { balanceText, partyHref } from "./labels";
import { OpeningBalanceDialog } from "./opening-balance-dialog";

type Open = "grade" | "verify" | "unverify" | "opening" | PartyStatus | null;

const STATUS_ACTIONS: Record<
  Exclude<PartyStatus, "SETTLING">,
  { label: string; icon: typeof RotateCcwIcon }
> = {
  ACTIVE: { label: "Reopen the account", icon: RotateCcwIcon },
  DORMANT: { label: "Mark as dormant", icon: MoonIcon },
  CLOSED: { label: "Close the account", icon: ArchiveIcon },
};

/**
 * What can be done with a buyer or supplier, each offered from the flags the
 * screen came with (screen.can): parties.manage edits the details, grades,
 * gives or removes the Blue Verified badge and opens, closes or marks the
 * account dormant (parties/rules.ts); accounts.manage sets the opening balance;
 * parties.ledger.view opens the statement.
 */
export function PartyActions({
  screen,
  currency,
  notice: initialNotice,
}: {
  screen: PartyScreen;
  currency: string;
  /** A message to show first (the account was just added or saved). */
  notice?: string;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState(initialNotice);
  const [reason, setReason] = useState("");
  const { party, can } = screen;
  const close = () => {
    setOpen(null);
    setReason("");
  };
  const statuses = can.statuses.filter(
    (s): s is Exclude<PartyStatus, "SETTLING"> => s !== "SETTLING",
  );
  const hasMenu = can.standing || statuses.length > 0 || can.openingBalance;

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 10_000);
    return () => clearTimeout(timer);
  }, [notice]);

  const reasonField = (
    <Field id="status-reason" label="Reason (optional)" hint="Kept in the activity log.">
      <Textarea
        id="status-reason"
        rows={2}
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-describedby="status-reason-hint"
      />
    </Field>
  );

  async function changeStatus(status: PartyStatus, done: string) {
    const result = await changePartyStatusAction(party.id, {
      status,
      reason: reason.trim() || undefined,
    });
    if (!result.ok) return result.error;
    setNotice(result.data.note ?? done);
    close();
  }

  if (!can.edit && !can.statement && !hasMenu) return null;

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {can.statement && (
          <Button asChild className="w-full sm:w-auto">
            <Link href={partyHref(party, "/statement")}>
              <FileTextIcon aria-hidden />
              Statement
            </Link>
          </Button>
        )}
        {(can.edit || hasMenu) && (
          <div className="flex gap-2">
            {can.edit && (
              <Button asChild variant="outline" className="flex-1 sm:flex-none">
                <Link href={partyHref(party, "/edit")}>
                  <PencilIcon aria-hidden />
                  Edit details
                </Link>
              </Button>
            )}
            {hasMenu && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size={can.edit ? "icon" : "default"}
                    aria-label={`More for ${party.name}`}
                    className={can.edit ? "md:size-10" : "flex-1 sm:flex-none"}
                  >
                    <EllipsisVerticalIcon aria-hidden />
                    {!can.edit && "More"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  {can.standing && (
                    <>
                      <DropdownMenuItem onSelect={() => setOpen("grade")}>
                        <StarIcon aria-hidden />
                        {party.grade ? "Change the grade" : "Give a grade"}
                      </DropdownMenuItem>
                      {party.isVerified ? (
                        <DropdownMenuItem onSelect={() => setOpen("unverify")}>
                          <BadgeXIcon aria-hidden />
                          Remove the Blue Verified badge
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={() => setOpen("verify")}>
                          <BadgeCheckIcon aria-hidden />
                          Give the Blue Verified badge
                        </DropdownMenuItem>
                      )}
                    </>
                  )}
                  {can.openingBalance && (
                    <>
                      {can.standing && <DropdownMenuSeparator />}
                      <DropdownMenuItem onSelect={() => setOpen("opening")}>
                        <LandmarkIcon aria-hidden />
                        Set the opening balance
                      </DropdownMenuItem>
                    </>
                  )}
                  {statuses.length > 0 && (
                    <>
                      {(can.standing || can.openingBalance) && <DropdownMenuSeparator />}
                      {statuses.map((status) => {
                        const { label, icon: Icon } = STATUS_ACTIONS[status];
                        return (
                          <DropdownMenuItem
                            key={status}
                            variant={status === "CLOSED" ? "destructive" : "default"}
                            onSelect={() => setOpen(status)}
                          >
                            <Icon aria-hidden />
                            {status === "ACTIVE" && party.status === "DORMANT"
                              ? "Mark as active"
                              : label}
                          </DropdownMenuItem>
                        );
                      })}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>

      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {open === "grade" && (
        <GradeDialog
          name={party.name}
          grade={party.grade}
          onClose={close}
          onSave={async (grade: PartyGrade | null) => {
            const result = await setPartyGradeAction(party.id, { grade });
            if (!result.ok) return result.error;
            setNotice(grade ? "The grade was saved." : "The grade was removed.");
            close();
          }}
        />
      )}
      {open === "verify" && (
        <ConfirmDialog
          title={`Give ${party.name} the Blue Verified badge?`}
          description="The blue tick shows on the profile and in the lists, marking the account as checked and trusted. You can remove it at any time."
          confirmLabel="Give the badge"
          pendingLabel="Saving"
          errorTitle="We could not give the badge"
          onClose={close}
          onConfirm={async () => {
            const result = await setPartyVerifiedAction(party.id, { isVerified: true });
            if (!result.ok) return result.error;
            setNotice(`${party.name} is now Blue Verified.`);
            close();
          }}
        />
      )}
      {open === "unverify" && (
        <ConfirmDialog
          title={`Remove the Blue Verified badge from ${party.name}?`}
          description="The blue tick no longer shows on the profile or in the lists."
          confirmLabel="Remove the badge"
          pendingLabel="Removing"
          errorTitle="We could not remove the badge"
          onClose={close}
          onConfirm={async () => {
            const result = await setPartyVerifiedAction(party.id, { isVerified: false });
            if (!result.ok) return result.error;
            setNotice("The Blue Verified badge was removed.");
            close();
          }}
        />
      )}
      {open === "opening" && (
        <OpeningBalanceDialog
          party={party}
          current={screen.money.openingBalance}
          currency={currency}
          onClose={close}
          onSaved={(balance) => {
            setNotice(
              `The opening balance was saved. Balance now: ${balanceText(balance, currency)}.`,
            );
            close();
          }}
        />
      )}
      {open === "ACTIVE" && (
        <ConfirmDialog
          title={
            party.status === "DORMANT"
              ? `Mark ${party.name} as active?`
              : `Reopen ${party.name}'s account?`
          }
          description="The account is open for business again: new quotations, orders and purchases can be made with it."
          confirmLabel={party.status === "DORMANT" ? "Mark as active" : "Reopen"}
          pendingLabel="Saving"
          errorTitle="We could not reopen the account"
          onClose={close}
          onConfirm={() => changeStatus("ACTIVE", "The account is open again.")}
        >
          {reasonField}
        </ConfirmDialog>
      )}
      {open === "DORMANT" && (
        <ConfirmDialog
          title={`Mark ${party.name} as dormant?`}
          description="Dormant buyers are the ones to win back. Their next order makes them active again. Each night the ERP also marks buyers dormant after a long time without an order."
          confirmLabel="Mark as dormant"
          pendingLabel="Saving"
          errorTitle="We could not mark the account dormant"
          onClose={close}
          onConfirm={() => changeStatus("DORMANT", `${party.name} is now marked dormant.`)}
        >
          {reasonField}
        </ConfirmDialog>
      )}
      {open === "CLOSED" && (
        <ConfirmDialog
          title={`Close ${party.name}'s account?`}
          description={
            screen.money.position === "SETTLED"
              ? "No new quotations, orders or purchases can be made with it. Its history stays, and you can reopen it at any time."
              : `${balanceText(screen.money.balance, currency)}. Until that is cleared the account is settling: no new business, and it closes by itself once settled.`
          }
          confirmLabel="Close the account"
          pendingLabel="Closing"
          destructive
          errorTitle="We could not close the account"
          onClose={close}
          onConfirm={() => changeStatus("CLOSED", "The account was closed.")}
        >
          {reasonField}
        </ConfirmDialog>
      )}
    </div>
  );
}
