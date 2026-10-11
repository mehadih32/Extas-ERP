"use client";

/** The event that opens one of the Insights tabs from elsewhere on the Home screen. */
export const INSIGHTS_TAB_EVENT = "insights:open-tab";

/** A button that opens an Insights tab (like Low stock) and scrolls to it. */
export function OpenInsightsTab({
  tab,
  className,
  children,
}: {
  tab: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new CustomEvent(INSIGHTS_TAB_EVENT, { detail: tab }))}
    >
      {children}
    </button>
  );
}
