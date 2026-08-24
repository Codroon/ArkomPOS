/**
 * Ajustes → Copia de seguridad.
 *
 * Four things, and no fifth: when the last backup happened, take one now, open
 * the folder, and point a second copy at a USB stick. Restore is deliberately
 * absent — the note explains why rather than leaving a gap someone has to guess
 * about.
 */
import { useCallback, useEffect, useState } from "react";
import { BackupRunResponseSchema, BackupStatusResponseSchema, type BackupStatus } from "@arkom/core";
import { GhostButton, PrimaryButton, SectionLabel, useT } from "@arkom/ui";
import { errorMessage } from "../../lib/errors";

function formatWhen(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

export function BackupPanel({ say }: { say: (message: string, tone?: "neutral" | "danger") => void }) {
  const t = useT();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(BackupStatusResponseSchema.parse(await window.arkom.invoke("backup:status")));
    } catch (err) {
      console.error("backup:status failed", err);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const backupNow = useCallback(async () => {
    setBusy(true);
    try {
      const res = BackupRunResponseSchema.parse(await window.arkom.invoke("backup:now"));
      say(t("bk.done", { size: formatSize(res.sizeBytes) }));
      if (res.secondaryError) say(res.secondaryError, "danger");
      await refresh();
    } catch (err) {
      say(errorMessage(t, err), "danger");
    } finally {
      setBusy(false);
    }
  }, [refresh, say, t]);

  const openFolder = useCallback(() => {
    void window.arkom.invoke("backup:openFolder").catch((err) => say(errorMessage(t, err), "danger"));
  }, [say, t]);

  const chooseSecondary = useCallback(async () => {
    try {
      const { path } = (await window.arkom.invoke("backup:pickFolder")) as { path: string | null };
      if (!path) return; // cancelled
      await window.arkom.invoke("settings:save", { backupSecondaryPath: path });
      await refresh();
      say(t("set.saved"));
    } catch (err) {
      say(errorMessage(t, err), "danger");
    }
  }, [refresh, say, t]);

  const clearSecondary = useCallback(async () => {
    try {
      await window.arkom.invoke("settings:save", { backupSecondaryPath: "" });
      await refresh();
      say(t("set.saved"));
    } catch (err) {
      say(errorMessage(t, err), "danger");
    }
  }, [refresh, say, t]);

  if (!status) return null;

  return (
    <section className="col-span-2 flex flex-col gap-3 border-t border-line pt-4">
      <SectionLabel>{t("bk.section")}</SectionLabel>
      <div className="text-[11px] leading-snug text-muted">{t("bk.intro", { keep: String(status.keep) })}</div>

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[12px]">
        <span className="text-muted">{t("bk.last")}</span>
        <span className="font-mono font-medium tabular-nums text-ink">
          {status.lastAtMs > 0 ? formatWhen(status.lastAtMs) : t("bk.never")}
        </span>
        <span className="text-[11px] text-subtle">{t("bk.count", { n: String(status.count) })}</span>
      </div>

      <div className="flex items-center gap-2">
        <PrimaryButton disabled={busy} onClick={() => void backupNow()}>
          {busy ? t("bk.running") : t("bk.now")}
        </PrimaryButton>
        <GhostButton onClick={openFolder}>{t("bk.openFolder")}</GhostButton>
      </div>

      {/* second destination — the only protection against the machine itself */}
      <div className="flex flex-col gap-1.5 pt-1">
        <div className="text-[10px] font-bold uppercase tracking-[.1em] text-muted">{t("bk.secondary")}</div>
        {status.secondaryPath ? (
          <>
            <div className="break-all font-mono text-[10px] text-subtle">{status.secondaryPath}</div>
            <div className="flex items-center gap-2">
              <GhostButton onClick={() => void chooseSecondary()}>{t("bk.choose")}</GhostButton>
              <GhostButton onClick={() => void clearSecondary()}>{t("bk.clear")}</GhostButton>
            </div>
            <div className="text-[11px] text-subtle">{t("bk.secondarySet")}</div>
          </>
        ) : (
          <>
            <div className="max-w-[560px] rounded-[3px] border border-warning-ink/25 bg-warning-bg px-3 py-2 text-[11px] leading-snug text-warning-ink">
              {t("bk.secondaryNone")}
            </div>
            <div>
              <GhostButton onClick={() => void chooseSecondary()}>{t("bk.choose")}</GhostButton>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-1 pt-1">
        <div className="text-[10px] font-bold uppercase tracking-[.1em] text-muted">{t("bk.dbPath")}</div>
        <div className="break-all font-mono text-[10px] text-subtle">{status.databasePath}</div>
        <div className="break-all font-mono text-[10px] text-subtle">{status.dir}</div>
      </div>

      <div className="max-w-[620px] rounded-[3px] border border-line bg-surface-2 px-3 py-2">
        <div className="text-[11px] font-semibold text-ink-2">{t("bk.restoreTitle")}</div>
        <div className="mt-0.5 text-[11px] leading-snug text-muted">{t("bk.restoreBody")}</div>
      </div>
    </section>
  );
}
