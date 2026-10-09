import { Wordmark } from "@/components/brand/wordmark";

/** Sign-in, new password and company choice: the house panel beside a quiet form. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh grid-rows-[auto_1fr] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-1">
      <aside className="relative isolate flex flex-col justify-between overflow-hidden bg-primary px-6 py-5 text-primary-foreground sm:px-10 lg:px-14 lg:py-12">
        <Wordmark />
        <div className="hidden lg:block">
          <p className="eyebrow text-primary-foreground/60">Enterprise resource planning</p>
          <p className="mt-6 max-w-md font-serif text-4xl leading-[1.15] xl:text-5xl">
            Every company.
            <br />
            One house.
          </p>
          <div className="mt-8 h-px w-16 bg-primary-foreground/40" />
          <p className="mt-6 max-w-sm text-sm leading-relaxed text-primary-foreground/70">
            Sales, stock, production, accounts and people for your apparel companies, kept in one
            place.
          </p>
        </div>
        <p className="hidden text-xs tracking-wide text-primary-foreground/50 lg:block">
          © {new Date().getFullYear()} Extas ERP
        </p>
        <span
          aria-hidden
          className="pointer-events-none absolute -right-6 -bottom-14 -z-10 hidden font-serif text-[26rem] leading-none text-primary-foreground/[0.05] select-none lg:block"
        >
          E
        </span>
      </aside>
      <main className="flex justify-center px-6 py-10 sm:items-center sm:px-10 lg:py-16">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
