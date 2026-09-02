/**
 * Reparaciones (nav 06) — handoff/repairs.md §1.
 *
 * There is no route table in this app, so "the list", "one ficha" and "a new
 * intake" are three states of one screen — the same pattern Dispositivos usados
 * uses. Two tabs in the header: Fichas and Piezas por pedir.
 */
import { useCallback, useEffect, useState } from "react";
import { PrimaryButton, cn, useT } from "@arkom/ui";
import { useCan } from "../../lib/use-session";
import { consumeRepairTarget } from "../../lib/screen-bus";
import { RepairIntakeScreen } from "./repair-intake-screen";
import { RepairList } from "./repair-list";
import { RepairDetailPane } from "./repair-detail";
import { PartsToOrder } from "./parts-to-order";

type View = { kind: "list" } | { kind: "intake" } | { kind: "detail"; ticketId: string };
type Tab = "tickets" | "parts";

export function RepairsScreen() {
  const t = useT();
  const can = useCan();
  const [tab, setTab] = useState<Tab>("tickets");
  const [view, setView] = useState<View>({ kind: "list" });
  /* bumped by anything that changes a ticket, so the list behind the ficha is
     never stale when you come back to it */
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const bump = useCallback(() => setRefreshKey((n) => n + 1), []);


  /* arriving from a Documento link in Inventario */
  useEffect(() => {
    const target = consumeRepairTarget();
    if (target) {
      setTab("tickets");
      setView({ kind: "detail", ticketId: target });
    }
  }, []);

  if (view.kind === "intake") {
    return (
      <RepairIntakeScreen
        onDone={(ticketId) => {
          bump();
          setView(ticketId ? { kind: "detail", ticketId } : { kind: "list" });
        }}
      />
    );
  }

  if (view.kind === "detail") {
    return (
      <RepairDetailPane
        ticketId={view.ticketId}
        onBack={() => setView({ kind: "list" })}
        onChanged={bump}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-3 border-b border-line-strong bg-surface px-4 py-2.5">
        <div className="text-[15px] font-bold">{t("rep.title")}</div>
        <div className="flex overflow-hidden rounded-[3px] border border-line-strong">
          {(
            [
              ["tickets", t("rep.tabs.tickets")],
              ["parts", t("rep.tabs.parts")],
            ] as ReadonlyArray<[Tab, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={cn(
                "border-r border-line px-3 py-1 text-[12px] last:border-r-0",
                tab === value ? "bg-ink font-semibold text-inverse-ink" : "bg-card text-ink-2 hover:bg-hover",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {can("repair.create") ? (
          /* graphite, not blue: the blue on this flow belongs to the intake
             form's submit, one surface along (handoff 00) */
          <PrimaryButton onClick={() => setView({ kind: "intake" })}>{t("rep.new")}</PrimaryButton>
        ) : null}
      </div>

      {notice ? (
        <div className="flex-none border-b border-line bg-success-bg px-4 py-1.5 text-[11px] text-success-ink">
          {notice}
        </div>
      ) : null}

      {tab === "tickets" ? (
        <RepairList
          refreshKey={refreshKey}
          onOpen={(ticketId) => setView({ kind: "detail", ticketId })}
        />
      ) : (
        <PartsToOrder
          refreshKey={refreshKey}
          onOpenTicket={(ticketId) => {
            setTab("tickets");
            setView({ kind: "detail", ticketId });
          }}
          onChanged={(message) => {
            setNotice(message);
            bump();
            setTimeout(() => setNotice(null), 6000);
          }}
        />
      )}
    </div>
  );
}
