"use client";

import { MessageSquarePlusIcon } from "lucide-react";
import { useState } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { tellAiAction } from "@/server/actions/orders.actions";

/*
 * Tell AI (My HR and Production): staff tell Mehedi 2.0 what happened on an
 * order, in Bengali or English ("fabric arrived", "cutting started", a
 * problem). It goes in the owner's evening report; a problem reaches the
 * owner at once.
 */

export function TellAiButton({
  orders,
  className,
}: {
  orders: Array<{ id: string; number: string; title: string }>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<string>();

  return (
    <div className={className}>
      <Button
        type="button"
        variant="outline"
        className="w-full sm:w-auto"
        onClick={() => setOpen(true)}
      >
        <MessageSquarePlusIcon aria-hidden />
        Tell AI
      </Button>
      {sent && (
        <div className="mt-3">
          <FormAlert tone="success">{sent}</FormAlert>
        </div>
      )}
      {open && (
        <FormDialog
          title="Tell the AI what happened"
          description="Fabric arrived, cutting started, a problem: Bengali or English. A problem reaches the owner at once."
          submitLabel="Send"
          pendingLabel="Sending"
          errorTitle="We could not send it"
          onClose={() => setOpen(false)}
          onSubmit={async (form) => {
            const result = await tellAiAction({
              text: String(form.get("text") ?? ""),
              runId: String(form.get("runId") ?? ""),
            });
            if (!result.ok) return result.error;
            setSent(
              result.data.problem
                ? "Sent. It reads as a problem, so the owner has it now."
                : "Sent. It goes in the owner's evening report.",
            );
            setOpen(false);
          }}
        >
          {(fieldError) => (
            <div className="grid gap-4">
              <Field id="tell-order" label="About order" error={fieldError("runId")}>
                <NativeSelect
                  id="tell-order"
                  name="runId"
                  defaultValue=""
                  containerClassName="sm:w-full"
                >
                  <option value="">No order in particular</option>
                  {orders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {`${o.number} ${o.title}`}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="tell-text" label="What happened" error={fieldError("text")}>
                <Textarea id="tell-text" name="text" rows={3} maxLength={1000} required />
              </Field>
            </div>
          )}
        </FormDialog>
      )}
    </div>
  );
}
