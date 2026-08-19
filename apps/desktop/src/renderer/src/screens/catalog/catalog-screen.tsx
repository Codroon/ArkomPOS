/**
 * Catálogo — handoff 02. Header (title + count + search + Nuevo artículo),
 * filter row (Grupo · Tipo · Bajo mínimo · Datos incompletos, combinable),
 * list table + 380px editor. Dirty guard on row switch ("¿Descartar cambios?").
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseIpcError, type CatalogListRequest, type EntityRef, type ProductRow } from "@arkom/core";
import { cn, ConfirmDialog, GhostButton, PrimaryButton, SearchInput } from "@arkom/ui";
import { CatalogEditor } from "./catalog-editor";
import { CatalogTable, type Sort, type SortKey } from "./catalog-table";
import {
  draftFromRow,
  emptyDraft,
  isDirty,
  serverErrorToDraftErrors,
  validateDraft,
  type Draft,
  type DraftErrors,
} from "./model";

interface Filters {
  groupId: string;
  itemType: "" | "stocked" | "serialized";
  lowStockOnly: boolean;
  missingDataOnly: boolean;
}

const NO_FILTERS: Filters = { groupId: "", itemType: "", lowStockOnly: false, missingDataOnly: false };

function FilterChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-6 rounded-[3px] border px-2 text-[11px] font-bold",
        active
          ? "border-ink-2 bg-ink-2 text-white"
          : "border-border-input bg-card text-ink-2 hover:border-ink-3",
      )}
    >
      {children}
    </button>
  );
}

export function CatalogScreen() {
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [groups, setGroups] = useState<EntityRef[]>([]);
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState(""); // debounced, ≥2 chars
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<Sort>({ key: "name", dir: 1 });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState<Draft | null>(null);
  const [serverErrors, setServerErrors] = useState<DraftErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const dirty = draft !== null && isDirty(draft, baseline);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // debounce the search box (150ms, ≥2 chars = server filter)
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchText.trim().length >= 2 ? searchText.trim() : ""), 150);
    return () => clearTimeout(t);
  }, [searchText]);

  const refresh = useCallback(async () => {
    const request: CatalogListRequest = {
      search: search || undefined,
      groupId: filters.groupId || undefined,
      itemType: filters.itemType || undefined,
      lowStockOnly: filters.lowStockOnly || undefined,
      missingDataOnly: filters.missingDataOnly || undefined,
    };
    setRows(await window.arkom.invoke("catalog:list", request));
  }, [search, filters]);

  useEffect(() => {
    refresh().catch((err) => console.error("catalog:list failed", err));
  }, [refresh]);

  useEffect(() => {
    window.arkom
      .invoke("catalog:groups")
      .then(setGroups)
      .catch((err) => console.error("catalog:groups failed", err));
  }, []);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let cmp: number;
      if (sort.key === "name") cmp = a.name.localeCompare(b.name, "es");
      else if (sort.key === "priceCents") cmp = (a.priceCents ?? -1) - (b.priceCents ?? -1);
      else cmp = a.onHand - b.onHand;
      return cmp * sort.dir;
    });
    return copy;
  }, [rows, sort]);

  const openDraft = useCallback((next: Draft) => {
    setDraft(next);
    setBaseline(next); // new drafts baseline against the empty form: pristine until typed
    setServerErrors({});
    setGeneralError(null);
  }, []);

  /** Runs action now, or after the "¿Descartar cambios?" confirm when dirty. */
  const guarded = useCallback((action: () => void) => {
    if (dirtyRef.current) setPendingAction(() => action);
    else action();
  }, []);

  const loadRow = useCallback(
    (id: string) => {
      window.arkom
        .invoke("catalog:get", { id })
        .then((row) => openDraft(draftFromRow(row)))
        .catch((err) => console.error("catalog:get failed", err));
    },
    [openDraft],
  );

  const onSelect = useCallback((row: ProductRow) => guarded(() => loadRow(row.id)), [guarded, loadRow]);
  const onNew = useCallback(() => guarded(() => openDraft(emptyDraft())), [guarded, openDraft]);

  // field-level messages (req 4.1) appear once the user edits; server errors always
  const clientErrors = draft ? validateDraft(draft).errors : {};
  const visibleErrors: DraftErrors = { ...(dirty ? clientErrors : {}), ...serverErrors };
  const valid = draft !== null && validateDraft(draft).request !== null;

  const onSave = useCallback(() => {
    if (!draft) return;
    const { request } = validateDraft(draft);
    if (!request) return;
    setSaving(true);
    setServerErrors({});
    setGeneralError(null);
    window.arkom
      .invoke("catalog:save", request)
      .then((saved) => {
        openDraft(draftFromRow(saved));
        return refresh();
      })
      .catch((err) => {
        const ipc = parseIpcError(err);
        if (ipc) {
          const { field, message } = serverErrorToDraftErrors(ipc);
          if (field) setServerErrors({ [field]: message });
          else setGeneralError(message);
        } else {
          console.error("catalog:save failed", err);
          setGeneralError("No se pudo guardar. Revisa la consola.");
        }
      })
      .finally(() => setSaving(false));
  }, [draft, openDraft, refresh]);

  const onCancel = useCallback(() => {
    if (draft?.id && baseline) {
      setDraft(baseline); // revert edits on an existing row
      setServerErrors({});
      setGeneralError(null);
    } else {
      setDraft(null); // close a create form
      setBaseline(null);
    }
  }, [draft, baseline]);

  const activeFilterCount =
    (filters.groupId ? 1 : 0) +
    (filters.itemType ? 1 : 0) +
    (filters.lowStockOnly ? 1 : 0) +
    (filters.missingDataOnly ? 1 : 0) +
    (search ? 1 : 0);

  const clearFilters = () => {
    setFilters(NO_FILTERS);
    setSearchText("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* header */}
      <div className="flex flex-none items-center gap-3 border-b border-border-strong bg-panel px-4 py-2.5">
        <div className="text-[15px] font-bold">Catálogo</div>
        <div className="text-[11px] text-muted">{rows.length} artículos</div>
        <div className="flex-1" />
        <SearchInput
          className="w-[260px]"
          placeholder="Buscar o escanear producto…"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        <PrimaryButton onClick={onNew}>+ Nuevo artículo</PrimaryButton>
      </div>

      {/* filters row */}
      <div className="flex flex-none items-center gap-2 border-b border-border bg-panel-2 px-4 py-2">
        <select
          value={filters.groupId}
          onChange={(e) => setFilters((f) => ({ ...f, groupId: e.target.value }))}
          className="h-6 rounded-[3px] border border-border-input bg-card px-1.5 text-[11px] text-ink-2 outline-none"
        >
          <option value="">Grupo: todos</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <select
          value={filters.itemType}
          onChange={(e) => setFilters((f) => ({ ...f, itemType: e.target.value as Filters["itemType"] }))}
          className="h-6 rounded-[3px] border border-border-input bg-card px-1.5 text-[11px] text-ink-2 outline-none"
        >
          <option value="">Tipo: todos</option>
          <option value="stocked">Stock</option>
          <option value="serialized">Serializado</option>
        </select>
        <FilterChip
          active={filters.lowStockOnly}
          onClick={() => setFilters((f) => ({ ...f, lowStockOnly: !f.lowStockOnly }))}
        >
          Bajo mínimo
        </FilterChip>
        <FilterChip
          active={filters.missingDataOnly}
          onClick={() => setFilters((f) => ({ ...f, missingDataOnly: !f.missingDataOnly }))}
        >
          Datos incompletos
        </FilterChip>
        <div className="flex-1" />
        {activeFilterCount > 0 ? (
          <>
            <span className="text-[11px] text-muted">
              {activeFilterCount} {activeFilterCount === 1 ? "filtro activo" : "filtros activos"}
            </span>
            <GhostButton className="h-6 px-2 text-[11px]" onClick={clearFilters}>
              Limpiar
            </GhostButton>
          </>
        ) : null}
      </div>

      {/* body: table + editor */}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto bg-card">
          {sorted.length > 0 ? (
            <CatalogTable
              rows={sorted}
              selectedId={draft?.id ?? null}
              onSelect={onSelect}
              sort={sort}
              onSort={(key: SortKey) =>
                setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }))
              }
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <div className="text-[12px] text-muted">Sin resultados</div>
                <GhostButton className="mt-2" onClick={clearFilters}>
                  Limpiar filtros
                </GhostButton>
              </div>
            </div>
          )}
        </div>
        <aside className="flex w-[380px] flex-none flex-col border-l border-border-strong bg-panel">
          <CatalogEditor
            draft={draft}
            errors={visibleErrors}
            groups={groups}
            canSave={dirty && valid}
            saving={saving}
            generalError={generalError}
            onPatch={(patch) => {
              setDraft((d) => (d ? { ...d, ...patch } : d));
              setServerErrors({});
            }}
            onSave={onSave}
            onCancel={onCancel}
          />
        </aside>
      </div>

      <ConfirmDialog
        open={pendingAction !== null}
        title="¿Descartar cambios?"
        body="Hay cambios sin guardar en el editor."
        confirmLabel="Descartar"
        cancelLabel="Seguir editando"
        onConfirm={() => {
          pendingAction?.();
          setPendingAction(null);
        }}
        onCancel={() => setPendingAction(null)}
      />
    </div>
  );
}
