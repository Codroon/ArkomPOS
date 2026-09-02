/**
 * First run — the one conversation the till has with its owner.
 *
 * Shown when the database has no tenant, which on a client machine means the
 * installer just finished. It is deliberately not skippable: the ticket's legal
 * block and the ticket series both have to exist before a sale can happen, and
 * a till that lets you sell first and asks afterwards has already printed
 * something wrong.
 *
 * Everything here is changeable later in Ajustes except the series prefix,
 * which ADR-0008 freezes once numbering starts — so the hint says so, next to
 * the field, rather than in a manual nobody reads.
 *
 * Since v0.10.0 the owner is created immediately AFTER this, in its own step:
 * setup:status reports `ownerNeeded` and App routes there, which is the same
 * path a v0.9.0 till takes when it updates. One flow, two entry points — rather
 * than a fourth section here that the upgrade case could never reach.
 */
import { useCallback, useMemo, useState } from "react";
import { SetupCompleteResponseSchema } from "@arkom/core";
import { AccentButton, Field, LocaleToggle, TextInput, useLocale, useT, type TFn } from "@arkom/ui";
import { errorMessage } from "../../lib/errors";

const PREFIX_OK = /^[A-Za-z0-9-]+$/;

interface Draft {
  shopLegalName: string;
  shopNif: string;
  shopAddress: string;
  ticketFooter: string;
  terminalName: string;
  seriesPrefix: string;
  loadDemo: boolean;
}

/**
 * The prefills. These become shop DATA the moment the shop presses save, so
 * they are never translated afterwards — but the blank form is chrome, and a
 * till being set up in English should not offer a Spanish default to type over
 * (ADR-0011).
 */
const initialDraft = (t: TFn): Draft => ({
  shopLegalName: "",
  shopNif: "",
  shopAddress: "",
  // the default the brand ships with; the shop can make it their own
  ticketFooter: t("setup.defaultFooter"),
  terminalName: t("setup.defaultTerminal"),
  seriesPrefix: "T1-",
  loadDemo: true,
});

/** One of the two big choices at the bottom — a card, not a radio button. */
function DataChoice({
  selected,
  title,
  hint,
  onSelect,
}: {
  selected: boolean;
  title: string;
  hint: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        "flex-1 rounded-[3px] border px-3 py-2.5 text-left transition-colors " +
        (selected
          ? "border-ink bg-inverse text-inverse-ink"
          : "border-line-strong bg-card text-ink hover:border-ink-2")
      }
    >
      <div className="text-[12px] font-semibold">{title}</div>
      <div className={"mt-0.5 text-[10px] leading-snug " + (selected ? "text-inverse-muted" : "text-muted")}>
        {hint}
      </div>
    </button>
  );
}

