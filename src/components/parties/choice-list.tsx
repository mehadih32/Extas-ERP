import { cn } from "@/lib/utils";

/**
 * A set of radio buttons drawn as rows, each with its label and what it means,
 * for a form inside a dialog (the grade, which way an opening balance goes).
 */
export function ChoiceList<T extends string>({
  name,
  legend,
  options,
  defaultValue,
  onChange,
  className,
}: {
  name: string;
  legend: string;
  options: ReadonlyArray<{ value: T; label: React.ReactNode; hint?: string }>;
  defaultValue?: T;
  onChange?: (value: T) => void;
  className?: string;
}) {
  return (
    <fieldset className={cn("grid gap-2", className)}>
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className="flex cursor-pointer items-start gap-3 rounded-md border bg-card px-3 py-2.5 transition-colors has-[:checked]:border-primary/50 has-[:checked]:bg-secondary has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/25"
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            defaultChecked={option.value === defaultValue}
            onChange={() => onChange?.(option.value)}
            className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
          />
          <span className="grid gap-0.5">
            <span className="text-sm font-medium">{option.label}</span>
            {option.hint && (
              <span className="text-[0.8125rem] leading-snug text-muted-foreground">
                {option.hint}
              </span>
            )}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
