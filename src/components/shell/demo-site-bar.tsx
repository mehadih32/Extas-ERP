/**
 * The bar across the top of every page of the demo site (DEMO_SITE=on; see
 * deploy/README.md, "The demo site"), so nobody takes it for the live ERP.
 */
export function DemoSiteBar() {
  return (
    <div
      role="note"
      className="bg-amber-300 px-4 py-1.5 text-center text-xs font-medium text-amber-950 print:hidden"
    >
      Demo site: practice data only. Nothing here reaches the live ERP.
    </div>
  );
}
