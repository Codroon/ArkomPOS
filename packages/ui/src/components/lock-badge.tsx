import { useT } from "../i18n";
import { cn } from "../cn";

/**
 * Monospace LOCK badge for features rendered but out of Phase-1 scope
 * (00-foundations: locked nav items / LockedButton).
 */
export function LockBadge({ className }: { className?: string }) {
  const t = useT();
  return (
    <span
      className={cn(
        "rounded-[2px] border border-line-strong px-1 py-px font-mono text-[8px] font-bold tracking-[.08em] text-subtle",
        className,
      )}
    >
      {t("common.lock")}
    </span>
  );
}
