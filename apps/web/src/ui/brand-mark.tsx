/**
 * The brand, on screen.
 *
 * Codroon has a wordmark drawn as an SVG, so it gets drawn. Any other brand —
 * the Arkom pilot, and every white-label customer after it — sets its name in
 * the display face instead. That is the honest answer: a customer has a name
 * long before they have a logo file, and inventing a lockup for them would
 * look worse than typography does.
 *
 * Whichever it is, it takes `currentColor`: Bone on the charcoal rail, ink on
 * a Bone page, from one component.
 */
import { BRAND, HAS_WORDMARK_SVG } from "../brand";
import { cn } from ".";
import { Wordmark } from "./wordmark";

export function BrandMark({
  className,
  height = 17,
}: {
  className?: string;
  /** in pixels, because the SVG and the type have to agree on a cap height */
  height?: number;
}) {
  if (HAS_WORDMARK_SVG) {
    return <Wordmark className={cn("w-auto", className)} title={BRAND.productName} />;
  }

  return (
    <span
      className={cn("font-semibold tracking-[0.14em] whitespace-nowrap", className)}
      style={{ fontSize: height }}
      role="img"
      aria-label={BRAND.productName}
    >
      {BRAND.wordmark}
    </span>
  );
}

/** The mark with its small suffix beside it — the lockup used on a page. */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-baseline gap-2", className)}>
      <BrandMark className="text-ink" />
      <span className="text-[12px] font-semibold tracking-[0.14em] text-muted">
        {BRAND.wordmarkSuffix}
      </span>
    </span>
  );
}
