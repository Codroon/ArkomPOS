import type { ButtonHTMLAttributes } from "react";
import { cn } from "../cn";
import { LockBadge } from "./lock-badge";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

const base =
  "inline-flex h-7 items-center justify-center gap-1.5 rounded-[3px] px-3 text-[12px] leading-none disabled:cursor-default";

/** 00-foundations: ink-2 bg, white text. */
export function PrimaryButton({ className, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(base, "bg-ink-2 font-bold text-white hover:bg-ink disabled:bg-faint-2", className)}
      {...props}
    />
  );
}

/** 00-foundations: white bg, border-input. */
export function GhostButton({ className, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        base,
        "border border-border-input bg-card text-ink-2 hover:border-ink-3 hover:text-ink disabled:border-border disabled:text-faint",
        className,
      )}
      {...props}
    />
  );
}

/** Rendered but out of Phase-1 scope: disabled + LOCK badge (keeps layout honest). */
export function LockedButton({ className, children, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      className={cn(base, "border border-border bg-panel-2 text-faint", className)}
      {...props}
    >
      {children}
      <LockBadge />
    </button>
  );
}
