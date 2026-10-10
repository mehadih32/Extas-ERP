"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * The style's stock history in two tabs: the inward batches (each lot that came
 * in) and every movement in and out. Both stay loaded, so switching keeps the
 * pages already shown.
 */
export function StockRecords({
  batches,
  movements,
}: {
  batches: React.ReactNode;
  movements: React.ReactNode;
}) {
  return (
    <section aria-labelledby="history-heading" className="grid grid-cols-1 gap-4">
      <div>
        <h3 id="history-heading" className="font-serif text-xl text-primary">
          Stock history
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          The batches that came in, each with its own lot number, and every piece in and out.
        </p>
      </div>
      <Tabs defaultValue="batches">
        <TabsList>
          <TabsTrigger value="batches">Inward batches</TabsTrigger>
          <TabsTrigger value="movements">All movements</TabsTrigger>
        </TabsList>
        <TabsContent value="batches" forceMount className="data-[state=inactive]:hidden">
          {batches}
        </TabsContent>
        <TabsContent value="movements" forceMount className="data-[state=inactive]:hidden">
          {movements}
        </TabsContent>
      </Tabs>
    </section>
  );
}
