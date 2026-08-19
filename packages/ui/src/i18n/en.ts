/**
 * English dictionary — typed against the Spanish source's key map: a key
 * missing here (or an extra one) fails `tsc` (ADR-0011).
 */
import type { TKey } from "./es";

export const en: Record<TKey, string> = {
  /* shell */
  "shell.brand": "ARKOM",
  "shell.brandSuffix": "POS",
  "shell.menu": "MENU",
  "shell.noContext": "No context — pnpm db:seed",
  "shell.underConstruction": "Screen under construction — Phase 1",
  "shell.localeToggle": "Switch interface language",

  /* nav */
  "nav.venta": "Sale",
  "nav.catalogo": "Catalog",
  "nav.inventario": "Inventory",
  "nav.compraUsados": "Buy used",
  "nav.unidadUsada": "Used unit",
  "nav.reparacion": "Repair",
  "nav.taller": "Workshop / Schedule",
  "nav.transferencias": "Transfers",
  "nav.caja": "Cash",
  "nav.informes": "Reports",
  "nav.ajustes": "Settings",

  /* shared */
  "common.lock": "LOCK",
  "common.comingSoon": "Coming soon",
  "common.save": "Save",
  "common.saving": "Saving…",
  "common.cancel": "Cancel",
  "common.clear": "Clear",
  "common.yes": "Yes",
  "common.no": "No",
  "common.dash": "—",

  /* chips */
  "chip.falta": "MISSING",
  "chip.inactive": "INACTIVE",
  "chip.stock": "STOCK",
  "chip.serie": "SERIAL",

  /* catalog */
  "catalog.title": "Catalog",
  "catalog.count": "{n} items",
  "catalog.searchPlaceholder": "Search or scan a product…",
  "catalog.new": "+ New item",
  "catalog.filter.groupAll": "Group: all",
  "catalog.filter.typeAll": "Type: all",
  "catalog.filter.stocked": "Stock",
  "catalog.filter.serialized": "Serialized",
  "catalog.filter.lowStock": "Below minimum",
  "catalog.filter.missingData": "Missing data",
  "catalog.filter.activeOne": "1 active filter",
  "catalog.filter.activeMany": "{n} active filters",
  "catalog.noResults": "No results",
  "catalog.clearFilters": "Clear filters",
  "catalog.saveFailed": "Could not save. Check the console.",

  /* catalog table */
  "catalog.col.code": "Code",
  "catalog.col.name": "Name",
  "catalog.col.group": "Group",
  "catalog.col.type": "Type",
  "catalog.col.cost": "Cost",
  "catalog.col.price": "Price",
  "catalog.col.tax": "VAT",
  "catalog.col.stock": "Stock",

  /* catalog editor */
  "editor.editTitle": "Edit item",
  "editor.newTitle": "New item",
  "editor.emptyTitle": "Select an item",
  "editor.emptyHint": "or create one with “+ New item”.",
  "editor.name": "Name",
  "editor.namePlaceholder": "Item name",
  "editor.barcode": "Barcode",
  "editor.barcodePlaceholder": "Scan or type",
  "editor.generate": "Generate",
  "editor.barcodeHint": "Empty = generated on save.",
  "editor.group": "Group",
  "editor.groupPlaceholder": "— Select —",
  "editor.cost": "Cost",
  "editor.price": "Price",
  "editor.tax": "VAT",
  "editor.tax21": "21%",
  "editor.tax10Soon": "10% — coming soon",
  "editor.tax4Soon": "4% — coming soon",
  "editor.taxRebuSoon": "REBU — coming soon",
  "editor.taxExemptSoon": "Exempt — coming soon",
  "editor.margin": "Computed margin:",
  "editor.itemType": "Item type",
  "editor.type.stocked": "Stock",
  "editor.type.serialized": "Serialized",
  "editor.type.used": "Used",
  "editor.type.service": "Service",
  "editor.type.repair": "Repair",
  "editor.type.agency": "Agency",
  "editor.serializedHint": "Requires an IMEI per unit at sale time.",
  "editor.reorderPoint": "Reorder point",
  "editor.lowStockThreshold": "Low-stock threshold",
  "editor.active": "Active",
  "editor.inactiveHint": "An inactive item can't be sold or receive stock; its history is kept.",
  "editor.delete": "Delete",
  "editor.deleteLockedHint": "Items with movements are never deleted; deactivate via “Active”.",
  "editor.moneyPlaceholder": "0.00",

  /* dirty guard */
  "dirty.title": "Discard changes?",
  "dirty.body": "The editor has unsaved changes.",
  "dirty.discard": "Discard",
  "dirty.keepEditing": "Keep editing",

  /* validation (client, req 4.1/4.5) */
  "val.nameRequired": "Name is required.",
  "val.groupRequired": "Group is required.",
  "val.costRequired": "Cost is required.",
  "val.priceRequired": "Price is required.",
  "val.taxRequired": "VAT is required.",
  "val.invalidAmount": "Invalid amount.",
  "val.intGteZero": "Integer ≥ 0.",

  /* typed server errors mapped by code (§4) */
  "err.duplicateName": "An item with that name already exists.",
  "err.duplicateBarcode": "That barcode already exists.",
};
