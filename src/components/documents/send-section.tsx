import { SendDocumentButtons, type SendTo } from "@/components/documents/send-buttons";
import { SentHistoryPanel } from "@/components/documents/sent-history";
import { cn } from "@/lib/utils";
import type { CompanyContext } from "@/modules/auth/context";
import type { PrintRequest } from "@/modules/documents/schemas";
import { maySendType, type SendableType } from "@/modules/documents/send.service";
import { listDocumentSendsAction } from "@/server/actions/documents.actions";

/**
 * The send buttons of a document that goes to a buyer, for the people who may
 * send it (documents.send and seeing it); nothing for anyone else.
 */
export async function SendBar({
  ctx,
  request,
  what,
  partyId,
  className,
}: {
  ctx: Pick<CompanyContext, "can" | "company" | "db">;
  request: PrintRequest;
  what: string;
  /** The buyer it goes to: their email and phone fill the forms (both can be changed). */
  partyId?: string | null;
  className?: string;
}) {
  if (!maySendType(ctx, request.type)) return null;
  const party = partyId
    ? await ctx.db.party.findUnique({
        where: { id: partyId },
        select: { name: true, contactPerson: true, email: true, phone: true, whatsapp: true },
      })
    : null;
  const to: SendTo | undefined = party
    ? {
        name: party.contactPerson ?? party.name,
        email: party.email,
        phone: party.whatsapp ?? party.phone,
      }
    : undefined;
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center", className)}>
      <SendDocumentButtons request={request} what={what} companyName={ctx.company.name} to={to} />
    </div>
  );
}

/**
 * "Sent": the sends of a document (by the ids it was printed for) or to a
 * buyer, for the people who see those documents. Nothing when the list cannot
 * be read or was never used by this person's role.
 */
export async function SentSection({
  referenceIds,
  partyId,
  type,
  showTitle,
  hideWhenEmpty = false,
}: {
  referenceIds?: string[];
  partyId?: string;
  type?: SendableType;
  showTitle?: boolean;
  /** On a buyer's page the panel shows only once something was sent. */
  hideWhenEmpty?: boolean;
}) {
  const result = await listDocumentSendsAction({ referenceIds, partyId, type });
  if (!result.ok) return null;
  if (hideWhenEmpty && result.data.items.length === 0) return null;
  return <SentHistoryPanel history={result.data} showTitle={showTitle} />;
}
