import { cn } from "../cn";
import { useT } from "../i18n";
import { LockBadge } from "./lock-badge";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean; // rendered visible-disabled with a lock (P1 scope honesty)
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (next: T) => void;
  className?: string;
}) {
  const t = useT();
  return (
    <div className={cn("flex flex-wrap overflow-hidden rounded-[3px] border border-line-strong bg-card", className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={opt.disabled}
          title={opt.disabled ? t("common.comingSoon") : undefined}
          onClick={() => onChange(opt.value)}
          className={cn(
            "flex items-center gap-1 border-r border-line px-2 py-1 text-[11px] last:border-r-0",
            value === opt.value
              ? "bg-ink-2 font-bold text-white"
              : opt.disabled
                ? "cursor-default bg-surface-2 text-subtle"
                : "text-ink-2 hover:bg-hover",
          )}
        >
          {opt.label}
          {opt.disabled ? <LockBadge /> : null}
        </button>
      ))}
    </div>
  );
}
