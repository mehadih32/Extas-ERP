"use client";

import { CheckIcon, PencilIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Field } from "@/components/forms/field";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDay } from "@/lib/display";
import type { CostingScreen } from "@/modules/costing/costing.service";
import { decideCostingAction } from "@/server/actions/costing.actions";

import { CostingDialog } from "./costing-dialog";

/** "Change the details" on a costing sheet. */
export function CostingHeaderActions({ screen }: { screen: CostingScreen }) {
  const [open, setOpen] = useState(false);
  if (!screen.can.manage) return null;
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <PencilIcon aria-hidden />
        Change the details
      </Button>
      {open && (
        <CostingDialog
          costing={screen}
          companyCurrency={screen.companyCurrency}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * The owner's decision after reading the card: take the order or decline it,
 * with a note. The system and the AI never decide.
 */
export function DecisionPanel({ screen }: { screen: CostingScreen }) {
  const [deciding, setDeciding] = useState<"TAKE" | "DECLINE" | null>(null);
  const { decision, can } = screen;

  return (
    <Panel title="Your decision" id="costing-decision-heading">
      <p className="mt-2 text-sm">
        {decision === null
          ? "Not decided yet."
          : `${decision === "TAKE" ? "Taken" : "Declined"}${screen.decidedBy ? ` by ${screen.decidedBy}` : ""}${screen.decidedOn ? ` on ${formatDay(screen.decidedOn)}` : ""}.`}
      </p>
      {screen.decisionNote && (
        <p className="mt-1 text-sm break-words text-muted-foreground">{screen.decisionNote}</p>
      )}
      {can.decide ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" onClick={() => setDeciding("TAKE")}>
            <CheckIcon aria-hidden />
            Take the order
          </Button>
          <Button type="button" variant="outline" onClick={() => setDeciding("DECLINE")}>
            <XIcon aria-hidden />
            Decline the order
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-[0.8125rem] text-muted-foreground">
          Taking or declining an order is the owner&apos;s decision.
        </p>
      )}

      {deciding && (
        <FormDialog
          title={deciding === "TAKE" ? "Take the order?" : "Decline the order?"}
          description="Kept on the sheet and in the activity log. Nothing is sent to the buyer."
          submitLabel={deciding === "TAKE" ? "Take the order" : "Decline the order"}
          pendingLabel="Saving"
          destructive={deciding === "DECLINE"}
          errorTitle="We could not save your decision"
          onClose={() => setDeciding(null)}
          onSubmit={async (form) => {
            const result = await decideCostingAction(screen.id, {
              decision: deciding,
              note: form.get("note"),
            });
            if (!result.ok) return result.error;
            setDeciding(null);
          }}
        >
          {(fieldError) => (
            <Field id="decision-note" label="Note" error={fieldError("note")}>
              <Textarea
                id="decision-note"
                name="note"
                rows={3}
                placeholder="e.g. Taken at 7% because the buyer pays on time"
              />
            </Field>
          )}
        </FormDialog>
      )}
    </Panel>
  );
}
