"use client";

/**
 * "Link a till" — the shop issues its own enrolment code.
 *
 * The code is shown ONCE, here, and never again: the database holds a digest,
 * so there is no screen that could show it a second time and no support request
 * that could recover it. The panel says so plainly rather than letting somebody
 * close it and find out.
 *
 * It also shows the ADDRESS to type into the till, taken from the browser's own
 * location. Hardcoding it would be wrong twice over — the pilot is on a
 * different domain from the product, and whoever reads this is, by definition,
 * already looking at the right one.
 */
import { useActionState, useEffect, useState } from "react";
import { Copy, Check, Plus, X } from "lucide-react";
import { issueEnrolCode, type IssueResult } from "../../../src/auth/enrol-actions";
import { cn, ghostClass, inputClass, primaryClass } from "../../../src/ui";

export interface LinkLabels {
  open: string;
  title: string;
  lede: string;
  labelField: string;
  labelHint: string;
  issue: string;
  issuing: string;
  codeIs: string;
  onceOnly: string;
  validUntil: string;
  address: string;
  steps: string[];
  copy: string;
  copied: string;
  close: string;
  failed: string;
}

export function LinkTill({ labels }: { labels: LinkLabels }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [result, action, pending] = useActionState<IssueResult | null, FormData>(
    issueEnrolCode,
    null,
  );

  /* the address the till has to be pointed at is the one this page is served
     from — read after mount, because the server has no window */
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const copy = async (what: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* clipboard refused (insecure context, or the browser said no). The value
         is on screen and selectable, which is the fallback. */
    }
  };

  const code = result?.ok ? result : null;
  const failed = result && !result.ok ? result : null;

  return (
    <>
      <button type="button" className={primaryClass} onClick={() => setOpen(true)}>
        <Plus size={15} strokeWidth={2} aria-hidden />
        {labels.open}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
          <button
            type="button"
            aria-label={labels.close}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-inverse/45"
          />
          <div className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-[10px] border border-line bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_28px_rgba(21,24,27,0.18)] sm:max-w-[520px] sm:rounded-[6px] sm:pb-0">
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-[16px] font-semibold text-ink">{labels.title}</h2>
                <p className="mt-1 text-[12.5px] leading-snug text-muted">{labels.lede}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={labels.close}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-card text-muted hover:bg-hover"
              >
                <X size={18} />
              </button>
            </div>

            {code ? (
              <div className="px-5 py-5">
                <div className="text-[11px] font-semibold tracking-[0.07em] text-muted uppercase">
                  {labels.codeIs}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <code className="tabular flex-1 rounded-card border border-line-strong bg-surface/60 px-3 py-3 text-center text-[19px] font-semibold tracking-[0.12em] text-ink select-all">
                    {code.code}
                  </code>
                  <button
                    type="button"
                    className={cn(ghostClass, "h-[50px] shrink-0")}
                    onClick={() => copy("code", code.code)}
                  >
                    {copied === "code" ? <Check size={15} /> : <Copy size={15} />}
                    <span className="sr-only sm:not-sr-only">
                      {copied === "code" ? labels.copied : labels.copy}
                    </span>
                  </button>
                </div>

                <p className="mt-2.5 rounded-card bg-warning-bg px-3 py-2 text-[12px] leading-snug text-warning-ink">
                  {labels.onceOnly}
                </p>

                <dl className="mt-4 space-y-2 text-[13px]">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted">{labels.validUntil}</dt>
                    <dd className="tabular text-ink">{code.expiresOn}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="shrink-0 text-muted">{labels.address}</dt>
                    <dd className="flex min-w-0 items-center gap-2">
                      <code className="truncate text-[12.5px] text-ink select-all">{origin}</code>
                      <button
                        type="button"
                        onClick={() => copy("origin", origin)}
                        className="shrink-0 text-muted hover:text-ink"
                        aria-label={labels.copy}
                      >
                        {copied === "origin" ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                    </dd>
                  </div>
                </dl>

                <ol className="mt-4 space-y-1.5 border-t border-line pt-4 text-[12.5px] leading-relaxed text-ink-2">
                  {labels.steps.map((step, i) => (
                    <li key={step} className="flex gap-2.5">
                      <span className="tabular shrink-0 text-subtle">{i + 1}.</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <form action={action} className="px-5 py-5">
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold tracking-[0.07em] text-muted uppercase">
                    {labels.labelField}
                  </span>
                  <input
                    className={inputClass}
                    name="label"
                    maxLength={40}
                    placeholder={labels.labelHint}
                    autoFocus
                  />
                </label>
                <p className="mt-1.5 text-[12px] text-muted">{labels.labelHint}</p>

                {failed ? (
                  <p className="mt-3 rounded-card border border-danger-ink/25 bg-danger-bg px-3 py-2 text-[12.5px] text-danger-ink">
                    {labels.failed}
                  </p>
                ) : null}

                <button type="submit" className={cn(primaryClass, "mt-4 w-full")} disabled={pending}>
                  {pending ? labels.issuing : labels.issue}
                </button>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
