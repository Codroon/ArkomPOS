/**
 * ScanInput — 00-foundations: keyboard-wedge scanner target with the ⌕ + SCAN
 * kbd chip; Enter submits the buffered code. Auto-refocus: 100ms after blur it
 * takes focus back ONLY if focus fell to the document body (never steals from
 * another input/control the user chose deliberately).
 */
import { forwardRef, useImperativeHandle, useRef, type InputHTMLAttributes } from "react";
import { cn } from "../cn";
import { useT } from "../i18n";

export interface ScanInputHandle {
  focus(): void;
}

export const ScanInput = forwardRef<
  ScanInputHandle,
  Omit<InputHTMLAttributes<HTMLInputElement>, "onSubmit"> & {
    onScan: (code: string) => void;
    autoRefocus?: boolean;
  }
>(function ScanInput({ onScan, autoRefocus = true, className, ...props }, ref) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));

  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-subtle">⌕</span>
      <input
        ref={inputRef}
        type="text"
        className="h-7 w-full rounded-[3px] border border-line-strong bg-card pl-6 pr-14 font-mono text-[12px] tabular-nums text-ink outline-none placeholder:font-sans placeholder:text-subtle focus:border-ink-2"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const value = e.currentTarget.value.trim();
            if (value) onScan(value);
          }
        }}
        onBlur={() => {
          if (!autoRefocus) return;
          setTimeout(() => {
            const active = document.activeElement;
            if (active === null || active === document.body) inputRef.current?.focus();
          }, 100);
        }}
        {...props}
      />
      <ScanKbd />
    </div>
  );
});

function ScanKbd() {
  const t = useT();
  return (
    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-[2px] border border-line bg-surface-2 px-1 py-px font-mono text-[8px] font-bold tracking-[.08em] text-subtle">
      {t("scan.kbd")}
    </span>
  );
}