export function FirstRunDialog({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [locale] = useLocale();
  const [draft, setDraft] = useState<Draft>(() => initialDraft(t));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const problems = useMemo(() => {
    const out: Partial<Record<keyof Draft, string>> = {};
    if (!draft.shopLegalName.trim()) out.shopLegalName = t("first.required");
    if (!draft.shopNif.trim()) out.shopNif = t("first.required");
    if (!draft.shopAddress.trim()) out.shopAddress = t("first.required");
    if (!draft.terminalName.trim()) out.terminalName = t("first.required");
    if (!draft.seriesPrefix.trim()) out.seriesPrefix = t("first.required");
    else if (!PREFIX_OK.test(draft.seriesPrefix.trim())) out.seriesPrefix = t("first.prefixInvalid");
    return out;
  }, [draft, t]);

  const ready = Object.keys(problems).length === 0;

  const submit = useCallback(async () => {
    setTouched(true);
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      SetupCompleteResponseSchema.parse(
        await window.arkom.invoke("setup:complete", {
          ...draft,
          shopLegalName: draft.shopLegalName.trim(),
          shopNif: draft.shopNif.trim(),
          shopAddress: draft.shopAddress.trim(),
          ticketFooter: draft.ticketFooter.trim(),
          terminalName: draft.terminalName.trim(),
          seriesPrefix: draft.seriesPrefix.trim(),
          /* the starter groups are written in the language the shop is reading
             right now, and are shop data from then on (ADR-0017) */
          locale,
        }),
      );
      onDone();
    } catch (err) {
      setError(errorMessage(t, err));
      setBusy(false);
    }
  }, [draft, ready, busy, onDone, t]);

  const show = (key: keyof Draft) => (touched ? (problems[key] ?? null) : null);

  return (
    <div className="flex h-full min-h-[860px] flex-col bg-canvas text-ink">
      {/* the same brand plate the app wears, so first run looks like the app */}
      <header className="relative flex h-11 flex-none items-center bg-inverse px-3.5 text-inverse-ink">
        <span className="font-display text-[15px] leading-none tracking-[.06em]">ARKOM</span>
        <span className="ml-2 font-mono text-[9px] font-medium tracking-[.16em] text-inverse-muted">POS</span>
        <div className="flex-1" />
        {/* setup is the first thing anyone sees, and the person doing it may not
            read Spanish — the toggle has to be reachable before the shell exists */}
        <LocaleToggle />
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-accent" />
      </header>

      <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto p-8">
        <div className="w-full max-w-[640px]">
          <h1 className="font-display text-[24px] leading-tight">{t("first.title")}</h1>
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{t("first.subtitle")}</p>

          <section className="mt-6 flex flex-col gap-3.5 rounded-[3px] border border-line bg-card p-4">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[.1em] text-muted">
                {t("first.shopSection")}
              </div>
              <div className="mt-0.5 text-[11px] text-subtle">{t("first.shopHint")}</div>
            </div>

            <Field label={t("first.legalName")} error={show("shopLegalName")}>
              <TextInput
                autoFocus
                value={draft.shopLegalName}
                placeholder={t("first.legalNamePlaceholder")}
                onChange={(e) => set("shopLegalName", e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-[160px_1fr] gap-3">
              <Field label={t("first.nif")} error={show("shopNif")}>
                <TextInput
                  value={draft.shopNif}
                  placeholder={t("first.nifPlaceholder")}
                  onChange={(e) => set("shopNif", e.target.value)}
                />
              </Field>
              <Field label={t("first.address")} error={show("shopAddress")}>
                <TextInput
                  value={draft.shopAddress}
                  placeholder={t("first.addressPlaceholder")}
                  onChange={(e) => set("shopAddress", e.target.value)}
                />
              </Field>
            </div>

            <Field label={t("first.footer")}>
              <TextInput
                value={draft.ticketFooter}
                onChange={(e) => set("ticketFooter", e.target.value)}
              />
            </Field>
          </section>

          <section className="mt-4 flex flex-col gap-3.5 rounded-[3px] border border-line bg-card p-4">
            <div className="text-[10px] font-bold uppercase tracking-[.1em] text-muted">
              {t("first.tillSection")}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("first.terminalName")} error={show("terminalName")}>
                <TextInput
                  value={draft.terminalName}
                  onChange={(e) => set("terminalName", e.target.value)}
                />
              </Field>
              <Field
                label={t("first.prefix")}
                error={show("seriesPrefix")}
                hint={t("first.prefixHint", { prefix: draft.seriesPrefix.trim() || "T1-" })}
              >
                <TextInput
                  className="font-mono"
                  value={draft.seriesPrefix}
                  onChange={(e) => set("seriesPrefix", e.target.value)}
                />
              </Field>
            </div>
          </section>

          <section className="mt-4 flex flex-col gap-2.5 rounded-[3px] border border-line bg-card p-4">
            <div className="text-[10px] font-bold uppercase tracking-[.1em] text-muted">
              {t("first.dataSection")}
            </div>
            <div className="flex gap-2.5">
              <DataChoice
                selected={draft.loadDemo}
                title={t("first.demoYes")}
                hint={t("first.demoYesHint")}
                onSelect={() => set("loadDemo", true)}
              />
              <DataChoice
                selected={!draft.loadDemo}
                title={t("first.demoNo")}
                hint={t("first.demoNoHint")}
                onSelect={() => set("loadDemo", false)}
              />
            </div>
          </section>

          {error ? (
            <div className="mt-4 rounded-[3px] border border-danger-ink/30 bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger-ink">
              {error}
            </div>
          ) : null}

          <div className="mt-5 flex justify-end pb-4">
            {/* the screen's one blue element */}
            <AccentButton disabled={busy} onClick={() => void submit()}>
              {busy ? t("first.starting") : t("first.start")}
            </AccentButton>
          </div>
        </div>
      </div>
    </div>
  );
}
