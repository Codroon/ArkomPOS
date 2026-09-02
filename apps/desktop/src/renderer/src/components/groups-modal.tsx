/**
 * Grupos — the shop names its own shelves (ADR-0017).
 *
 * One thing happens here: a new group. There is no rename and no delete, and
 * deliberately no affordance hinting at either.
 *
 * Rename was built and then removed. It worked, but a name that products,
 * filters and two reports all read is not a field to edit casually, and every
 * way of presenting it was wrong in a different way: offering the display label
 * meant editing a word that is not in the database, and offering the stored one
 * meant handing a Spanish box to a shop reading English. Adding a group is the
 * thing that was actually asked for, and it has no such tail.
 *
 * A shelf whose name is wrong gets a new shelf. Moving the products onto it
 * needs a screen this phase does not have — the same seam delete has.
 */
import { useEffect, useRef, useState } from "react";
import { parseIpcError } from "@arkom/core";
import { AccentButton, GhostButton, TextInput, useT } from "@arkom/ui";
import { errorMessage } from "../lib/errors";
import { refreshGroups, useGroups } from "./group-picker";

export function GroupsModal({ onClose, canEdit }: { onClose: () => void; canEdit: boolean }) {
  const t = useT();
  const groups = useGroups();

  const [name, setName] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await window.arkom.invoke("catalog:createGroup", { name: trimmed, nameEn: nameEn.trim() || null });
      await refreshGroups();
      setName("");
      setNameEn("");
      inputRef.current?.focus();
    } catch (err) {
      /* the duplicate lands under the field, not in a toast: the shop is looking
         at the box it just typed into */
      setError(parseIpcError(err)?.code === "DUPLICATE_NAME" ? t("groups.duplicate") : errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse/40" onClick={onClose}>
      <div
        className="max-h-[80vh] w-[460px] overflow-hidden rounded-[3px] border border-line-strong bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center border-b border-line px-3.5 py-2.5">
          <div className="text-[13px] font-bold">{t("groups.title")}</div>
          <div className="flex-1" />
          <GhostButton onClick={onClose}>{t("common.close")}</GhostButton>
        </div>

        <div className="max-h-[52vh] overflow-y-auto">
          {groups.length === 0 ? (
            <div className="px-3.5 py-6 text-center text-[12px] text-muted">{t("groups.empty")}</div>
          ) : (
            groups.map((g) => (
              <div key={g.id} className="flex items-baseline gap-2 border-b border-line px-3.5 py-2">
                <div className="flex-1 truncate text-[12px]">{g.name}</div>
                {/* the English name, so the shop can see which shelves have one */}
                <div className="w-[45%] truncate text-[11px] text-muted">{g.nameEn ?? t("common.dash")}</div>
              </div>
            ))
          )}
        </div>

        {canEdit ? (
          <div className="border-t border-line-strong px-3.5 py-2.5">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
              {t("groups.newGroup")}
            </div>
            {/* Two names, because the app cannot invent the second one and the
                shop can. Leave English blank and the Spanish shows in both. */}
            <div className="mb-1.5 grid grid-cols-2 gap-2">
              <div>
                <div className="mb-0.5 text-[10px] text-muted">{t("groups.nameEs")}</div>
                <TextInput
                  ref={inputRef}
                  value={name}
                  maxLength={60}
                  placeholder={t("groups.namePlaceholder")}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && void submit()}
                />
              </div>
              <div>
                <div className="mb-0.5 text-[10px] text-muted">{t("groups.nameEn")}</div>
                <TextInput
                  value={nameEn}
                  maxLength={60}
                  placeholder={t("groups.nameEnPlaceholder")}
                  onChange={(e) => {
                    setNameEn(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && void submit()}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <AccentButton disabled={!name.trim() || busy} onClick={() => void submit()}>
                {t("groups.add")}
              </AccentButton>
            </div>
            {error ? <div className="mt-1 text-[11px] font-bold text-danger-ink">{error}</div> : null}
            {/* the seam, said out loud rather than left to be discovered */}
            <div className="mt-2 text-[10px] text-muted">{t("groups.noEdit")}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
