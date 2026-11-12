/**
 * Pages open to anyone with their link, outside the app (no menus, no sign-in):
 * the order status a company shares with its buyer. Each page draws its own
 * header from the Company record, never the app's.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh flex-col bg-background">{children}</div>;
}
