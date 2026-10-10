import { RowCard, RowLink } from "@/components/sales/load-more";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDay } from "@/lib/display";
import type { ComplianceRow } from "@/modules/compliance/screens.service";

import { ComplianceBadge } from "./badges";
import { COMPLIANCE_TYPE_LABELS, complianceHref, expiryWords } from "./labels";

const late = (r: ComplianceRow) => r.status === "EXPIRED" || r.status === "EXPIRING";
const live = (r: ComplianceRow) => r.status !== "SUPERSEDED" && r.status !== "ARCHIVED";

/**
 * Licences and registrations, soonest expiry first: cards on phones, a table
 * on computers, each opening the record.
 */
export function ComplianceList({ items }: { items: ComplianceRow[] }) {
  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Licences">
        {items.map((r) => (
          <RowCard
            key={r.id}
            href={complianceHref.record(r.id)}
            eyebrow={COMPLIANCE_TYPE_LABELS[r.type]}
            badges={<ComplianceBadge status={r.status} />}
            title={r.title}
            details={[r.number, r.issuingAuthority].filter(Boolean).join(" · ") || undefined}
            footer={
              <>
                <span className={late(r) ? "text-destructive" : "text-muted-foreground"}>
                  {r.expiryDate
                    ? `${live(r) ? expiryWords(r.daysLeft) : "Expired"} · ${formatDay(r.expiryDate)}`
                    : "No expiry"}
                </span>
                {!r.scan && <span className="text-muted-foreground">No scan</span>}
              </>
            }
          />
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Licences">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Licence</TableHead>
              <TableHead>Number</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Scan</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="max-w-80 py-3">
                  <RowLink href={complianceHref.record(r.id)} className="whitespace-normal">
                    {r.title}
                  </RowLink>
                  <div className="mt-0.5 text-[0.8125rem] whitespace-normal text-muted-foreground">
                    {r.title === COMPLIANCE_TYPE_LABELS[r.type]
                      ? (r.issuingAuthority ?? "")
                      : COMPLIANCE_TYPE_LABELS[r.type]}
                  </div>
                </TableCell>
                <TableCell className="tabular-nums">{r.number ?? "Not entered"}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {r.expiryDate ? formatDay(r.expiryDate) : "No expiry"}
                  {r.expiryDate && live(r) && (
                    <span
                      className={
                        late(r)
                          ? "block text-[0.8125rem] text-destructive"
                          : "block text-[0.8125rem] text-muted-foreground"
                      }
                    >
                      {expiryWords(r.daysLeft)}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <ComplianceBadge status={r.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">{r.scan ? "Yes" : "None"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
