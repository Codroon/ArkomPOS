/**
 * The voucher finder — handoff/used-devices.md §4.
 *
 * Opens instead of an amount field, because the amount is the voucher's and not
 * the cashier's. A voucher worth MORE than the ticket is not refused — it asks
 * what to do with the difference, which is the only honest thing to do when a
 * customer who sold a phone for 50 € wants a 10 € protector. Anything that
 * genuinely cannot be used is still listed, greyed, with the reason: "that one
 * was used on Tuesday" ends an argument at the counter, silence starts one.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { formatCents, redeemPlan, type RedeemMode, type VoucherRow } from "@arkom/core";
import {
  AccentButton,
  Chip,
  GhostButton,
  PrimaryButton,
  ScanInput,
  cn,
  useT,
  type ScanInputHandle,
  type TKey,
} from "@arkom/ui";
import { errorMessage } from "../../lib/errors";

type Refusal = "not_issued" | "empty";
type Row = VoucherRow & { refusal: Refusal | null };

const REFUSAL_KEYS: Record<Refusal, TKey> = {
  not_issued: "voucher.refusalUsed",
  empty: "voucher.refusalEmpty",
};

function formatDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}`;
}

export function VoucherFinder({
  saleTotalCents,
  onCancel,
  onPick,
}: {
  saleTotalCents: number;
  onCancel: () => void;
  onPick: (voucher: Row, plan: { tenderCents: number; mode: RedeemMode }) => void;
}) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  /* set when the chosen voucher is worth more than the ticket: the cashier has
     a decision to make and the customer is entitled to be asked */
  const [deciding, setDeciding] = useState<Row | null>(null);
  const inputRef = useRef<ScanInputHandle>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const run = useCallback(
    async (value: string) => {
      if (value.trim() === "") {
        setRows([]);
        return;
      }
      try {
        const result = await window.arkom.invoke("used:findVoucher", {
          search: value.trim(),
          saleTotalCents,
        });
        setRows(result.rows);
        setError(null);
      } catch (err) {
        setError(errorMessage(t, err));
        setRows([]);
      }
    },
    [saleTotalCents, t],
  );

  // debounced so typing a purchase number is one lookup, not eight
  useEffect(() => {
    const timer = setTimeout(() => void run(search), 200);
    return () => clearTimeout(timer);
  }, [search, run]);

  const usable = rows.filter((r) => r.refusal === null);

  /** Bigger than the ticket → ask. Otherwise apply it and get out of the way. */
  const choose = (row: Row) => {
    if (row.remainingCents > saleTotalCents) {
      setDeciding(row);
      return;
    }
    onPick(row, { tenderCents: redeemPlan(row, saleTotalCents).tenderCents, mode: "keep_rest" });
  };

  const decide = (mode: RedeemMode) => {
    if (!deciding) return;
    onPick(deciding, { tenderCents: redeemPlan(deciding, saleTotalCents, mode).tenderCents, mode });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40" onMouseDown={onCancel}>
      <div
        className="w-[460px] rounded-[3px] border border-line-strong bg-card shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line-strong bg-surface-2 px-4 py-2.5">
          <div className="text-[13px] font-bold">{t("voucher.title")}</div>
          <div className="flex-1" />
          <button type="button" className="text-[13px] text-muted hover:text-ink" onClick={onCancel}>
            ✕
          </button>
        </div>

        <div className="px-4 py-3">
          <ScanInput
            ref={inputRef}
            autoRefocus={false}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onScan={(code) => {
              setSearch(code);
              // a scanned slip with exactly one usable match needs no second click
              void run(code).then(() => undefined);
            }}
            placeholder={t("voucher.searchPlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter" && usable.length === 1) {
                e.preventDefault();
                choose(usable[0]!);
              }
            }}
          />

          <div className="mt-2 max-h-[260px] overflow-y-auto rounded-[3px] border border-line">
            {rows.length === 0 ? (
              <div className="px-3 py-4 text-center text-[11px] text-subtle">
                {search.trim() === "" ? t("voucher.hint") : t("voucher.noMatches")}
              </div>
            ) : (
              rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  disabled={row.refusal !== null}
                  onClick={() => choose(row)}
                  className={cn(
                    "flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left last:border-b-0",
                    row.refusal === null ? "hover:bg-hover" : "cursor-default bg-surface-2 text-subtle",
                  )}
                >
                  <span className="w-[84px] flex-none font-mono text-[11px] tabular-nums">{row.docNumber}</span>
                  <span className="w-[72px] flex-none font-mono text-[12px] font-bold tabular-nums">
                    {formatCents(row.remainingCents)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px]">
                    {row.sellerName ?? ""}
                    <span className="ml-1.5 text-subtle">{formatDate(row.issuedAtMs)}</span>
                  </span>
                  {row.refusal === null ? (
                    <Chip variant="success">{t("voucher.usable")}</Chip>
                  ) : (
                    <span className="flex-none text-[10px]">{t(REFUSAL_KEYS[row.refusal])}</span>
                  )}
                </button>
              ))
            )}
          </div>

          {error ? <div className="mt-2 text-[11px] text-danger-ink">{error}</div> : null}
          <div className="mt-2 text-[10px] leading-snug text-subtle">{t("voucher.wholeOnly")}</div>
        </div>

        <div className="flex justify-end border-t border-line px-4 py-3">
          <GhostButton onClick={onCancel}>{t("common.cancel")}</GhostButton>
        </div>
      </div>

      {deciding ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50"
          onMouseDown={() => setDeciding(null)}
        >
          <div
            className="w-[420px] rounded-[3px] border border-line-strong bg-card shadow-lg"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="border-b border-line-strong bg-surface-2 px-4 py-2.5 text-[13px] font-bold">
              {t("voucher.biggerTitle")}
            </div>
            <div className="px-4 py-3 text-[12px] leading-snug text-ink-2">
              {t("voucher.biggerBody", {
                voucher: formatCents(deciding.remainingCents),
                total: formatCents(saleTotalCents),
                rest: formatCents(deciding.remainingCents - saleTotalCents),
              })}
            </div>
            <div className="flex flex-col gap-2 px-4 pb-3">
              {/* the shop's preference first, and the reason it is preferred is
                  written under it rather than assumed */}
              <AccentButton className="h-9" onClick={() => decide("keep_rest")}>
                {t("voucher.keepRest", { rest: formatCents(deciding.remainingCents - saleTotalCents) })}
              </AccentButton>
              <div className="-mt-1 text-[10px] text-subtle">
                {t("voucher.keepRestHint", { rest: formatCents(deciding.remainingCents - saleTotalCents) })}
              </div>
              <PrimaryButton className="h-9" onClick={() => decide("pay_out")}>
                {t("voucher.payOut", { rest: formatCents(deciding.remainingCents - saleTotalCents) })}
              </PrimaryButton>
              <div className="-mt-1 text-[10px] text-subtle">
                {t("voucher.payOutHint", { rest: formatCents(deciding.remainingCents - saleTotalCents) })}
              </div>
            </div>
            <div className="flex justify-end border-t border-line px-4 py-3">
              <GhostButton onClick={() => setDeciding(null)}>{t("common.cancel")}</GhostButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
