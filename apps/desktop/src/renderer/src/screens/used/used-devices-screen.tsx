/**
 * Dispositivos usados (nav 05) — handoff/used-devices.md §2.
 *
 * One list of every device the shop has bought, whatever became of it. The
 * counts strip doubles as the filter, and the counts are always over
 * everything: a filter that also changes its own chip counts is one nobody can
 * navigate back out of.
 *
 * Row click opens the detail in place. There is no route table in this app, so
 * "the list" and "one device" are two states of the same screen.
 */
import { useCallback, useEffect, useState } from "react";
import { formatCents, type UsedDeviceRow } from "@arkom/core";
import { Chip, ScanInput, cn, useT, type TKey } from "@arkom/ui";
import { errorMessage } from "../../lib/errors";
import { UsedDeviceDetailPane } from "./used-device-detail";

type State = "held" | "needs_review" | "in_stock" | "sold";

const STATE_KEYS: Record<State, TKey> = {
  held: "usedState.held",
  needs_review: "usedState.needs_review",
  in_stock: "usedState.in_stock",
  sold: "usedState.sold",
};

const STATE_VARIANT: Record<State, "neutral" | "warning" | "success"> = {
  held: "neutral",
  needs_review: "warning",
  in_stock: "success",
  sold: "neutral",
};

function formatDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function UsedDevicesScreen() {
  const t = useT();
  const [rows, setRows] = useState<UsedDeviceRow[] | null>(null);
  const [counts, setCounts] = useState<Record<State, number>>({
    held: 0,
    needs_review: 0,
    in_stock: 0,
    sold: 0,
  });
  const [state, setState] = useState<State | null>(null);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await window.arkom.invoke("used:list", {
        ...(state ? { state } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
      });
      setRows(result.rows);
      setCounts(result.counts);
      setError(null);
    } catch (err) {
      setError(errorMessage(t, err));
      setRows([]);
    }
  }, [state, search, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (openId) {
    return (
      <UsedDeviceDetailPane
        purchaseId={openId}
        onClose={() => {
          setOpenId(null);
          void refresh();
        }}
      />
    );
  }

  const total = counts.held + counts.needs_review + counts.in_stock + counts.sold;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* header */}
      <div className="flex flex-none items-center gap-3 border-b border-line-strong bg-surface px-4 py-2.5">
        <div className="text-[15px] font-bold">{t("usedList.title")}</div>
        <div className="flex-1" />
        {/* a ScanInput, not a search box: scanning a shelf label jumps straight
            to the device, which is how a cashier finds one in a drawer */}
        <ScanInput
          className="w-[280px]"
          autoRefocus={false}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onScan={(code) => setSearch(code)}
          placeholder={t("usedList.searchPlaceholder")}
        />
      </div>

      {/* counts strip, doubling as the filter */}
      <div className="flex flex-none items-center gap-2 border-b border-line bg-surface-2 px-4 py-2">
        <FilterChip
          label={`${t("usedList.all")} ${total}`}
          active={state === null}
          onClick={() => setState(null)}
        />
        {(Object.keys(STATE_KEYS) as State[]).map((key) => (
          <FilterChip
            key={key}
            label={`${t(STATE_KEYS[key])} ${counts[key]}`}
            variant={STATE_VARIANT[key]}
            active={state === key}
            onClick={() => setState(state === key ? null : key)}
          />
        ))}
      </div>

      {/* table */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div className="px-4 py-6 text-[12px] text-danger-ink">{error}</div>
        ) : rows === null ? (
          <div className="px-4 py-6 text-[12px] text-subtle">{t("usedList.loading")}</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-subtle">
            {total === 0 ? t("usedList.empty") : t("usedList.noMatches")}
          </div>
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line-strong text-left text-[9px] font-bold tracking-[.12em] text-subtle">
                <th className="px-4 py-1.5">{t("usedList.colDevice")}</th>
                <th className="px-2 py-1.5">{t("usedList.colImei")}</th>
                <th className="px-2 py-1.5">{t("usedList.colPurchase")}</th>
                <th className="px-2 py-1.5">{t("usedList.colDate")}</th>
                <th className="px-2 py-1.5 text-right">{t("usedList.colBuy")}</th>
                <th className="px-2 py-1.5">{t("usedList.colState")}</th>
                <th className="px-4 py-1.5 text-right">{t("usedList.colSell")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.purchaseId}
                  onClick={() => setOpenId(row.purchaseId)}
                  className={cn(
                    "cursor-pointer border-b border-line hover:bg-hover",
                    // a sold device is history: present, and visibly done with
                    row.state === "sold" && "text-subtle",
                  )}
                >
                  <td className="px-4 py-1.5">
                    <span className="font-semibold">{[row.brand, row.model].join(" ")}</span>
                    <span className="text-muted">
                      {[row.storage, row.color].filter(Boolean).map((x) => ` · ${x}`)}
                    </span>
                    <Chip className="ml-1.5">{row.grade}</Chip>
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[11px] tabular-nums">{row.imei}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px] tabular-nums">{row.docNumber}</td>
                  <td className="px-2 py-1.5 tabular-nums">{formatDate(row.purchasedAtMs)}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                    {formatCents(row.buyPriceCents)}
                  </td>
                  <td className="px-2 py-1.5">
                    <Chip variant={STATE_VARIANT[row.state]}>{t(STATE_KEYS[row.state])}</Chip>
                  </td>
                  <td className="px-4 py-1.5 text-right font-mono tabular-nums">
                    {row.sellPriceCents === null ? t("common.dash") : formatCents(row.sellPriceCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  label,
  variant = "neutral",
  active,
  onClick,
}: {
  label: string;
  variant?: "neutral" | "warning" | "success";
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-6 rounded-[3px] border px-2 font-mono text-[10px] font-bold tracking-[.06em]",
        // the selected chip inverts to graphite: one selection, unmistakable,
        // and it never competes with the screen's blue
        active
          ? "border-ink bg-ink text-inverse-ink"
          : variant === "warning"
            ? "border-warning-ink/30 bg-warning-bg text-warning-ink hover:border-warning-ink/60"
            : variant === "success"
              ? "border-success-ink/30 bg-success-bg text-success-ink hover:border-success-ink/60"
              : "border-line-strong bg-card text-ink-2 hover:border-muted",
      )}
    >
      {label}
    </button>
  );
}
