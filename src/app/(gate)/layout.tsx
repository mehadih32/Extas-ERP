import { Wordmark } from "@/components/brand/wordmark";

/**
 * Screens that come before the app itself (the terms of employment): the house
 * bar on top and one reading column, without the app's menus, which stay closed
 * until the person has agreed.
 */
export default function GateLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-primary px-4 py-4 text-primary-foreground sm:px-6 print:hidden">
        <div className="mx-auto flex max-w-3xl items-center">
          <Wordmark />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 pt-8 pb-12 sm:px-6 sm:pt-12">
        {children}
      </main>
    </div>
  );
}
