import { cn } from "../cn";

/** Monochrome toggle (Activo). */
export function Switch({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn("inline-flex items-center gap-2", className)}
    >
      <span
        className={cn(
          "relative h-4 w-7 rounded-full border transition-colors",
          checked ? "border-ink-2 bg-ink-2" : "border-line-strong bg-surface-2",
        )}
      >
        <span
          className={cn(
            "absolute top-[1px] h-3 w-3 rounded-full bg-card transition-[left]",
            checked ? "left-[13px]" : "left-[1px]",
          )}
        />
      </span>
      {label ? <span className="text-[12px] text-ink-2">{label}</span> : null}
    </button>
  );
}
