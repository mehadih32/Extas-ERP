import { Stat } from "@/components/accounts/stat";
import { Panel } from "@/components/sales/detail-bits";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  type ColumnKind,
  formatCell,
  type ReportDocument,
  type ReportTable,
} from "@/modules/reports/document";

const NUMERIC: ReadonlySet<ColumnKind> = new Set(["int", "money", "percent"]);

function ReportTableView({ table, currency }: { table: ReportTable; currency: string }) {
  return (
    <div className="mt-6 grid min-w-0 grid-cols-1 gap-2">
      <h4 className="eyebrow">{table.title}</h4>
      {table.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{table.empty}</p>
      ) : (
        <Table aria-label={table.title}>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {table.columns.map((c, i) => (
                <TableHead
                  key={`${c.label}-${i}`}
                  className={cn(NUMERIC.has(c.kind) && "text-right")}
                >
                  {c.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.rows.map((row, r) => (
              <TableRow
                key={r}
                className={cn(
                  row.style === "heading" && "bg-muted/60 font-medium hover:bg-muted/60",
                  (row.style === "subtotal" || row.style === "total") && "border-t-2 font-medium",
                  row.style === "total" && "text-primary",
                )}
              >
                {row.cells.map((cell, i) => {
                  const column = table.columns[i]!;
                  return (
                    <TableCell
                      key={i}
                      className={cn(
                        NUMERIC.has(column.kind) && "text-right whitespace-nowrap",
                        column.kind === "day" || column.kind === "month"
                          ? "whitespace-nowrap"
                          : null,
                        i === 0 && row.indent && "pl-6",
                      )}
                    >
                      {row.style === "heading" && i > 0 && cell === null
                        ? ""
                        : formatCell(cell, column.kind, currency)}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/**
 * A report on screen, as its PDF and Excel file would show it: each section's
 * headline figures, its tables and its notes.
 */
export function ReportPreview({ doc }: { doc: ReportDocument }) {
  const currency = doc.company.currency;
  return (
    <article aria-label={doc.title} className="grid min-w-0 grid-cols-1 gap-6">
      <header className="min-w-0 rounded-lg border bg-card p-5 sm:p-6">
        <p className="eyebrow">{doc.company.name}</p>
        <h3 className="mt-2 font-serif text-2xl leading-tight break-words text-primary">
          {doc.title}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{doc.period.label}</p>
        <p className="mt-1 text-[0.8125rem] text-muted-foreground">
          As of {doc.generatedOn} ({doc.timezone})
        </p>
      </header>
      {doc.sections.map((section) => (
        <Panel key={section.key} title={section.title} id={`section-${section.key.toLowerCase()}`}>
          <p className="mt-1 text-sm text-muted-foreground">{section.subtitle}</p>
          {section.figures.length > 0 && (
            <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {section.figures.map((f) => (
                <Stat
                  key={f.label}
                  label={f.label}
                  value={
                    f.kind === "money" && f.value !== null
                      ? `${currency} ${formatCell(f.value, f.kind, currency)}`
                      : formatCell(f.value, f.kind, currency)
                  }
                  hint={f.hint}
                />
              ))}
            </dl>
          )}
          {section.tables.map((table) => (
            <ReportTableView key={table.title} table={table} currency={currency} />
          ))}
          {section.notes.length > 0 && (
            <div className="mt-5 grid gap-1.5 border-t pt-4">
              {section.notes.map((note) => (
                <p key={note} className="text-[0.8125rem] text-muted-foreground">
                  {note}
                </p>
              ))}
            </div>
          )}
        </Panel>
      ))}
    </article>
  );
}
