import { ChevronDownIcon, ChevronUpIcon, FileTextIcon } from "lucide-react";
import Link from "next/link";

import { formatCount, formatDay, groupAmount } from "@/lib/display";
import { cn } from "@/lib/utils";

/*
 * The pieces a 360° profile is made of (Customer 360° and Supplier 360°): the
 * figures at a glance, history panels with "Show all", their rows, and the
 * printed documents.
 */

export const isZero = (fixed: string) => !/[1-9]/.test(fixed);

/** "BDT 12,500.00", with a minus for a loss. */
export function amount(fixed: string, currency: string): string {
  const negative = fixed.startsWith("-") && !isZero(fixed);
  return `${negative ? "-" : ""}${currency} ${groupAmount(fixed.replace(/^-/, ""), currency)}`;
}

export const plural = (value: number, word: string, currency: string) =>
  `${formatCount(value, currency)} ${word}${value === 1 ? "" : "s"}`;

export const linkClass =
  "rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/25";

export function Figure({
  label,
  value,
  note,
  tone = "plain",
}: {
  label: string;
  value: string;
  note: string;
  tone?: "plain" | "warn" | "good";
}) {
  return (
    <article aria-label={label} className="flex min-w-0 flex-col rounded-lg border bg-card p-5">
      <h3 className="eyebrow">{label}</h3>
      <p
        className={cn(
          "mt-3 font-serif text-[1.625rem] leading-tight break-words lining-nums tabular-nums",
          tone === "warn" ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </p>
      <p className="mt-2 text-[0.8125rem] text-muted-foreground">{note}</p>
    </article>
  );
}

export function Panel({
  title,
  id,
  count,
  children,
  footer,
  className,
}: {
  title: string;
  id: string;
  count?: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn("flex min-w-0 flex-col rounded-lg border bg-card p-5 sm:p-6", className)}
    >
      <h3 id={id} className="scroll-mt-24 font-serif text-xl text-primary">
        {title}
        {count !== undefined && (
          <span className="ml-2 font-sans text-sm font-normal text-muted-foreground tabular-nums">
            {count}
          </span>
        )}
      </h3>
      {children}
      {footer}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm text-muted-foreground">{children}</p>;
}

/** "Show all 37" / "Show fewer", kept in the address so the page reloads with it. */
export function ShowAll<H extends string>({
  history,
  shown,
  total,
  open,
  heading,
  basePath,
}: {
  history: H;
  shown: number;
  total: number;
  open: H | undefined;
  heading: string;
  /** The profile's address. */
  basePath: string;
}) {
  if (open === history) {
    return (
      <p className="mt-4 border-t pt-3 text-sm">
        <Link
          href={`${basePath}#${heading}`}
          className={cn(linkClass, "inline-flex items-center gap-1")}
        >
          <ChevronUpIcon className="size-4" aria-hidden />
          Show fewer
        </Link>
        {total > shown && (
          <span className="ml-2 text-muted-foreground">
            (the latest {shown} of {total})
          </span>
        )}
      </p>
    );
  }
  if (total <= shown) return null;
  return (
    <p className="mt-4 border-t pt-3 text-sm">
      <Link
        href={`${basePath}?show=${history}#${heading}`}
        className={cn(linkClass, "inline-flex items-center gap-1")}
      >
        <ChevronDownIcon className="size-4" aria-hidden />
        Show all {total}
      </Link>
    </p>
  );
}

export function Row({
  href,
  title,
  meta,
  badges,
  value,
  sub,
  children,
}: {
  href?: string;
  title: string;
  meta: string;
  badges?: React.ReactNode;
  value?: string;
  sub?: React.ReactNode;
  /** More lines under the meta. */
  children?: React.ReactNode;
}) {
  return (
    <li className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm">
          {href ? (
            <Link href={href} className={linkClass}>
              {title}
            </Link>
          ) : (
            <span className="font-medium">{title}</span>
          )}
        </p>
        <p className="mt-0.5 text-[0.8125rem] break-words text-muted-foreground">{meta}</p>
        {children}
        {badges && <div className="mt-1.5 flex flex-wrap gap-1.5">{badges}</div>}
      </div>
      {(value || sub) && (
        <div className="shrink-0 text-right">
          {value && <p className="text-sm font-medium tabular-nums">{value}</p>}
          {sub && (
            <p className="mt-0.5 text-[0.8125rem] text-muted-foreground tabular-nums">{sub}</p>
          )}
        </div>
      )}
    </li>
  );
}

export function List({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <ul aria-label={label} className="mt-4 grid grid-cols-1 divide-y">
      {children}
    </ul>
  );
}

type PrintedDocument = {
  id: string;
  title: string;
  typeLabel: string;
  madeOn: string;
  madeBy: string | null;
  downloadable: boolean;
};

/** The documents printed for them, each opening its kept PDF. */
export function DocumentsPanel<H extends string>({
  documents,
  history,
  open,
  basePath,
  className,
}: {
  documents: { total: number; items: PrintedDocument[] };
  history: H;
  open: H | undefined;
  basePath: string;
  className?: string;
}) {
  return (
    <Panel
      title="Documents"
      id="documents-heading"
      count={documents.total}
      className={className}
      footer={
        <ShowAll
          history={history}
          shown={documents.items.length}
          total={documents.total}
          open={open}
          basePath={basePath}
          heading="documents-heading"
        />
      }
    >
      {documents.items.length === 0 ? (
        <Empty>No documents printed for them yet.</Empty>
      ) : (
        <List label="Documents">
          {documents.items.map((d) => (
            <li key={d.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <FileTextIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm break-words">
                  {d.downloadable ? (
                    <a
                      href={`/api/documents/${encodeURIComponent(d.id)}/download?inline=1`}
                      target="_blank"
                      rel="noopener"
                      className={linkClass}
                    >
                      {d.title}
                    </a>
                  ) : (
                    d.title
                  )}
                </p>
                <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">
                  {d.typeLabel} · {formatDay(d.madeOn)}
                  {d.madeBy && ` · ${d.madeBy}`}
                </p>
              </div>
            </li>
          ))}
        </List>
      )}
    </Panel>
  );
}
