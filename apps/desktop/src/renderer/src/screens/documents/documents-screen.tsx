/**
 * Documentos — everything this till has issued, in one flat list (v0.17.0).
 *
 * Read-only, and deliberately so. Each screen already shows the documents it
 * owns — a repair's receipts, a shift's Z, the ticket behind an inventory
 * movement — and every one of them opens the same peek. What was missing is the
 * question no screen answers: "what did we issue on Tuesday?"
 *
 * A row opens the standard document peek, which is where Reprint and Save PDF
 * live. That is the whole reason this screen is thirty lines of table and not a
 * viewer of its own.
 */
import { useCallback, useEffect, useState } from "react";
import { formatCents } from "@arkom/core";
import { Chip, SearchInput, SelectInput, TextInput, cn, useT, type TKey } from "@arkom/ui";
import { TicketPeekModal } from "../../components/ticket-peek-modal";
import { PurchasePeekModal } from "../../components/purchase-peek-modal";

interface Row {
  id: string;
  docNumber: string;
  docType: string;
  completedAtMs: number | null;
  totalCents: number;
  userName: string | null;
}

const TYPE_LABEL: Record<string, TKey> = {
  ticket: "docs.type.ticket",
  purchase: "docs.type.purchase",
  repair: "docs.type.repair",
  refund: "docs.type.refund",
};

function stamp(ms: number | null): string {
  if (ms === null) return "—";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** yyyy-mm-dd for a date input, from a timestamp. */
const dayValue = (ms: number | null) => (ms === null ? "" : new Date(ms).toISOString().slice(0, 10));

export function DocumentsScreen() {
  const t = useT();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [docType, setDocType] = useState("");
  const [search, setSearch] = useState("");
  const [fromMs, setFromMs] = useState<number | null>(null);
  const [toMs, setToMs] = useState<number | null>(null);
  const [peek, setPeek] = useState<Row | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await window.arkom.invoke("docs:list", {
        docType: docType || null,
        search: search.trim() || null,
        fromMs,
        /* the picker gives a DAY, and a document at 18:40 belongs to it — so the
           upper bound is the end of that day, not its midnight */
        toMs: toMs === null ? null : toMs + 86_400_000,
        limit: 200,
      });
      setRows(res.rows);
      setTruncated(res.truncated);
    } catch (err) {
      console.error("docs:list failed", err);
      setRows([]);
    }
  }, [docType, search, fromMs, toMs]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-baseline gap-2 border-b border-line-strong bg-surface-2 px-4 py-2.5">
        <h1 className="text-[15px] font-semibold">{t("docs.title")}</h1>
        <span className="text-[11px] text-muted">{t("docs.subtitle")}</span>
      </div>

      <div className="flex flex-none items-center gap-2 border-b border-line bg-surface-2 px-4 py-2">
        <SelectInput className="h-6 w-[150px] text-[11px]" value={docType} onChange={(e) => setDocType(e.target.value)}>
          <option value="">{t("docs.type.all")}</option>
          {Object.entries(TYPE_LABEL).map(([k, key]) => (
            <option key={k} value={k}>
              {t(key)}
            </option>
          ))}
        </SelectInput>
        <TextInput
          className="h-6 w-[130px] text-[11px]"
          type="date"
          value={dayValue(fromMs)}
          onChange={(e) => setFromMs(e.target.value ? new Date(e.target.value).getTime() : null)}
        />
        <TextInput
          className="h-6 w-[130px] text-[11px]"
          type="date"
          value={dayValue(toMs)}
          onChange={(e) => setToMs(e.target.value ? new Date(e.target.value).getTime() : null)}
        />
        <div className="flex-1" />
        <SearchInput
          className="w-[240px]"
          placeholder={t("docs.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows === null ? null : rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12px] text-muted">{t("docs.empty")}</div>
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-surface-2 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
              <tr>
                <th className="px-4 py-1.5 text-left">{t("docs.col.number")}</th>
                <th className="px-2 py-1.5 text-left">{t("docs.col.type")}</th>
                <th className="px-2 py-1.5 text-left">{t("docs.col.when")}</th>
                <th className="px-2 py-1.5 text-right">{t("docs.col.total")}</th>
                <th className="px-2 py-1.5 text-left">{t("docs.col.user")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setPeek(r)}
                  className={cn("cursor-pointer border-b border-line hover:bg-surface", r.docType === "refund" && "text-ink-2")}
                >
                  <td className="px-4 py-1.5 font-mono font-medium tabular-nums">{r.docNumber}</td>
                  <td className="px-2 py-1.5">
                    <Chip variant={r.docType === "refund" ? "warning" : undefined}>
                      {t(TYPE_LABEL[r.docType] ?? "common.dash")}
                    </Chip>
                  </td>
                  <td className="px-2 py-1.5 font-mono tabular-nums text-ink-2">{stamp(r.completedAtMs)}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatCents(r.totalCents)}</td>
                  <td className="px-2 py-1.5 text-ink-2">{r.userName ?? t("common.dash")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {truncated ? (
          <div className="px-4 py-2 text-center text-[11px] text-subtle">{t("docs.truncated")}</div>
        ) : null}
      </div>

      {/* the SAME peek every other screen opens, so Reprint and Save PDF are
          here without this screen knowing they exist */}
      {peek?.docType === "purchase" ? (
        <PurchasePeekModal documentId={peek.id} onClose={() => setPeek(null)} />
      ) : peek ? (
        <TicketPeekModal docId={peek.id} onClose={() => setPeek(null)} />
      ) : null}
    </div>
  );
}
