import { ArrowRightIcon, ScanBarcodeIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/display";
import type { lookupVariant } from "@/modules/inventory/matrix.service";

import { Swatch } from "./bits";
import { variantName } from "./labels";

export type SkuMatch = Awaited<ReturnType<typeof lookupVariant>>;

/** The SKU whose code or barcode was searched for, with its stock and a way into its matrix. */
export function SkuMatchCard({ sku, currency }: { sku: SkuMatch; currency: string }) {
  const count = (n: number) => formatCount(n, currency);
  return (
    <section
      aria-label="SKU found"
      className="flex flex-col gap-4 rounded-lg border border-primary/25 bg-secondary/60 p-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <p className="eyebrow flex items-center gap-1.5 text-primary">
          <ScanBarcodeIcon className="size-3.5" aria-hidden />
          SKU found
        </p>
        <p className="mt-2 flex items-center gap-2 font-medium">
          <Swatch hex={sku.color.hexCode} />
          <span className="truncate">
            {sku.sku} · {variantName(sku)}
          </span>
        </p>
        <p className="mt-1 truncate text-sm text-muted-foreground">
          {sku.style.name} ({sku.style.code}){sku.barcode ? ` · Barcode ${sku.barcode}` : ""}
          {sku.isActive ? "" : " · Not offered for sale"}
        </p>
        <p className="mt-2 text-sm tabular-nums">
          {count(sku.stock.available)} available · {count(sku.stock.reserved)} set aside ·{" "}
          {count(sku.stock.bGrade)} B-grade
        </p>
      </div>
      <Button asChild className="w-full sm:w-auto">
        <Link href={`/products/${sku.style.id}?sku=${sku.id}`}>
          Open in the matrix
          <ArrowRightIcon aria-hidden />
        </Link>
      </Button>
    </section>
  );
}
