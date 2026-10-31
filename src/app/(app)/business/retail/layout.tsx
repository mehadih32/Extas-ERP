import { SectionTabs } from "@/components/shell/section-tabs";

/**
 * Business > Retail: the online stores (E-commerce), the showrooms (POS), the
 * stores themselves, the stock bought and kept for them, and their returns.
 */
export default function RetailLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-6">
      <SectionTabs
        label="Retail"
        tabs={[
          { href: "/business/retail", label: "E-commerce" },
          { href: "/business/retail/pos", label: "POS" },
          { href: "/business/retail/stores", label: "Retail stores" },
          { href: "/business/retail/shop-stock", label: "Shop stock" },
          { href: "/business/retail/returns", label: "Returns" },
        ]}
      />
      {children}
    </div>
  );
}
