import { SectionTabs } from "@/components/shell/section-tabs";

/** Business > Retail: the online stores (E-commerce) and, later, the showrooms (POS). */
export default function RetailLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-6">
      <SectionTabs
        label="Retail"
        tabs={[
          { href: "/business/retail", label: "E-commerce" },
          { href: "/business/retail/pos", label: "POS" },
        ]}
      />
      {children}
    </div>
  );
}
