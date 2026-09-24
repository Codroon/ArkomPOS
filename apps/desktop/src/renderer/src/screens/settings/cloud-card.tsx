/**
 * Ajustes → Nube: linking this till to a Codroon account — ADR-0020.
 *
 * The card exists to answer three questions an owner actually asks: is this
 * till connected, is anything waiting to go up, and what went wrong if
 * something did. It never blocks and it never nags — a till with no line sells
 * all day and this panel is where that fact lives, rather than in a dialog over
 * somebody's sale.
 */
import { useCallback, useEffect, useState } from "react";
import { CloudStatusResponseSchema, type CloudStatus } from "@arkom/core";
import { AccentButton, Chip, Field, GhostButton, TextInput, useT } from "@arkom/ui";
import { errorMessage } from "../../lib/errors";
import { SettingsCard } from "./settings-card";

const stamp = (ms: number | null): string => {
  if (ms === null) return "—";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function CloudCard() {
  const t = useT();
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [url, setUrl] = useState("https://pos.codroon.com");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(() => {
    window.arkom
      .invoke("cloud:status", {})
      .then((raw) => setStatus(CloudStatusResponseSchema.parse(raw)))
      .catch((err) => console.error("cloud:status failed", err));
  }, []);

  useEffect(() => {
    read();
    /* the queue drains in the background, so the panel checks back while it is
       open — a shop watching it come back online should see it come back */
    const timer = setInterval(read, 15_000);
    return () => clearInterval(timer);
  }, [read]);

  const run = useCallback(
    async (channel: "cloud:enrol" | "cloud:unlink" | "cloud:syncNow", payload: unknown) => {
      setBusy(true);
      setError(null);
      try {
        const raw = await window.arkom.invoke(channel as "cloud:syncNow", payload as undefined);
        setStatus(CloudStatusResponseSchema.parse(raw));
        setCode("");
      } catch (err) {
        setError(errorMessage(t, err));
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  if (!status) return null;

  return (
    <SettingsCard title={t("set.cloudSection")}>
      {status.linked ? (
        <>
          <div className="flex items-baseline gap-2">
            <Chip variant={status.lastError ? "warning" : "success"}>
              {status.lastError ? t("set.cloudBehind") : t("set.cloudLinked")}
            </Chip>
            <span className="text-[12px] font-semibold">{status.shopName || status.accountName}</span>
          </div>

          <div className="flex flex-col gap-1 text-[12px]">
            <div className="flex justify-between">
              <span className="text-muted">{t("set.cloudPending")}</span>
              <span className="font-mono tabular-nums">{status.pending}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">{t("set.cloudLastPush")}</span>
              <span className="font-mono tabular-nums text-ink-2">{stamp(status.lastPushAtMs)}</span>
            </div>
          </div>

          {status.lastError ? (
            <div className="rounded-[3px] border border-warning-ink/25 bg-warning-bg px-2.5 py-2 text-[11px] leading-snug text-warning-ink">
              {t("set.cloudErrorHint")}
              <div className="mt-1 break-all font-mono text-[10px]">{status.lastError}</div>
            </div>
          ) : null}

          <div className="flex items-center gap-2 pt-1">
            <AccentButton disabled={busy || status.pushing} onClick={() => void run("cloud:syncNow", {})}>
              {status.pushing ? t("set.cloudSyncing") : t("set.cloudSyncNow")}
            </AccentButton>
            <GhostButton disabled={busy} onClick={() => void run("cloud:unlink", {})}>
              {t("set.cloudUnlink")}
            </GhostButton>
          </div>
          <div className="text-[11px] leading-snug text-subtle">{t("set.cloudUnlinkHint")}</div>
        </>
      ) : (
        <>
          <div className="text-[11px] leading-snug text-subtle">{t("set.cloudIntro")}</div>
          <Field label={t("set.cloudUrl")}>
            <TextInput mono value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <Field label={t("set.cloudCode")} hint={t("set.cloudCodeHint")}>
            <TextInput
              mono
              placeholder="XXXX-XXXX-XXXX"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={14}
            />
          </Field>
          {error ? <div className="text-[11px] leading-snug text-danger-ink">{error}</div> : null}
          <div className="pt-1">
            {/* the card's one blue element */}
            <AccentButton
              disabled={busy || code.trim().length < 12}
              onClick={() => void run("cloud:enrol", { url, code })}
            >
              {busy ? t("set.cloudLinking") : t("set.cloudLink")}
            </AccentButton>
          </div>
        </>
      )}
    </SettingsCard>
  );
}
