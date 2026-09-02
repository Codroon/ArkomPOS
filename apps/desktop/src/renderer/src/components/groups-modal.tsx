/**
 * Grupos — the shop names its own shelves (ADR-0017).
 *
 * Two things happen here and nothing else: create one, rename one. There is no
 * delete, and deliberately no affordance hinting at one — a group with fifty
 * products behind it cannot go without somebody deciding where those products
 * land, and that decision needs a screen this phase does not have. A button
 * that refuses half the time is worse than no button.
 *
 * A rename needs no propagation: every product points at the group's id, so the
 * catalog list, the inventory filter and both stock reports read the new name
 * the next time they ask.
 */
import { useEffect, useRef, useState } from "react";
import { parseIpcError, type EntityRef } from "@arkom/core";
import { AccentButton, GhostButton, TextInput, useDataLabel, useT } from "@arkom/ui";
import { errorMessage } from "../lib/errors";
import { refreshGroups, useGroups } from "./group-picker";

export function GroupsModal({ onClose, canEdit }: { onClose: () => void; canEdit: boolean }) {
  const t = useT();
  const dataLabel = useDataLabel();
  const groups = useGroups();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [editingId]);

  const startNew = () => {
    setEditingId(null);
    setName("");
    setError(null);
    inputRef.current?.focus();
  };

  const startRename = (group: EntityRef) => {
    setEditingId(group.id);
    setName(group.name);
    setError(null);
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (editingId) await window.arkom.invoke("catalog:renameGroup", { id: editingId, name: trimmed });
      else await window.arkom.invoke("catalog:createGroup", { name: trimmed });
      await refreshGroups();
      setEditingId(null);
      setName("");
    } catch (err) {
      /* the duplicate lands under the field, not in a toast: the shop is looking
         at the box it just typed into */
      setError(
        parseIpcError(err)?.code === "DUPLICATE_NAME" ? t("groups.duplicate") : errorMessage(t, err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse/40" onClick={onClose}>
      <div
        className="max-h-[80vh] w-[420px] overflow-hidden rounded-[3px] border border-line-strong bg-card shadow-lg"
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
              <div key={g.id} className="flex items-center gap-2 border-b border-line px-3.5 py-2">
                <div className="flex-1 truncate text-[12px]">{dataLabel(g.name)}</div>
                {canEdit ? (
                  <GhostButton onClick={() => startRename(g)}>{t("groups.rename")}</GhostButton>
                ) : null}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-line-strong px-3.5 py-2.5">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
            {editingId ? t("groups.renaming") : t("groups.newGroup")}
          </div>
          <div className="flex items-center gap-2">
            <TextInput
              ref={inputRef}
              className="flex-1"
              value={name}
              maxLength={60}
              placeholder={t("groups.namePlaceholder")}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
                if (e.key === "Escape" && editingId) startNew();
              }}
            />
            {editingId ? <GhostButton onClick={startNew}>{t("common.cancel")}</GhostButton> : null}
            <AccentButton disabled={!name.trim() || busy} onClick={() => void submit()}>
              {editingId ? t("common.save") : t("groups.add")}
            </AccentButton>
          </div>
          {error ? <div className="mt-1 text-[11px] font-bold text-danger-ink">{error}</div> : null}
          {/* the seam, said out loud rather than left to be discovered */}
          <div className="mt-2 text-[10px] text-muted">{t("groups.noDelete")}</div>
        </div>
      </div>
    </div>
  );
}
