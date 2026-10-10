import { ALLOWED, refuse, type Verdict } from "@/lib/verdict";
import type { PermissionKey } from "@/modules/rbac/permissions";

/*
 * What may be done with a licence or registration record from where it stands,
 * and who may do it. The compliance service refuses with these answers and the
 * Compliance screens read the same answers to decide what to offer:
 *   view    compliance.view (or manage): the records, their scans, the summary
 *   manage  compliance.manage: add, correct, renew, archive, restore, delete, scans
 */

type Can = { can: (permission: PermissionKey) => boolean };

export function complianceKeys(ctx: Can) {
  const manage = ctx.can("compliance.manage");
  return { view: manage || ctx.can("compliance.view"), manage };
}

type RecordState = {
  supersededAt: Date | null;
  archivedAt: Date | null;
  /** The term that renewed this one, if any. */
  renewal: { id: string } | null;
};

/** Only the term in force is renewed; an archived one is restored first. */
export function canRenew(doc: RecordState): Verdict {
  if (doc.supersededAt) {
    return refuse("CONFLICT", "This term was already renewed; renew the newer record.");
  }
  if (doc.archivedAt) return refuse("CONFLICT", "Restore this record before renewing it.");
  return ALLOWED;
}

/** Taking a record off the list is for the term in force; renewed terms are history already. */
export function canArchive(doc: RecordState): Verdict {
  if (doc.archivedAt) return refuse("CONFLICT", "This record is already archived.");
  if (doc.supersededAt) {
    return refuse("CONFLICT", "This term was renewed, so it is already kept as history.");
  }
  return ALLOWED;
}

export function canRestore(doc: RecordState): Verdict {
  if (!doc.archivedAt) return refuse("CONFLICT", "This record is not archived.");
  return ALLOWED;
}

/** A term that was renewed stays while the newer one exists. */
export function canDelete(doc: RecordState): Verdict {
  if (doc.renewal) {
    return refuse("CONFLICT", "This term was renewed; delete the newer record first.");
  }
  return ALLOWED;
}
