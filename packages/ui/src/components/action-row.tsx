import type { ReactNode } from "react";
import { cn } from "../cn";

/**
 * The actions on a result panel — "Reimprimir", "Recibir otro dispositivo",
 * "Abrir la ficha".
 *
 * **Stacked, full width, always.** Three of these sat side by side in a 340px
 * rail as `flex-1`, which gives each about 110px; "Recibir otro dispositivo" is
 * 26 characters and ran straight over its neighbours. Squeezing them is a
 * losing game — the labels are what they are, they get longer in some
 * languages, and a fourth action would break it again.
 *
 * A component rather than a class list on each panel, so the next result panel
 * inherits the fix instead of re-earning the bug.
 */
export function ActionRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5 [&>*]:w-full [&>*]:justify-center", className)}>{children}</div>
  );
}
