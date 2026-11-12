"use client";

import { LoaderCircleIcon, MailIcon, MessageCircleIcon, Share2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDay } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { PrintRequest } from "@/modules/documents/schemas";
import {
  createWhatsAppLinkAction,
  documentSendSetupAction,
  recordShareAction,
  sendDocumentByEmailAction,
} from "@/server/actions/documents.actions";

/** Who the document goes to, as the record knows them (both can be changed before sending). */
export type SendTo = { name?: string | null; email?: string | null; phone?: string | null };

type Props = {
  request: PrintRequest;
  /** What is sent, as people say it: "Quotation QT-2026-00012". */
  what: string;
  /** The company's name, for the subject and the message. */
  companyName: string;
  to?: SendTo;
  className?: string;
};

const greeting = (to?: SendTo) => (to?.name ? `Dear ${to.name},` : "Hello,");

/** The short English message that goes with the document (editable). */
export const defaultMessage = (what: string, companyName: string, to?: SendTo) =>
  `${greeting(to)}\n\nPlease find ${what} from ${companyName}.\n\nThank you,\n${companyName}`;

const noChange = () => () => undefined;

/** Whether this browser can share a PDF file through the phone's own Share sheet. */
function canShareFiles() {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
  try {
    const probe = new File([new Uint8Array([37])], "check.pdf", { type: "application/pdf" });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/**
 * "Send by email" and "Send on WhatsApp" for a document that goes to a buyer,
 * with "Share" on phones that can share files. Nothing goes until the person
 * presses Send; every send is kept in the document's "Sent" list. Shown only
 * to people with documents.send who see the document (the server checks again).
 */
export function SendDocumentButtons({ request, what, companyName, to, className }: Props) {
  const [open, setOpen] = useState<"email" | "whatsapp" | null>(null);
  // Whether the phone can share files does not change while the page is open.
  const share = useSyncExternalStore(noChange, canShareFiles, () => false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={cn("w-full sm:w-auto", className)}
        onClick={() => setOpen("email")}
      >
        <MailIcon aria-hidden />
        Send by email
      </Button>
      <Button
        type="button"
        variant="outline"
        className={cn("w-full sm:w-auto", className)}
        onClick={() => setOpen("whatsapp")}
      >
        <MessageCircleIcon aria-hidden />
        Send on WhatsApp
      </Button>
      {share && <ShareButton request={request} what={what} className={className} />}
      {open === "email" && (
        <EmailDialog
          request={request}
          what={what}
          companyName={companyName}
          to={to}
          onClose={() => setOpen(null)}
        />
      )}
      {open === "whatsapp" && (
        <WhatsAppDialog
          request={request}
          what={what}
          companyName={companyName}
          to={to}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function EmailDialog({
  request,
  what,
  companyName,
  to,
  onClose,
}: Omit<Props, "className"> & { onClose: () => void }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ emailReady: boolean; canSetUpEmail: boolean }>();
  const [sent, setSent] = useState<string[]>();
  useEffect(() => {
    void documentSendSetupAction()
      .then((result) => {
        if (result.ok) setSetup(result.data);
      })
      .catch(() => setSetup({ emailReady: false, canSetUpEmail: false }));
  }, []);

  if (sent) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogHeader>
            <p className="eyebrow text-primary">Sent</p>
            <DialogTitle>{what} was emailed</DialogTitle>
            <DialogDescription>
              To {sent.join(", ")}, with the PDF attached. It is listed under “Sent”.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" onClick={onClose}>
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <FormDialog
      title="Send by email"
      description={`${what} goes as a PDF from the company's mailbox. Check the address and the message first.`}
      submitLabel="Send"
      pendingLabel="Sending"
      errorTitle="We could not send the email"
      onClose={onClose}
      onSubmit={async (form): Promise<ActionError | undefined> => {
        const result = await sendDocumentByEmailAction({
          request,
          to: String(form.get("to") ?? ""),
          subject: String(form.get("subject") ?? ""),
          message: String(form.get("message") ?? ""),
        });
        if (!result.ok) return result.error;
        setSent(result.data.to);
        router.refresh();
        return undefined;
      }}
    >
      {(fieldError) => (
        <>
          {setup && !setup.emailReady && (
            <FormAlert tone="note">
              Email is not set up yet.{" "}
              {setup.canSetUpEmail ? (
                <Link href="/ai/settings#ai-mail-heading" className="font-medium underline">
                  Set up “Email for sending”
                </Link>
              ) : (
                "Ask the owner to add the mailbox in AI Center > Settings."
              )}
            </FormAlert>
          )}
          <Field
            id="send-to"
            label="To"
            hint="Separate several addresses with commas."
            error={fieldError("to")}
          >
            <Input
              id="send-to"
              name="to"
              type="text"
              inputMode="email"
              autoComplete="off"
              defaultValue={to?.email ?? ""}
              required
            />
          </Field>
          <Field id="send-subject" label="Subject" error={fieldError("subject")}>
            <Input
              id="send-subject"
              name="subject"
              defaultValue={`${what} from ${companyName}`}
              maxLength={200}
              required
            />
          </Field>
          <Field id="send-message" label="Message" error={fieldError("message")}>
            <Textarea
              id="send-message"
              name="message"
              rows={6}
              maxLength={4000}
              defaultValue={defaultMessage(what, companyName, to)}
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

function WhatsAppDialog({
  request,
  what,
  companyName,
  to,
  onClose,
}: Omit<Props, "className"> & { onClose: () => void }) {
  const router = useRouter();
  const [made, setMade] = useState<{ url: string; link: string; expiresOn: string }>();

  if (made) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogHeader>
            <p className="eyebrow text-primary">Link ready</p>
            <DialogTitle>Open WhatsApp to send it</DialogTitle>
            <DialogDescription>
              The message with the PDF link is ready. The link works until{" "}
              {formatDay(made.expiresOn)} and can be stopped any time under “Sent”.
            </DialogDescription>
          </DialogHeader>
          <p className="text-[0.8125rem] break-all text-muted-foreground">{made.link}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button asChild>
              <a href={made.url} target="_blank" rel="noopener noreferrer">
                <MessageCircleIcon aria-hidden />
                Open WhatsApp
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <FormDialog
      title="Send on WhatsApp"
      description={`WhatsApp cannot take a file from the ERP, so the message carries a secure link that opens only this PDF of ${what}.`}
      submitLabel="Make the link"
      pendingLabel="Making the link"
      errorTitle="We could not make the WhatsApp link"
      onClose={onClose}
      onSubmit={async (form): Promise<ActionError | undefined> => {
        const message = String(form.get("message") ?? "");
        const result = await createWhatsAppLinkAction({
          request,
          phone: String(form.get("phone") ?? ""),
          message,
        });
        if (!result.ok) return result.error;
        const link = `${window.location.origin}${result.data.path}`;
        const text = `${message.trim()}\n\n${link}`.trim();
        setMade({
          link,
          url: `https://wa.me/${result.data.phone}?text=${encodeURIComponent(text)}`,
          expiresOn: result.data.expiresOn,
        });
        router.refresh();
        return undefined;
      }}
    >
      {(fieldError) => (
        <>
          <Field
            id="send-phone"
            label="WhatsApp number"
            hint="Leave it empty to pick the chat in WhatsApp."
            error={fieldError("phone")}
          >
            <Input
              id="send-phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              defaultValue={to?.phone ?? ""}
            />
          </Field>
          <Field id="send-wa-message" label="Message" error={fieldError("message")}>
            <Textarea
              id="send-wa-message"
              name="message"
              rows={5}
              maxLength={2000}
              defaultValue={defaultMessage(what, companyName, to)}
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

function ShareButton({
  request,
  what,
  className,
}: {
  request: PrintRequest;
  what: string;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  function share() {
    setError(undefined);
    startTransition(async () => {
      const result = await recordShareAction({ request });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      try {
        const response = await fetch(
          `/api/documents/${encodeURIComponent(result.data.documentId)}/download`,
        );
        if (!response.ok) throw new Error("download");
        const blob = await response.blob();
        const file = new File([blob], result.data.fileName, { type: "application/pdf" });
        await navigator.share({ files: [file], title: what });
      } catch (shareError) {
        // Closing the Share sheet is not a problem.
        if ((shareError as Error)?.name !== "AbortError") {
          setError("The PDF could not be shared from this phone. Download it and share it.");
        }
      }
    });
  }
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={cn("w-full sm:w-auto", className)}
        disabled={pending}
        onClick={share}
      >
        {pending ? (
          <LoaderCircleIcon className="animate-spin" aria-hidden />
        ) : (
          <Share2Icon aria-hidden />
        )}
        Share
      </Button>
      {error && (
        <p role="alert" className="text-[0.8125rem] text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
