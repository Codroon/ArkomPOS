/**
 * UI dictionary — Spanish, the source of truth (ADR-0011). Every staff-visible
 * string in the renderer lives here; `en.ts` must satisfy the same key map or
 * typecheck fails. Interpolation: {name} placeholders via translate().
 *
 * UI locale ONLY: the print path (tickets, Day 9) always renders from fixed
 * Spanish strings and must never read this dictionary through useT().
 */
export const es = {
  /* shell */
  "shell.brand": "ARKOM",
  "shell.brandSuffix": "POS",
  "shell.menu": "MENU",
  "shell.noContext": "Sin contexto — pnpm db:seed",
  "shell.underConstruction": "Pantalla en construcción — Fase 1",
  "shell.localeToggle": "Cambiar idioma de la interfaz",

  /* nav */
  "nav.venta": "Venta",
  "nav.catalogo": "Catálogo",
  "nav.inventario": "Inventario",
  "nav.compraUsados": "Compra usados",
  "nav.unidadUsada": "Unidad usada",
  "nav.reparacion": "Reparación",
  "nav.taller": "Taller / Agenda",
  "nav.transferencias": "Transferencias",
  "nav.caja": "Caja",
  "nav.informes": "Informes",
  "nav.ajustes": "Ajustes",

  /* shared */
  "common.lock": "LOCK",
  "common.comingSoon": "Próximamente",
  "common.save": "Guardar",
  "common.saving": "Guardando…",
  "common.cancel": "Cancelar",
  "common.clear": "Limpiar",
  "common.yes": "Sí",
  "common.no": "No",
  "common.dash": "—",

  /* chips */
  "chip.falta": "FALTA",
  "chip.inactive": "INACTIVO",
  "chip.stock": "STOCK",
  "chip.serie": "SERIE",

  /* catalog */
  "catalog.title": "Catálogo",
  "catalog.count": "{n} artículos",
  "catalog.searchPlaceholder": "Buscar o escanear producto…",
  "catalog.new": "+ Nuevo artículo",
  "catalog.filter.groupAll": "Grupo: todos",
  "catalog.filter.typeAll": "Tipo: todos",
  "catalog.filter.stocked": "Stock",
  "catalog.filter.serialized": "Serializado",
  "catalog.filter.lowStock": "Bajo mínimo",
  "catalog.filter.missingData": "Datos incompletos",
  "catalog.filter.activeOne": "1 filtro activo",
  "catalog.filter.activeMany": "{n} filtros activos",
  "catalog.noResults": "Sin resultados",
  "catalog.clearFilters": "Limpiar filtros",
  "catalog.saveFailed": "No se pudo guardar. Revisa la consola.",

  /* catalog table */
  "catalog.col.code": "Código",
  "catalog.col.name": "Nombre",
  "catalog.col.group": "Grupo",
  "catalog.col.type": "Tipo",
  "catalog.col.cost": "Coste",
  "catalog.col.price": "PVP",
  "catalog.col.tax": "IVA",
  "catalog.col.stock": "Stock",

  /* catalog editor */
  "editor.editTitle": "Editar artículo",
  "editor.newTitle": "Nuevo artículo",
  "editor.emptyTitle": "Selecciona un artículo",
  "editor.emptyHint": "o crea uno con “+ Nuevo artículo”.",
  "editor.name": "Nombre",
  "editor.namePlaceholder": "Nombre del artículo",
  "editor.barcode": "Código de barras",
  "editor.barcodePlaceholder": "Escanear o escribir",
  "editor.generate": "Generar",
  "editor.barcodeHint": "Vacío = se genera al guardar.",
  "editor.group": "Grupo",
  "editor.groupPlaceholder": "— Selecciona —",
  "editor.cost": "Coste",
  "editor.price": "PVP",
  "editor.tax": "IVA",
  "editor.tax21": "21%",
  "editor.tax10Soon": "10% — próximamente",
  "editor.tax4Soon": "4% — próximamente",
  "editor.taxRebuSoon": "REBU — próximamente",
  "editor.taxExemptSoon": "Exento — próximamente",
  "editor.margin": "Margen calculado:",
  "editor.itemType": "Tipo de artículo",
  "editor.type.stocked": "Stock",
  "editor.type.serialized": "Serializado",
  "editor.type.used": "Usado",
  "editor.type.service": "Servicio",
  "editor.type.repair": "Reparación",
  "editor.type.agency": "Agencia",
  "editor.serializedHint": "Requiere IMEI por unidad en la venta.",
  "editor.reorderPoint": "Punto de pedido",
  "editor.lowStockThreshold": "Umbral bajo stock",
  "editor.active": "Activo",
  "editor.inactiveHint": "Un artículo inactivo no se puede vender ni recibir stock; conserva su historial.",
  "editor.delete": "Eliminar",
  "editor.deleteLockedHint": "Los artículos con movimientos no se eliminan; desactívalo con «Activo».",
  "editor.moneyPlaceholder": "0,00",

  /* dirty guard */
  "dirty.title": "¿Descartar cambios?",
  "dirty.body": "Hay cambios sin guardar en el editor.",
  "dirty.discard": "Descartar",
  "dirty.keepEditing": "Seguir editando",

  /* validation (client, req 4.1/4.5) */
  "val.nameRequired": "El nombre es obligatorio.",
  "val.groupRequired": "El grupo es obligatorio.",
  "val.costRequired": "El coste es obligatorio.",
  "val.priceRequired": "El PVP es obligatorio.",
  "val.taxRequired": "El IVA es obligatorio.",
  "val.invalidAmount": "Importe no válido.",
  "val.intGteZero": "Entero ≥ 0.",

  /* typed server errors mapped by code (§4) */
  "err.duplicateName": "Ya existe un artículo con ese nombre.",
  "err.duplicateBarcode": "Ese código de barras ya existe.",
  "err.duplicateImei": "Ese IMEI ya está registrado.",

  /* inventory */
  "inv.title": "Inventario",
  "inv.valuation": "Valoración total",
  "inv.valuationSuffix": "(a coste)",
  "inv.belowMinOne": "1 artículo bajo mínimo",
  "inv.belowMinMany": "{n} artículos bajo mínimo",
  "inv.searchPlaceholder": "Buscar por nombre o código…",
  "inv.col.item": "Artículo",
  "inv.col.qty": "Cantidad",
  "inv.col.reorder": "Punto de pedido",
  "inv.col.status": "Estado",
  "inv.col.unitCost": "Coste unitario",
  "inv.col.valuation": "Valoración",
  "inv.ok": "OK",
  "chip.bajoMinimo": "BAJO MÍNIMO",
  "scan.kbd": "SCAN",

  /* movements drawer */
  "drawer.title": "Movimientos",
  "drawer.onHand": "{n} en stock",
  "drawer.col.date": "Fecha",
  "drawer.col.type": "Tipo",
  "drawer.col.qty": "Cantidad",
  "drawer.col.cost": "Coste",
  "drawer.col.doc": "Documento",
  "drawer.col.user": "Usuario",
  "drawer.footerNote": "El stock solo cambia mediante movimientos.",
  "drawer.empty": "Sin movimientos.",
  "mov.entrada": "ENTRADA",
  "mov.venta": "VENTA",
  "mov.ajuste": "AJUSTE",

  /* entrada de stock */
  "entry.section": "Entrada de stock",
  "entry.scanPlaceholder": "Escanea código o introduce IMEI…",
  "entry.unknownCode": "No existe",
  "entry.createArticle": "Crear artículo",
  "entry.unitCost": "Coste por unidad",
  "entry.qty": "Cantidad",
  "entry.imei": "IMEI",
  "entry.imeiPlaceholder": "15 dígitos",
  "entry.supplier": "Proveedor",
  "entry.supplierPlaceholder": "— Selecciona —",
  "entry.newSupplier": "Nuevo proveedor",
  "entry.newSupplierPlaceholder": "Nombre del proveedor",
  "entry.addLine": "Añadir",
  "entry.removeLine": "Quitar línea",
  "entry.confirm": "Confirmar entrada",
  "entry.toastOne": "Entrada registrada · 1 línea",
  "entry.toastMany": "Entrada registrada · {n} líneas",
  "val.qtyMin1": "Entero ≥ 1.",
  "val.imeiInvalid": "IMEI no válido (15 dígitos).",
  "val.imeiDupStaged": "Ese IMEI ya está en la entrada.",
  "val.supplierRequired": "El proveedor es obligatorio.",
} as const;

export type TKey = keyof typeof es;
