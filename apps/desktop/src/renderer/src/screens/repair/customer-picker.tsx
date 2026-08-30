/**
 * Who left the device — handoff/repairs.md §1, "Cliente".
 *
 * A repair is the first thing in this till that needs a name attached to it: a
 * sale is anonymous, a purchase records a seller inside the purchase itself,
 * but a repair has to be phoned when it is ready. So the counter needs to find
 * a person in two keystrokes and create one in four.
 *
 * The search runs on the phone number first because that is what a customer
 * says out loud, and because `normalizePhone` makes "671220918" find the person
 * stored as "+34 671 22 09 18". Results appear as you type; nothing is created
 * until someone presses the button.
 */
import { useEffect, useState } from "react";
import type { CustomerRow } from "@arkom/core";
import { Field, GhostButton, PrimaryButton, SearchInput, SectionLabel, TextInput, cn, useT } from "@arkom/ui";
import { errorMessage } from "../../lib/errors";

export function CustomerPicker({
  selected,
  onSelect,
  frozen,
}: {
  selected: CustomerRow | null;
  onSelect: (customer: CustomerRow | null) => void;
  frozen: boolean;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", phone: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Debounced rather than per-keystroke: the query is a LIKE over two columns,
     and a cashier typing a nine-digit phone would otherwise fire nine of them. */
  useEffect(() => {
    if (selected) return;
    const term = query.trim();
    if (term.length < 2) {
      setRows([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      window.arkom
        .invoke("customer:search", { query: term })
        .then((res) => !cancelled && setRows(res.rows))
        .catch((err) => console.error("customer:search failed", err));
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, selected]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const customer = await window.arkom.invoke("customer:upsert", {
        name: draft.name.trim(),
        phone: draft.phone.trim(),
        note: draft.note.trim() || null,
      });
      onSelect(customer);
      setCreating(false);
      setDraft({ name: "", phone: "", note: "" });
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  /* ---- chosen: the search collapses to a line and a way back ---- */
  if (selected) {
    return (
      <section className="rounded-[3px] border border-line-strong bg-card px-3 py-2.5">
        <SectionLabel>{t("rep.customer.section")}</SectionLabel>
        <div className="mt-2 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">{selected.name}</div>
            <div className="font-mono text-[11px] text-muted">{selected.phone}</div>
            {selected.note ? <div className="mt-0.5 text-[11px] text-ink-2">{selected.note}</div> : null}
          </div>
          {/* how many times this person has been here — the one piece of
              context that changes how a counter conversation goes */}
          {selected.repairCount > 0 ? (
            <div className="text-[11px] text-subtle">
              {t("rep.customer.repairs", { n: String(selected.repairCount) })}
            </div>
          ) : null}
          {!frozen ? (
            <GhostButton
              onClick={() => {
                onSelect(null);
                setQuery("");
                setRows([]);
              }}
            >
              {t("rep.customer.change")}
            </GhostButton>
          ) : null}
        </div>
      </section>
    );
  }

  /* ---- creating ---- */
  if (creating) {
    return (
      <section className="rounded-[3px] border border-line-strong bg-card px-3 py-2.5">
        <SectionLabel>{t("rep.customer.new")}</SectionLabel>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field label={t("rep.customer.name")} required>
            <TextInput
              requiredStyle
              autoFocus
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </Field>
          <Field label={t("rep.customer.phone")} required>
            <TextInput
              mono
              requiredStyle
              value={draft.phone}
              onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
            />
          </Field>
          <Field className="col-span-2" label={t("rep.customer.note")}>
            <TextInput value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} />
          </Field>
        </div>
        {error ? <div className="mt-2 text-[11px] text-danger-ink">{error}</div> : null}
        <div className="mt-2.5 flex gap-2">
          <PrimaryButton disabled={busy || !draft.name.trim() || !draft.phone.trim()} onClick={() => void create()}>
            {busy ? t("common.saving") : t("rep.customer.new")}
          </PrimaryButton>
          <GhostButton onClick={() => setCreating(false)}>{t("common.cancel")}</GhostButton>
        </div>
      </section>
    );
  }

  /* ---- searching ---- */
  return (
    <section className="rounded-[3px] border border-line-strong bg-card px-3 py-2.5">
      <SectionLabel>{t("rep.customer.section")}</SectionLabel>
      <div className="mt-2 flex gap-2">
        <SearchInput
          autoFocus
          className="flex-1"
          value={query}
          placeholder={t("rep.customer.searchPlaceholder")}
          onChange={(e) => setQuery(e.target.value)}
        />
        <GhostButton
          onClick={() => {
            /* whatever they typed is probably the phone, so it travels into the
               form rather than making them type it twice */
            const term = query.trim();
            setDraft({ name: /\d/.test(term) ? "" : term, phone: /\d/.test(term) ? term : "", note: "" });
            setCreating(true);
          }}
        >
          {t("rep.customer.new")}
        </GhostButton>
      </div>

      {rows.length > 0 ? (
        <div className="mt-2 overflow-hidden rounded-[2px] border border-line">
          {rows.map((row, i) => (
            <button
              key={row.id}
              type="button"
              onClick={() => onSelect(row)}
              className={cn(
                "flex w-full items-center gap-3 px-2.5 py-1.5 text-left hover:bg-hover",
                i > 0 && "border-t border-line",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-[12px]">{row.name}</span>
              <span className="font-mono text-[11px] text-muted">{row.phone}</span>
              {row.repairCount > 0 ? (
                <span className="text-[10px] text-subtle">
                  {t("rep.customer.repairs", { n: String(row.repairCount) })}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : query.trim().length >= 2 ? (
        <div className="mt-2 text-[11px] text-subtle">{t("rep.customer.none")}</div>
      ) : null}
    </section>
  );
}
