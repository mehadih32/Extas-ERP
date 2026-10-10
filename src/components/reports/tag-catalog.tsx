import { CopyButton } from "@/components/feedback/copy-button";
import type { TemplateScreen } from "@/modules/reports/screens.service";

/**
 * The tags a kind of document can fill, to type into a Word or HTML template:
 * each with what it prints and the other names it answers to.
 */
export function TagCatalog({ catalog }: { catalog: TemplateScreen["catalog"] }) {
  const groups = [
    { title: "The document", tags: catalog.filter((c) => !c.item) },
    {
      title: "Each line (in a table row, the row repeats for every line)",
      tags: catalog.filter((c) => c.item),
    },
  ].filter((g) => g.tags.length > 0);

  return (
    <div className="mt-4 grid grid-cols-1 gap-5">
      {groups.map((group) => (
        <div key={group.title} className="grid gap-2">
          <h4 className="text-sm font-medium">{group.title}</h4>
          <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
            {group.tags.map((c) => (
              <li
                key={c.path}
                className="flex min-w-0 items-center justify-between gap-2 border-b py-1.5"
              >
                <span className="min-w-0">
                  <code className="block truncate text-[0.8125rem] font-medium">{c.tag}</code>
                  <span className="block truncate text-[0.75rem] text-muted-foreground">
                    {c.label}
                    {c.alsoAs.length > 0 && ` · also ${c.alsoAs.join(", ")}`}
                  </span>
                </span>
                <CopyButton text={c.tag} label="Copy" variant="ghost" className="shrink-0" />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
