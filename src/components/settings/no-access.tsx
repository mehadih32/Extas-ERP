/** What a settings screen shows to someone whose role does not open it. */
export function NoAccess({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card px-6 py-12 text-center sm:px-10">
      <p className="font-serif text-2xl text-primary">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        {children}
      </p>
    </section>
  );
}
