"use client";

import { PrinterIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Prints the page (the browser's own print, or save as PDF); the app's frame stays off the paper. */
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full sm:w-auto print:hidden"
      onClick={() => window.print()}
    >
      <PrinterIcon aria-hidden />
      {label}
    </Button>
  );
}
