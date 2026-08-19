import type { ReactNode } from "react";
import { cn } from "../cn";

/** 00-foundations: 10px, 700, .1em tracking, uppercase, muted. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("text-[10px] font-bold uppercase tracking-[.1em] text-muted", className)}>
      {children}
    </div>
  );
}
