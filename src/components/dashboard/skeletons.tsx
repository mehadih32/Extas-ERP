import { Skeleton } from "@/components/ui/skeleton";

/** One per metric card: three across on wide screens, twice. */
const CARDS = [1, 2, 3, 4, 5, 6];

export function MetricCardsSkeleton() {
  return (
    <div aria-hidden>
      <Skeleton className="h-7 w-40" />
      <Skeleton className="mt-2 h-4 w-56" />
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        {CARDS.map((card) => (
          <div key={card} className="rounded-lg border bg-card p-6 lg:col-span-2">
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

export function SalesTargetSkeleton() {
  return (
    <div aria-hidden className="rounded-lg border bg-card p-6">
      <Skeleton className="h-3 w-40" />
      <Skeleton className="mt-2 h-3 w-24" />
      <Skeleton className="mt-5 h-8 w-32" />
      <Skeleton className="mt-4 h-3 w-full rounded-full" />
      <Skeleton className="mt-4 h-3 w-64" />
    </div>
  );
}

export function PulseSkeleton() {
  return (
    <div aria-hidden>
      <Skeleton className="h-7 w-36" />
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((card) => (
          <div key={card} className="rounded-lg border bg-card p-5">
            <Skeleton className="h-3 w-32" />
            <div className="mt-5 grid grid-cols-2 gap-4">
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-7 w-24" />
            </div>
            <Skeleton className="mt-3 h-3 w-4/5" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ActionZoneSkeleton() {
  return (
    <div aria-hidden>
      <Skeleton className="h-7 w-40" />
      <div className="mt-5 grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {[1, 2, 3].map((card) => (
          <div key={card} className="rounded-lg border bg-card p-5">
            <Skeleton className="h-3 w-36" />
            <Skeleton className="mt-5 h-4 w-4/5" />
            <div className="mt-4 grid gap-3">
              {[1, 2, 3].map((row) => (
                <Skeleton key={row} className="h-9 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
