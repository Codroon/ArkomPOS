import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "../cn";
import { SectionLabel } from "./section-label";

/** Label + control + 11px error line (00-foundations error style). */
export function Field({
  label,
  required,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  error?: string | null;
  hint?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <SectionLabel>
        {label}
        {required ? <span className="text-ink-3">*</span> : null}
      </SectionLabel>
      {children}
      {error ? <div className="text-[11px] leading-snug text-ink-2">{error}</div> : null}
      {!error && hint ? <div className="text-[11px] leading-snug text-faint">{hint}</div> : null}
    </div>
  );
}

const controlBase =
  "h-7 w-full rounded-[3px] border bg-card px-2 text-[12px] text-ink outline-none placeholder:text-faint focus:border-ink-2 disabled:bg-panel-2 disabled:text-faint";

export const TextInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { mono?: boolean; requiredStyle?: boolean; invalid?: boolean }
>(function TextInput({ className, mono, requiredStyle, invalid, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        controlBase,
        requiredStyle ? "border-border-input-required" : "border-border-input",
        invalid && "border-ink",
        mono && "font-mono tabular-nums",
        className,
      )}
      {...props}
    />
  );
});

export function SelectInput({
  className,
  requiredStyle,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { requiredStyle?: boolean }) {
  return (
    <select
      className={cn(
        controlBase,
        "appearance-none pr-6",
        requiredStyle ? "border-border-input-required" : "border-border-input",
        className,
      )}
      {...props}
    />
  );
}
