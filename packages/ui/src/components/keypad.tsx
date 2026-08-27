import { useCallback, useEffect } from "react";
import { cn } from "../cn";

/**
 * The PIN keypad — one component for Login, Lock, Approval and Usuarios.
 *
 * Two decisions worth keeping:
 *
 * - **The entry shows dots, never digits.** A shop counter is a public place
 *   and the customer is standing on the other side of the screen.
 * - **The hardware numpad works wherever this does.** Staff will use the
 *   physical keys because they are faster than tapping, so digits, Backspace
 *   and Enter are bound whenever the keypad is enabled.
 *
 * Brand: the confirm key is the surface's ONE blue element. No digit key is
 * blue, and the label on blue is `accent-ink` — never white.
 */

export const PIN_MIN = 4;
export const PIN_MAX = 6;

function PinDots({ length, tone }: { length: number; tone: "light" | "dark" }) {
  return (
    <div
      className="flex items-center justify-center gap-2.5 py-1"
      aria-live="polite"
      // announces the COUNT, never the digits
      aria-label={`${length}`}
    >
      {Array.from({ length: PIN_MAX }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-3 w-3 rounded-full border transition-colors",
            i < length
              ? tone === "dark"
                ? "border-inverse-ink bg-inverse-ink"
                : "border-ink bg-ink"
              : tone === "dark"
                ? "border-inverse-muted/60"
                : "border-line-strong",
            // past the minimum the remaining slots are optional, not missing
            i >= PIN_MIN && i >= length ? "opacity-40" : "",
          )}
        />
      ))}
    </div>
  );
}

export interface KeypadProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  busy?: boolean;
  /** the confirm key's label — "Entrar", "Desbloquear", "Autorizar" */
  submitLabel: string;
  clearLabel: string;
  /** dark = on the Graphite lock overlay */
  tone?: "light" | "dark";
  className?: string;
}

export function Keypad({
  value,
  onChange,
  onSubmit,
  disabled = false,
  busy = false,
  submitLabel,
  clearLabel,
  tone = "light",
  className,
}: KeypadProps) {
  const ready = value.length >= PIN_MIN && !disabled && !busy;

  const press = useCallback(
    (digit: string) => {
      if (disabled || busy || value.length >= PIN_MAX) return;
      onChange(value + digit);
    },
    [value, onChange, disabled, busy],
  );

  const backspace = useCallback(() => {
    if (disabled || busy) return;
    onChange(value.slice(0, -1));
  }, [value, onChange, disabled, busy]);

  // the physical numpad is the fast path; binding it is not an accessibility
  // afterthought, it is how this actually gets used
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled || busy) return;
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        press(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        backspace();
      } else if (e.key === "Enter" && value.length >= PIN_MIN) {
        e.preventDefault();
        onSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press, backspace, onSubmit, value.length, disabled, busy]);

  const keyClass = cn(
    "flex h-14 items-center justify-center rounded-[3px] border font-mono text-[20px] font-medium tabular-nums transition-colors",
    tone === "dark"
      ? "border-inverse-2 bg-inverse-2/40 text-inverse-ink hover:bg-inverse-2 active:bg-inverse-2"
      : "border-line-strong bg-card text-ink hover:bg-hover active:bg-active",
    disabled || busy ? "pointer-events-none opacity-40" : "",
  );

  return (
    <div className={cn("w-[264px] select-none", className)}>
      <PinDots length={value.length} tone={tone} />

      <div className="mt-2 grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" aria-label={d} className={keyClass} onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <button type="button" aria-label={clearLabel} className={keyClass} onClick={backspace}>
          ⌫
        </button>
        <button type="button" aria-label="0" className={keyClass} onClick={() => press("0")}>
          0
        </button>
        {/* the one blue element on every surface this appears on */}
        <button
          type="button"
          onClick={onSubmit}
          disabled={!ready}
          className={cn(
            "flex h-14 items-center justify-center rounded-[3px] px-1 text-[12px] font-bold transition-colors",
            ready
              ? "bg-accent text-accent-ink hover:brightness-95"
              : tone === "dark"
                ? "bg-inverse-2/40 text-inverse-muted"
                : "bg-surface-2 text-subtle",
          )}
        >
          {busy ? "…" : submitLabel}
        </button>
      </div>
    </div>
  );
}
