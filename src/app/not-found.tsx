import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="eyebrow">404</p>
      <h1 className="font-serif text-4xl text-primary sm:text-5xl">This page does not exist</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The link may be old, or the page may have moved. Head back to the dashboard to carry on.
      </p>
      <Button asChild size="lg">
        <Link href="/">Go to the dashboard</Link>
      </Button>
    </main>
  );
}
