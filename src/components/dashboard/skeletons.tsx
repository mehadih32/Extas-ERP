import { Skeleton } from "@/components/ui/skeleton";

const SPANS = [
  "lg:col-span-2",
  "lg:col-span-2",
  "lg:col-span-2",
  "lg:col-span-3",
  "sm:col-span-2 lg:col-span-3",
];

export function MetricCardsSkeleton() {
  return (
    <div aria-hidden>
      <Skeleton className="h-7 w-40" />
      <Skeleton className="mt-2 h-4 w-56" />
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        {SPANS.map((span) => (
          <div key={span} className={`rounded-lg border bg-card p-6 ${span}`}>
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mt-5 h-8 w-44" />
            <Skeleton className="mt-6 h-3 w-full" />
            <Skeleton className="mt-3 h-3 w-4/5" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function InsightsSkeleton() {
  return (
    <div aria-hidden>
      <Skeleton className="h-7 w-32" />
      {/* Like the tabs: two by two on phones, one underlined row from tablets up. */}
      <div className="mt-6 grid grid-cols-2 gap-2 sm:flex sm:gap-6 sm:border-b sm:pb-3">
        {[6, 7, 6, 5].map((rem, i) => (
          <Skeleton
            key={i}
            className="h-11 w-full sm:h-4 sm:w-(--tab-width)"
            style={{ "--tab-width": `${rem}rem` } as React.CSSProperties}
          />
        ))}
      </div>
      <div className="mt-5 grid gap-3">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
