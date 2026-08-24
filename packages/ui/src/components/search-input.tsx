import type { InputHTMLAttributes } from "react";
import { cn } from "../cn";

/** Search box with the ⌕ affordance (non-refocusing; ScanInput for Venta is separate). */
export function SearchInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-subtle">⌕</span>
      <input
        type="text"
        className="h-7 w-full rounded-[3px] border border-line-strong bg-card pl-6 pr-2 text-[12px] text-ink outline-none placeholder:text-subtle focus:border-ink-2"
        {...props}
      />
    </div>
  );
}
