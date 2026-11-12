export const metadata = { title: { absolute: "Link not working" } };

/**
 * A status link that is unknown, stopped or ended: the same page for each, and
 * nothing about the company or the app behind it.
 */
export default function StatusLinkNotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="eyebrow">404</p>
      <h1 className="font-serif text-3xl text-primary sm:text-4xl">This link is not working</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        It may have been stopped or have ended. Ask the company that sent it for a new link.
      </p>
    </main>
  );
}
