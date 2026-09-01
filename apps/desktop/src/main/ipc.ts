/**
 * IPC handlers — contract in docs/design/system-design.md §4, schemas in
 * @arkom/core ipc.ts. Every request AND response is Zod-parsed here; failures
 * cross the bridge as typed envelopes (the renderer maps codes, never strings).
 * Handlers do no business math — that lives in core; writes go through mutate().
 *
 * ## The guard (ADR-0012 §5)
 *
 * Since v0.10.0 a channel is registered in exactly one of three ways, and the
 * choice is visible at the call site so a channel cannot be left open by
 * forgetting something:
 *
 *   open(...)    — no session needed. The allow-list, and it is short.
 *   authed(...)  — a session, but no particular permission.
 *   guarded(...) — a session holding a named permission.
 *
 * A guarded handler receives the session as its first argument, carrying a
 * `ctx` already stamped with the actor. Handlers never build a MutationCtx
 * themselves, which is how "the audit trail records the session, never the
 * payload" stops being a convention and becomes the only available path.
 *
 * `ipc-registry.test.ts` fails the build if any channel in IPC_CHANNELS is
 * registered by none of the three — "forgot to think about it" cannot compile.
 */
import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { mkdir } from "node:fs/promises";
import { z, ZodError } from "zod";
import {
  AppError,
  appError,
  isApprovable,
  toBridgeError,
  MetaContextRequestSchema,
  MetaContextResponseSchema,
  CatalogListRequestSchema,
  CatalogListResponseSchema,
  CatalogGetRequestSchema,
  CatalogGetResponseSchema,
  CatalogSaveRequestSchema,
  CatalogSaveResponseSchema,
  CatalogGroupsRequestSchema,
  CatalogGroupsResponseSchema,
  CatalogCodesRequestSchema,
  CatalogCodesResponseSchema,
  CatalogAddCodeRequestSchema,
  CatalogAddCodeResponseSchema,
  CatalogRemoveCodeRequestSchema,
  CatalogRemoveCodeResponseSchema,
  ScanResolveRequestSchema,
  ScanResolutionSchema,
  InventoryListRequestSchema,
  InventoryListResponseSchema,
  InventoryMovementsRequestSchema,
  InventoryMovementsResponseSchema,
  StockAddRequestSchema,
  StockAddResponseSchema,
  SupplierListRequestSchema,
  SupplierListResponseSchema,
  SupplierCreateRequestSchema,
  SupplierCreateResponseSchema,
  SaleCurrentRequestSchema,
  SaleCurrentResponseSchema,
  SaleAddLineRequestSchema,
  SaleAddLineResponseSchema,
  SaleSetQtyRequestSchema,
  SaleRemoveLineRequestSchema,
  SaleOverridePriceRequestSchema,
  SaleParkRequestSchema,
  SaleParkResponseSchema,
  SaleResumeRequestSchema,
  SaleStateSchema,
  SaleListParkedRequestSchema,
  SaleListParkedResponseSchema,
  SaleCompleteRequestSchema,
  CompletedSaleSchema,
  SalePeekRequestSchema,
  TicketPeekSchema,
  SettingsGetRequestSchema,
  SettingsGetResponseSchema,
  SettingsSaveRequestSchema,
  SettingsSaveResponseSchema,
  PrintPrintersRequestSchema,
  PrintPrintersResponseSchema,
  PrintTicketRequestSchema,
  PrintTicketResponseSchema,
  PrintTestRequestSchema,
  PrintTestResponseSchema,
  PrintRevealRequestSchema,
  PrintRevealResponseSchema,
  PrintTicketsDirRequestSchema,
  PrintTicketsDirResponseSchema,
  SetupStatusRequestSchema,
  SetupStatusResponseSchema,
  SetupCompleteRequestSchema,
  SetupCompleteResponseSchema,
  SetupOwnerRequestSchema,
  SetupOwnerResponseSchema,
  DemoStatusRequestSchema,
  DemoStatusResponseSchema,
  DemoRemoveRequestSchema,
  DemoRemoveResponseSchema,
  BackupStatusRequestSchema,
  BackupStatusResponseSchema,
  BackupRunRequestSchema,
  BackupRunResponseSchema,
  BackupOpenFolderRequestSchema,
  BackupOpenFolderResponseSchema,
  BackupPickFolderRequestSchema,
  BackupPickFolderResponseSchema,
  AuthUsersRequestSchema,
  AuthUsersResponseSchema,
  AuthLoginRequestSchema,
  AuthLoginResponseSchema,
  AuthSessionRequestSchema,
  AuthSessionResponseSchema,
  AuthLogoutRequestSchema,
  AuthLogoutResponseSchema,
  AuthLockRequestSchema,
  AuthLockResponseSchema,
  AuthUnlockRequestSchema,
  AuthUnlockResponseSchema,
  AuthActivityRequestSchema,
  AuthActivityResponseSchema,
  AuthRecoverRequestSchema,
  AuthRecoverResponseSchema,
  AuthPrintRecoveryRequestSchema,
  AuthPrintRecoveryResponseSchema,
  UsersListRequestSchema,
  UsersListResponseSchema,
  UsersCreateRequestSchema,
  UsersCreateResponseSchema,
  UsersUpdateRequestSchema,
  UsersUpdateResponseSchema,
  UsersResetPinRequestSchema,
  UsersResetPinResponseSchema,
  UsedCheckImeiRequestSchema,
  UsedCheckImeiResponseSchema,
  UsedLogRequestSchema,
  UsedLogResponseSchema,
  UsedPrintRequestSchema,
  UsedPrintResponseSchema,
  UsedListRequestSchema,
  UsedListResponseSchema,
  UsedGetRequestSchema,
  UsedDeviceDetailSchema,
  UsedSetReviewRequestSchema,
  UsedSetRefurbCostRequestSchema,
  UsedSendToInventoryRequestSchema,
  UsedSendToInventoryResponseSchema,
  UsedFindVoucherRequestSchema,
  UsedFindVoucherResponseSchema,
  UsedVoidVoucherRequestSchema,
  UsedVoidVoucherResponseSchema,
  UsedPeekRequestSchema,
  UsedPeekResponseSchema,
  CustomerSearchRequestSchema,
  CustomerSearchResponseSchema,
  CustomerUpsertRequestSchema,
  CustomerUpsertResponseSchema,
  RepairCreateRequestSchema,
  RepairCreateResponseSchema,
  RepairPrintRequestSchema,
  RepairPrintResponseSchema,
  CashCurrentResponseSchema,
  CashOpenRequestSchema,
  CashManualRequestSchema,
  CashMovementsRequestSchema,
  CashMovementsResponseSchema,
  CashPreviewResponseSchema,
  CashCloseRequestSchema,
  CashCloseResponseSchema,
  CashHistoryRequestSchema,
  CashHistoryResponseSchema,
  CashGetRequestSchema,
  CashGetResponseSchema,
  CashPrintRequestSchema,
  ShiftStateSchema,
  ReportsHubResponseSchema,
  ReportsSalesRequestSchema,
  ReportsSalesResponseSchema,
  ReportsSalesDetailRequestSchema,
  ReportsSalesDetailResponseSchema,
  ReportsRepairsOpenRequestSchema,
  ReportsRepairsOpenResponseSchema,
  ReportsRepairsClosedRequestSchema,
  ReportsRepairsClosedResponseSchema,
  ReportsUsedRequestSchema,
  ReportsUsedResponseSchema,
  ReportsValuationRequestSchema,
  ReportsValuationResponseSchema,
  ReportsDeadStockRequestSchema,
  ReportsDeadStockResponseSchema,
  ReportsExportRequestSchema,
  ReportsExportResponseSchema,
  reportPermission,
  type ReportId,
  RepairDetailSchema,
  RepairGetRequestSchema,
  RepairAddLineRequestSchema,
  RepairRemoveLineRequestSchema,
  RepairSetLineChargeRequestSchema,
  RepairRecordApprovalRequestSchema,
  RepairReceivePartRequestSchema,
  RepairPartsToOrderRequestSchema,
  RepairPartsToOrderResponseSchema,
  RepairListRequestSchema,
  RepairListResponseSchema,
  RepairPhotosRequestSchema,
  RepairPhotosResponseSchema,
  RepairRevealPasscodeRequestSchema,
  RepairRevealPasscodeResponseSchema,
  RepairEditRequestSchema,
  RepairAssignRequestSchema,
  RepairPeekRequestSchema,
  RepairPeekSchema,
  WorkshopBoardRequestSchema,
  WorkshopBoardResponseSchema,
  RepairMarkReadyRequestSchema,
  RepairNotifyRequestSchema,
  RepairCollectRequestSchema,
  RepairCollectResponseSchema,
  RepairMarkNotRepairedRequestSchema,
  RepairMarkNotRepairedResponseSchema,
  type MutationCtx,
  type PermissionKey,
} from "@arkom/core";
import type { ArkomDb } from "@arkom/db";
import { resetTillContext, tillContext } from "./context";
import { addCode, getProduct, listCodes, listGroups, listProducts, removeCode, saveProduct } from "./repos/catalog";
import { resolveScanCode } from "./repos/scan";
import { addStock, listInventory, listMovements } from "./repos/inventory";
import { createSupplier, listSuppliers } from "./repos/suppliers";
import { getSettings, saveSettings } from "./repos/settings";
import {
  checkImei,
  getUsedDevice,
  listUsedDevices,
  logGateRejection,
  logPurchase,
  sendToInventory,
  setNeedsReview,
  setRefurbCost,
  findVouchers,
  voidVoucher,
} from "./repos/used";
import {
  addLine as addRepairLine,
  assignTicket,
  board,
  collect,
  createTicket,
  markNotRepaired,
  markReady,
  notifyCustomer,
  editTicket,
  listTickets,
  peekTicket,
  revealPasscode,
  ticketPhotos,
  getDetail,
  lineChargeNeedsOverride,
  partsToOrder,
  receivePart,
  recordApproval,
  removeLine as removeRepairLine,
  searchCustomers,
  setLineCharge,
  upsertCustomer,
} from "./repos/repair";
import {
  closeNeedsApproval,
  closeShiftTx,
  logShiftPreview,
  movementRows,
  movementTotals,
  openShift,
  openShiftTx,
  postManualMovement,
  requireOpenShift,
  shiftById,
  shiftListRows,
  shiftTotals,
  toShiftState,
  totalsFor,
} from "./repos/shift";
import {
  deadStock,
  hub as reportsHub,
  notRepairedInPeriod,
  repairsClosed,
  repairsOpen as reportsRepairsOpen,
  repairsOpenSummary,
  salesDetail,
  salesEstimate,
  salesRows,
  salesSummary,
  shiftOptions,
  storeCreditOutstanding,
  usedHolding,
  valuation,
} from "./repos/reports";
import { exportReport } from "./reports-export";
import {
  listPrinters,
  peekPurchase,
  printPurchase,
  printRepair,
  printTest,
  printTicket,
  revealTicket,
  ticketsDir,
  printRecoveryCode,
  printShiftReport,
} from "./print";
import { completeFirstRun, demoStatus, isSetupNeeded, removeDemoData } from "./setup";
import { backupStatus, backupsDir, runBackup } from "./backup";
import {
  addLine,
  complete,
  currentDraft,
  listParked,
  overridePrice,
  park,
  peek,
  removeLine,
  resume,
  setQty,
} from "./repos/sale";
import {
  createUser,
  findUser,
  hasAnyUser,
  listUsers,
  logAuthEvent,
  markLogin,
  recoverWithCode,
  resetPin,
  toUserRow,
  updateUser,
  userCan,
  verifyUserPin,
} from "./auth/users";
import {
  endSession,
  getSession,
  lockSession,
  noteActivity,
  setIdleLimitMinutes,
  startSession,
  toSessionInfo,
  unlockSession,
  type Session,
} from "./auth/session";

/** A session plus the MutationCtx it stamps. Handlers get this, not raw ctx. */
export interface AuthedSession extends Session {
  ctx: MutationCtx;
}

/** The approver's credentials, sent alongside the payload on a retry. */
const ApprovalSchema = z.object({ userId: z.string(), pin: z.string() });

function asBridgeError(err: unknown): Error {
  if (err instanceof AppError) return toBridgeError(err);
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const field = issue && issue.path.length > 0 ? issue.path.join(".") : undefined;
    return toBridgeError(appError("VALIDATION", issue?.message ?? "Datos no válidos.", field));
  }
  console.error("[ipc] unexpected error:", err);
  return err instanceof Error ? err : new Error(String(err));
}

/** Channels registered so far — the registry test reads this. */
const registered = new Map<string, PermissionKey | "*" | null>();

export function registeredChannels(): ReadonlyMap<string, PermissionKey | "*" | null> {
  return registered;
}

/**
 * Channels that always move money, and therefore always need an open shift.
 *
 * A declared list rather than a call scattered through the handlers, so a test
 * can pin it — a new money channel that forgets the gate should fail the build
 * the same way one that forgets a permission does (ADR-0015 §9).
 *
 * The two conditional ones are deliberately absent. `repair:create` moves cash
 * only when it takes a deposit and `repair:markNotRepaired` only when it
 * resolves one, so both check inside their own transaction, where the branch is
 * known. Receiving stock is absent because a delivery is unpacked before the
 * shop opens and involves no drawer.
 */
export const SHIFT_REQUIRED_CHANNELS: ReadonlySet<string> = new Set([
  "sale:complete",
  "used:log",
  "repair:collect",
  "cash:paidIn",
  "cash:paidOut",
  "cash:preview",
  "cash:close",
]);

/* ------------------------------------------------------------ registrars */

/**
 * No session required. The allow-list, and every entry earns its place:
 * the Login screen has to render before anyone can log in.
 */
function open<Req, Res>(
  channel: string,
  reqSchema: z.ZodType<Req>,
  resSchema: z.ZodType<Res>,
  handler: (req: Req) => Res | Promise<Res>,
): void {
  registered.set(channel, null);
  ipcMain.handle(channel, async (_event, payload: unknown) => {
    try {
      return resSchema.parse(await handler(reqSchema.parse(payload)));
    } catch (err) {
      throw asBridgeError(err);
    }
  });
}

/** A session, but no particular permission — lock, logout, activity ping. */
function authed<Req, Res>(
  channel: string,
  reqSchema: z.ZodType<Req>,
  resSchema: z.ZodType<Res>,
  handler: (session: AuthedSession, req: Req) => Res | Promise<Res>,
): void {
  registered.set(channel, "*");
  ipcMain.handle(channel, async (_event, payload: unknown) => {
    try {
      const session = requireSession();
      return resSchema.parse(await handler(withCtx(session), reqSchema.parse(payload)));
    } catch (err) {
      throw asBridgeError(err);
    }
  });
}

let dbRef: ArkomDb | null = null;

/**
 * The session, WITHOUT a MutationCtx.
 *
 * ctx is built only once the action is authorized, because building it reads
 * the till identity from the database — and whether someone may do a thing must
 * not depend on the database being readable. Denials are decided from the
 * session alone.
 */
function requireSession(): Session {
  const session = getSession();
  if (!session) throw appError("AUTH_REQUIRED", "Inicia sesión para continuar.");
  // the lock overlay is a control, not a screensaver: IPC stops with the screen
  if (session.locked) throw appError("AUTH_REQUIRED", "La sesión está bloqueada.");
  return session;
}

function withCtx(session: Session, authorizedByUserId?: string | null): AuthedSession {
  return { ...session, ctx: sessionCtx(session, authorizedByUserId) };
}

/** The actor comes from HERE. No payload can reach these fields. */
function sessionCtx(session: Session, authorizedByUserId?: string | null): MutationCtx {
  const base = tillContext(dbRef!).ctx;
  return { ...base, userId: session.userId, authorizedByUserId: authorizedByUserId ?? null };
}

/**
 * A session holding a named permission.
 *
 * `permission` may be a function of the payload, because a couple of channels
 * do two jobs — `catalog:save` creates or edits depending on whether an id came
 * with it, and the two are separate permissions.
 *
 * If the caller lacks an **approvable** permission, this does not refuse: it
 * raises APPROVAL_REQUIRED naming the key, and a retry carrying an approver's
 * PIN executes the action in that same call with both ids stamped.
 */
function guarded<Req, Res>(
  channel: string,
  permission: PermissionKey | ((req: Req) => PermissionKey),
  reqSchema: z.ZodType<Req>,
  resSchema: z.ZodType<Res>,
  handler: (session: AuthedSession, req: Req) => Res | Promise<Res>,
): void {
  registered.set(channel, typeof permission === "function" ? "*" : permission);
  ipcMain.handle(channel, async (_event, payload: unknown, approvalRaw?: unknown) => {
    try {
      const session = requireSession();
      const req = reqSchema.parse(payload);
      const key = typeof permission === "function" ? permission(req) : permission;

      /* An open shift is a precondition, not a permission: it is about the
         state of the till rather than about who is standing at it, so it is
         checked before authorization and raises its own code (ADR-0015 §9). */
      if (SHIFT_REQUIRED_CHANNELS.has(channel)) requireOpenShift(dbRef!, withCtx(session).ctx);

      // session.permissions is already resolved (owner holds everything), so
      // this one lookup IS the authorization decision
      if (session.permissions.includes(key)) {
        return resSchema.parse(await handler(withCtx(session), req));
      }
      const approverId = await authorize(key, approvalRaw);
      return resSchema.parse(await handler(withCtx(session, approverId), req));
    } catch (err) {
      throw asBridgeError(err);
    }
  });
}

/**
 * The approval layer. Returns the approver's id, or throws.
 *
 * Single-use by design (ADR-0012 §5): nothing is remembered, so the next
 * attempt asks again. A five-minute window is exactly what a cashier learns to
 * exploit.
 */
async function authorize(key: PermissionKey, approvalRaw: unknown): Promise<string> {
  if (!isApprovable(key)) {
    throw appError("PERMISSION_DENIED", "No tienes permiso para hacer esto.");
  }
  const parsed = ApprovalSchema.safeParse(approvalRaw);
  if (!parsed.success) {
    // not a refusal — an invitation to retry with someone's PIN
    throw appError("APPROVAL_REQUIRED", key);
  }

  const ctx = tillContext(dbRef!).ctx;
  const approver = findUser(dbRef!, ctx, parsed.data.userId);
  if (!approver || !approver.active || !userCan(approver, key)) {
    // checked BEFORE the PIN so a cashier's PIN cannot be tested against an
    // account that could never have approved this anyway
    throw appError("PERMISSION_DENIED", "Esa persona no puede autorizar esta acción.");
  }

  const session = getSession();
  try {
    verifyUserPin(dbRef!, ctx, approver.id, parsed.data.pin, "approval");
  } catch (err) {
    logAuthEvent(dbRef!, ctx, approver.id, "approval_denied", {
      permission: key,
      requestedByUserId: session?.userId ?? null,
    });
    throw err;
  }

  logAuthEvent(dbRef!, ctx, approver.id, "approval_granted", {
    permission: key,
    requestedByUserId: session?.userId ?? null,
  });
  return approver.id;
}

/* ------------------------------------------------------------- handlers */

export function registerIpcHandlers(db: ArkomDb): void {
  dbRef = db;

  /* ---- open: everything the Login and setup screens need ---- */

  open("meta:context", MetaContextRequestSchema, MetaContextResponseSchema, () => tillContext(db).meta);

  open("setup:status", SetupStatusRequestSchema, SetupStatusResponseSchema, () => ({
    needed: isSetupNeeded(db),
    // a v0.9.0 till that upgraded has a shop but no users yet (spec I2)
    ownerNeeded: !isSetupNeeded(db) && !hasAnyUser(db, tillContext(db).ctx),
  }));

  open("setup:complete", SetupCompleteRequestSchema, SetupCompleteResponseSchema, (input) => {
    const result = completeFirstRun(db, input);
    resetTillContext();
    return result;
  });

  open("setup:owner", SetupOwnerRequestSchema, SetupOwnerResponseSchema, (input) => {
    const ctx = tillContext(db).ctx;
    if (hasAnyUser(db, ctx)) throw appError("VALIDATION", "Esta caja ya tiene usuarios.");
    const { user, recoveryCode } = createUser(db, ctx, { name: input.name, role: "owner", pin: input.pin });
    return { user, recoveryCode: recoveryCode! };
  });

  open("auth:users", AuthUsersRequestSchema, AuthUsersResponseSchema, () => {
    // only active users, and only what a tile needs — no hashes, no overrides
    return listUsers(db, tillContext(db).ctx, true).map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      lockedUntilMs: u.lockedUntil?.getTime() ?? null,
    }));
  });

  open("auth:login", AuthLoginRequestSchema, AuthLoginResponseSchema, ({ userId, pin }) => {
    const ctx = tillContext(db).ctx;
    const { user } = verifyUserPin(db, ctx, userId, pin, "login");
    markLogin(db, ctx, user);
    return startSession({ ...toUserRow(user) });
  });

  open("auth:session", AuthSessionRequestSchema, AuthSessionResponseSchema, () => toSessionInfo(getSession()));

  open("auth:unlock", AuthUnlockRequestSchema, AuthUnlockResponseSchema, ({ pin }) => {
    const session = getSession();
    if (!session) throw appError("AUTH_REQUIRED", "No hay sesión que desbloquear.");
    const ctx = tillContext(db).ctx;
    // only the CURRENT user's PIN — the way to another user is logging out
    verifyUserPin(db, ctx, session.userId, pin, "unlock");
    logAuthEvent(db, ctx, session.userId, "unlock");
    return unlockSession()!;
  });

  open("auth:recover", AuthRecoverRequestSchema, AuthRecoverResponseSchema, ({ userId, code, newPin }) => {
    return { recoveryCode: recoverWithCode(db, tillContext(db).ctx, userId, code, newPin) };
  });

  open("auth:printRecovery", AuthPrintRecoveryRequestSchema, AuthPrintRecoveryResponseSchema, (req) => {
    return printRecoveryCode(db, tillContext(db).ctx, req.name, req.code);
  });

  /* ---- authed: a session, no particular permission ---- */

  authed("auth:logout", AuthLogoutRequestSchema, AuthLogoutResponseSchema, (session) => {
    // an open cart is parked rather than abandoned, so the lines stay attributed
    // to whoever rang them up (spec F5)
    const parkedDocId = parkOpenCart(db, session);
    logAuthEvent(db, session.ctx, session.userId, "logout", { parkedDocId });
    endSession();
    return { ok: true, parkedDocId };
  });

  authed("auth:lock", AuthLockRequestSchema, AuthLockResponseSchema, (session) => {
    logAuthEvent(db, session.ctx, session.userId, "lock", { manual: true });
    lockSession();
    return { ok: true };
  });

  authed("auth:activity", AuthActivityRequestSchema, AuthActivityResponseSchema, () => {
    noteActivity();
    return { ok: true };
  });

  /* ---- catalog ---- */

  guarded("catalog:list", "catalog.view", CatalogListRequestSchema, CatalogListResponseSchema, (s, filters) =>
    listProducts(db, s.ctx, filters),
  );
  guarded("catalog:get", "catalog.view", CatalogGetRequestSchema, CatalogGetResponseSchema, (s, { id }) =>
    getProduct(db, s.ctx, id),
  );
  guarded("catalog:groups", "catalog.view", CatalogGroupsRequestSchema, CatalogGroupsResponseSchema, (s) =>
    listGroups(db, s.ctx),
  );
  guarded("catalog:codes", "catalog.view", CatalogCodesRequestSchema, CatalogCodesResponseSchema, (s, { productId }) =>
    listCodes(db, s.ctx, productId),
  );
  // creating and editing are different permissions, and this one channel does both
  guarded(
    "catalog:save",
    (req) => (req.id ? "catalog.edit" : "catalog.create"),
    CatalogSaveRequestSchema,
    CatalogSaveResponseSchema,
    (s, input) => saveProduct(db, s.ctx, input),
  );
  guarded("catalog:addCode", "catalog.attach_code", CatalogAddCodeRequestSchema, CatalogAddCodeResponseSchema, (s, req) =>
    addCode(db, s.ctx, req),
  );
  guarded("catalog:removeCode", "catalog.edit", CatalogRemoveCodeRequestSchema, CatalogRemoveCodeResponseSchema, (s, req) =>
    removeCode(db, s.ctx, req.productId, req.codeId),
  );
  guarded("scan:resolve", "catalog.view", ScanResolveRequestSchema, ScanResolutionSchema, (s, { code }) =>
    resolveScanCode(db, s.ctx, code),
  );

  /* ---- inventory ---- */

  guarded("inventory:list", "inventory.view", InventoryListRequestSchema, InventoryListResponseSchema, (s, f) =>
    listInventory(db, s.ctx, f),
  );
  guarded("inventory:movements", "inventory.view", InventoryMovementsRequestSchema, InventoryMovementsResponseSchema, (s, req) =>
    listMovements(db, s.ctx, req),
  );
  guarded("stock:add", "inventory.receive", StockAddRequestSchema, StockAddResponseSchema, (s, input) =>
    addStock(db, s.ctx, input),
  );
  guarded("supplier:list", "inventory.receive", SupplierListRequestSchema, SupplierListResponseSchema, (s) =>
    listSuppliers(db, s.ctx),
  );
  guarded("supplier:create", "inventory.receive", SupplierCreateRequestSchema, SupplierCreateResponseSchema, (s, { name }) =>
    createSupplier(db, s.ctx, name),
  );

  /* ---- sale ---- */

  guarded("sale:current", "sale.create", SaleCurrentRequestSchema, SaleCurrentResponseSchema, (s) =>
    currentDraft(db, s.ctx),
  );
  guarded("sale:addLine", "sale.create", SaleAddLineRequestSchema, SaleAddLineResponseSchema, (s, req) =>
    addLine(db, s.ctx, req),
  );
  guarded("sale:setQty", "sale.create", SaleSetQtyRequestSchema, SaleStateSchema, (s, req) => setQty(db, s.ctx, req));
  guarded("sale:removeLine", "sale.create", SaleRemoveLineRequestSchema, SaleStateSchema, (s, req) =>
    removeLine(db, s.ctx, req),
  );
  // the approvable one: a cashier presses it and the owner's PIN completes it,
  // and the resulting oplog entry carries both ids
  guarded("sale:overridePrice", "sale.price_override", SaleOverridePriceRequestSchema, SaleStateSchema, (s, req) =>
    overridePrice(db, s.ctx, req),
  );
  guarded("sale:park", "sale.park", SaleParkRequestSchema, SaleParkResponseSchema, (s, req) => park(db, s.ctx, req));
  guarded("sale:resume", "sale.resume", SaleResumeRequestSchema, SaleStateSchema, (s, req) => resume(db, s.ctx, req));
  guarded("sale:listParked", "sale.resume", SaleListParkedRequestSchema, SaleListParkedResponseSchema, (s) =>
    listParked(db, s.ctx),
  );
  guarded("sale:complete", "sale.create", SaleCompleteRequestSchema, CompletedSaleSchema, (s, req) =>
    complete(db, s.ctx, req),
  );
  guarded("sale:peek", "sale.create", SalePeekRequestSchema, TicketPeekSchema, (s, { docId }) => peek(db, s.ctx, docId));

  /* ---- settings, demo, backup: owner territory ---- */

  guarded("settings:get", "settings.edit", SettingsGetRequestSchema, SettingsGetResponseSchema, (s) =>
    getSettings(db, s.ctx),
  );
  guarded("settings:save", "settings.edit", SettingsSaveRequestSchema, SettingsSaveResponseSchema, (s, patch) => {
    const saved = saveSettings(db, s.ctx, patch);
    /* The idle watcher holds the limit in memory, so a change has to be pushed
       into it — otherwise the owner sets "never lock", sees it saved, and the
       till keeps locking until the next restart. */
    setIdleLimitMinutes(saved.idleLockMinutes);
    return saved;
  });
  guarded("demo:status", "settings.edit", DemoStatusRequestSchema, DemoStatusResponseSchema, (s) =>
    demoStatus(db, s.ctx),
  );
  guarded("demo:remove", "settings.edit", DemoRemoveRequestSchema, DemoRemoveResponseSchema, (s) =>
    removeDemoData(db, s.ctx),
  );
  guarded("backup:status", "backup.manage", BackupStatusRequestSchema, BackupStatusResponseSchema, (s) =>
    backupStatus(db, s.ctx),
  );
  guarded("backup:now", "backup.manage", BackupRunRequestSchema, BackupRunResponseSchema, (s) =>
    runBackup(db, s.ctx, "manual"),
  );
  guarded("backup:openFolder", "backup.manage", BackupOpenFolderRequestSchema, BackupOpenFolderResponseSchema, async () => {
    const dir = backupsDir();
    await mkdir(dir, { recursive: true });
    const problem = await shell.openPath(dir);
    if (problem) throw appError("VALIDATION", problem);
    return { ok: true };
  });
  guarded("backup:pickFolder", "backup.manage", BackupPickFolderRequestSchema, BackupPickFolderResponseSchema, async () => {
    const win = BrowserWindow.getAllWindows()[0];
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return { path: result.canceled ? null : (result.filePaths[0] ?? null) };
  });

  /* ---- printing ---- */

  guarded("print:printers", "settings.edit", PrintPrintersRequestSchema, PrintPrintersResponseSchema, () => listPrinters());
  guarded("print:test", "settings.edit", PrintTestRequestSchema, PrintTestResponseSchema, (s, { target }) =>
    printTest(db, s.ctx, target),
  );
  guarded("print:ticket", "sale.create", PrintTicketRequestSchema, PrintTicketResponseSchema, (s, req) =>
    printTicket(db, s.ctx, req),
  );
  guarded("print:reveal", "sale.create", PrintRevealRequestSchema, PrintRevealResponseSchema, (_s, { path, mode }) =>
    revealTicket(path, mode),
  );
  guarded("print:ticketsDir", "sale.create", PrintTicketsDirRequestSchema, PrintTicketsDirResponseSchema, () => ({
    path: ticketsDir(),
  }));

  /* ---- users administration ---- */

  guarded("users:list", "users.manage", UsersListRequestSchema, UsersListResponseSchema, (s) =>
    listUsers(db, s.ctx).map(toUserRow),
  );
  guarded("users:create", "users.manage", UsersCreateRequestSchema, UsersCreateResponseSchema, (s, input) =>
    createUser(db, s.ctx, input),
  );
  guarded("users:update", "users.manage", UsersUpdateRequestSchema, UsersUpdateResponseSchema, (s, input) =>
    updateUser(db, s.ctx, input),
  );
  guarded("users:resetPin", "users.manage", UsersResetPinRequestSchema, UsersResetPinResponseSchema, (s, input) => {
    resetPin(db, s.ctx, s.userId, input);
    return { ok: true };
  });

  /* ---- used devices (ADR-0013) ---- */

  guarded(
    "used:checkImei",
    "usedDevices.create",
    UsedCheckImeiRequestSchema,
    UsedCheckImeiResponseSchema,
    (s, { imei }) => {
      const result = checkImei(db, s.ctx, imei);
      /* A duplicate is worth a line in the audit trail — someone was offered a
         phone the shop has already seen, and that is the event a shopkeeper
         wants to find later. A mistyped IMEI is not: it is a typo, and logging
         every keystroke-triggered check would bury the interesting one. */
      if (result.rejection === "duplicate_unit" || result.rejection === "duplicate_purchase") {
        logGateRejection(db, s.ctx, imei, result.rejection, result.existing?.id ?? null);
      }
      return result;
    },
  );

  /**
   * Log the purchase.
   *
   * `usedDevices.create` covers the write AND the two prints that follow it: the
   * cashier typed the seller's details a moment ago and has to hand them
   * something to sign, so gating the printout behind `viewSeller` would withhold
   * data they just entered (ADR-0013 §6, amended). Reading it back later is what
   * `viewSeller` governs — see used:print.
   *
   * Both prints are attempted after the transaction and neither can undo it. A
   * jammed printer leaves a logged, numbered purchase and a reprint button,
   * which is the same bargain the sale ticket already makes.
   */
  guarded("used:log", "usedDevices.create", UsedLogRequestSchema, UsedLogResponseSchema, async (s, input) => {
    const result = await logPurchase(db, s.ctx, input);
    /* Printing is the RENDERER's to drive, through the same hook and the same
       toast the sale ticket uses. It used to happen here, and a failure went to
       a console line nobody reads — so a till with no printer configured logged
       the purchase and produced no document, no PDF and no explanation. The
       purchase is committed by now either way; what changes is that the cashier
       is told. */
    return {
      purchaseId: result.purchaseId,
      docNumber: result.docNumber,
      unitId: result.unitId,
      productId: result.productId,
      voucherId: result.voucherId,
      status: result.status,
    };
  });

  /**
   * Print, reprint, or fall back to a PDF — for the document and the label.
   *
   * `usedDevices.create`: whoever may buy a device may print its paperwork.
   *
   * This is a deliberate loosening (2026-08-29, ADR-0013 §6). The document
   * carries the seller's name and ID, so gating it behind `viewSeller` was the
   * tighter reading — but at the counter it meant a cashier who had just bought
   * a phone could not reprint the slip when the seller lost it, and had to fetch
   * the owner. The shop accepted the trade: a cashier can read a seller's
   * details by printing the document, and the on-screen gate is now a courtesy
   * rather than a control. Every print is oplogged with who asked for it.
   */
  guarded(
    "used:print",
    "usedDevices.create",
    UsedPrintRequestSchema,
    UsedPrintResponseSchema,
    (s, input) => printPurchase(db, s.ctx, input),
  );

  guarded("used:list", "usedDevices.create", UsedListRequestSchema, UsedListResponseSchema, (s, input) =>
    listUsedDevices(db, s.ctx, input ?? {}),
  );

  /**
   * The detail, with the seller block included ONLY for those who may read it.
   *
   * The permission is resolved here and passed down, so the repo builds a
   * payload that simply lacks the fields — rather than the UI receiving them
   * and choosing not to draw them (ADR-0012 §5).
   */
  guarded("used:get", "usedDevices.create", UsedGetRequestSchema, UsedDeviceDetailSchema, (s, input) =>
    getUsedDevice(db, s.ctx, input.purchaseId, s.permissions.includes("usedDevices.viewSeller")),
  );

  guarded("used:setReview", "usedDevices.create", UsedSetReviewRequestSchema, UsedDeviceDetailSchema, (s, input) => {
    setNeedsReview(db, s.ctx, input.purchaseId, input.needsReview);
    return getUsedDevice(db, s.ctx, input.purchaseId, s.permissions.includes("usedDevices.viewSeller"));
  });

  guarded(
    "used:setRefurbCost",
    "usedDevices.editRefurbCost",
    UsedSetRefurbCostRequestSchema,
    UsedDeviceDetailSchema,
    (s, input) => {
      setRefurbCost(db, s.ctx, input.purchaseId, input.refurbCostCents);
      return getUsedDevice(db, s.ctx, input.purchaseId, s.permissions.includes("usedDevices.viewSeller"));
    },
  );

  /**
   * Shelve a held device, days after buying it.
   *
   * Prints the shelf label afterwards — it now carries a price, which the one
   * printed at intake did not. As everywhere else, the print cannot undo the
   * movement that has already been posted.
   */
  guarded(
    "used:sendToInventory",
    "usedDevices.sendToInventory",
    UsedSendToInventoryRequestSchema,
    UsedSendToInventoryResponseSchema,
    async (s, input) => {
      const result = sendToInventory(db, s.ctx, input.purchaseId, input.sellPriceCents);
      try {
        await printPurchase(db, s.ctx, { purchaseId: input.purchaseId, what: "label", target: "auto", copy: false });
      } catch (err) {
        console.error("[used] could not print the shelf label:", err);
      }
      return result;
    },
  );

  /**
   * The voucher finder behind the "Saldo a favor" tender.
   *
   * Any cashier who may take a payment may find the voucher that pays it —
   * `usedDevices.redeemCredit`. The seller's NAME rides along only for a
   * session that may already read it; without that, the purchase number on the
   * slip is the identification, which is what the customer is holding anyway.
   */
  guarded(
    "used:findVoucher",
    "usedDevices.redeemCredit",
    UsedFindVoucherRequestSchema,
    UsedFindVoucherResponseSchema,
    (s, input) =>
      findVouchers(
        db,
        s.ctx,
        input.search,
        input.saleTotalCents,
        s.permissions.includes("usedDevices.viewSeller"),
      ),
  );

  /** Read the purchase document on screen — the movements drawer links here. */
  guarded("used:peek", "usedDevices.create", UsedPeekRequestSchema, UsedPeekResponseSchema, (s, input) =>
    peekPurchase(db, s.ctx, input),
  );

  guarded(
    "used:voidVoucher",
    "usedDevices.voidCredit",
    UsedVoidVoucherRequestSchema,
    UsedVoidVoucherResponseSchema,
    (s, input) => {
      voidVoucher(db, s.ctx, input.voucherId, input.reason);
      return { ok: true };
    },
  );

  /* ---- repairs (ADR-0014) ---- */

  /**
   * Customers.
   *
   * No module of their own: today the only reason the till knows a customer's
   * name is that they left a device, so the repair permissions govern them.
   * Looking one up needs only `repair.view` — a technician reading the board
   * should be able to see whose phone they are holding — while creating or
   * editing one is part of taking a device in.
   */
  guarded("customer:search", "repair.view", CustomerSearchRequestSchema, CustomerSearchResponseSchema, (s, input) => ({
    rows: searchCustomers(db, s.ctx, input.query),
  }));

  guarded("customer:upsert", "repair.create", CustomerUpsertRequestSchema, CustomerUpsertResponseSchema, (s, input) =>
    upsertCustomer(db, s.ctx, input),
  );

  /**
   * Take a device in.
   *
   * The print is the RENDERER's to drive, through the shared hook — the lesson
   * the purchase document taught (ADR-0013, amended): a print failure swallowed
   * in main is a customer sent home with no paperwork and nobody the wiser. The
   * ticket is committed by the time this returns; the receipt is a separate,
   * retryable act.
   */
  guarded("repair:create", "repair.create", RepairCreateRequestSchema, RepairCreateResponseSchema, (s, input) =>
    createTicket(db, s.ctx, input),
  );

  /**
   * Print or reprint a repair document.
   *
   * `repair.view`, unlike `used:print`'s `usedDevices.create`: the purchase
   * document carries a seller's ID number, and this one carries nothing the
   * customer standing at the counter does not already have on their own copy.
   */
  guarded("repair:get", "repair.view", RepairGetRequestSchema, RepairDetailSchema, (s, { ticketId }) =>
    getDetail(db, s.ctx, ticketId),
  );

  /**
   * The quote.
   *
   * `repair.parts.manage` covers all three kinds, including labor: deciding
   * that a job needs an hour of work is the same act as deciding it needs a
   * screen, and splitting them would give a technician the right to fit a part
   * but not to say they fitted it.
   */
  guarded("repair:addLine", "repair.parts.manage", RepairAddLineRequestSchema, RepairDetailSchema, (s, input) =>
    addRepairLine(db, s.ctx, input),
  );

  guarded(
    "repair:removeLine",
    "repair.parts.manage",
    RepairRemoveLineRequestSchema,
    RepairDetailSchema,
    (s, { ticketId, lineId }) => removeRepairLine(db, s.ctx, ticketId, lineId),
  );

  /**
   * Moving a charge — and the one place this module escalates.
   *
   * Raising a charge needs `repair.quote.set`: the total climbs past what was
   * approved, the ticket falls back to Presupuestado by itself, and nothing can
   * be collected until the customer agrees again. Lowering one AFTER they
   * agreed is the direction that costs the shop money invisibly, so it asks for
   * `repair.price_override` — approvable, so a cashier presses the button and
   * an owner's PIN completes it, exactly like a discount on the Sale screen
   * (ADR-0014 §9a).
   *
   * The decision is made from the ticket's own facts, never from the payload: a
   * renderer that sent a flattering `fromCents` would otherwise gate itself.
   */
  guarded(
    "repair:setLineCharge",
    (req) => (lineChargeNeedsOverride(db, req) ? "repair.price_override" : "repair.quote.set"),
    RepairSetLineChargeRequestSchema,
    RepairDetailSchema,
    (s, input) => setLineCharge(db, s.ctx, input),
  );

  guarded(
    "repair:recordApproval",
    "repair.quote.approve",
    RepairRecordApprovalRequestSchema,
    RepairDetailSchema,
    (s, { ticketId, method }) => recordApproval(db, s.ctx, ticketId, method),
  );

  /**
   * Receiving an ordered part.
   *
   * Its own permission, and NOT a technician default: this is the moment a
   * delivery enters the shop's stock at a cost someone typed, which is exactly
   * where a part gets quietly written off (ADR-0012's reasoning, applied).
   */
  guarded(
    "repair:receivePart",
    "repair.parts.receive",
    RepairReceivePartRequestSchema,
    RepairDetailSchema,
    (s, input) => receivePart(db, s.ctx, input),
  );

  guarded(
    "repair:partsToOrder",
    "repair.view",
    RepairPartsToOrderRequestSchema,
    RepairPartsToOrderResponseSchema,
    (s) => ({ rows: partsToOrder(db, s.ctx) }),
  );

  guarded("repair:list", "repair.view", RepairListRequestSchema, RepairListResponseSchema, (s, input) =>
    listTickets(db, s.ctx, input ?? {}),
  );

  guarded("repair:photos", "repair.view", RepairPhotosRequestSchema, RepairPhotosResponseSchema, async (s, input) => ({
    photos: await ticketPhotos(db, s.ctx, input.ticketId),
  }));

  /**
   * Looking at the passcode.
   *
   * Returns only `ok` — the value came down with the ficha, and a channel that
   * returned it again would be a second place to leak it from. The point of the
   * call is the oplog entry it writes: who looked, and when (ADR-0014 §10).
   */
  guarded(
    "repair:revealPasscode",
    "repair.view",
    RepairRevealPasscodeRequestSchema,
    RepairRevealPasscodeResponseSchema,
    (s, { ticketId }) => revealPasscode(db, s.ctx, ticketId),
  );

  guarded("repair:edit", "repair.edit", RepairEditRequestSchema, RepairDetailSchema, (s, input) =>
    editTicket(db, s.ctx, input),
  );

  guarded("repair:assign", "repair.assign", RepairAssignRequestSchema, RepairDetailSchema, (s, { ticketId, userId }) =>
    assignTicket(db, s.ctx, ticketId, userId),
  );

  guarded("repair:peek", "repair.view", RepairPeekRequestSchema, RepairPeekSchema, (s, { ticketId }) =>
    peekTicket(db, s.ctx, ticketId),
  );

  guarded("workshop:board", "workshop.view", WorkshopBoardRequestSchema, WorkshopBoardResponseSchema, (s, input) =>
    board(db, s.ctx, input ?? {}),
  );

  guarded(
    "repair:markReady",
    "repair.markReady",
    RepairMarkReadyRequestSchema,
    RepairDetailSchema,
    (s, { ticketId }) => markReady(db, s.ctx, ticketId),
  );

  /**
   * "We called them."
   *
   * `repair.markReady`, not a permission of its own: telling the customer is
   * the same counter act as putting the phone on the ready shelf, and a shop
   * where one person may do the first and not the second has a phone nobody
   * collects.
   */
  guarded("repair:notify", "repair.markReady", RepairNotifyRequestSchema, RepairDetailSchema, (s, input) =>
    notifyCustomer(db, s.ctx, input),
  );

  guarded("repair:collect", "repair.collect", RepairCollectRequestSchema, RepairCollectResponseSchema, (s, input) =>
    collect(db, s.ctx, input),
  );

  /**
   * Closing a ticket unrepaired.
   *
   * Owner-only and **approvable**: it moves money — a deposit is refunded or
   * absorbed, a fee may be charged, and parts are written off or kept — so a
   * cashier presses the button and an owner's PIN completes it.
   */
  guarded(
    "repair:markNotRepaired",
    "repair.markNotRepaired",
    RepairMarkNotRepairedRequestSchema,
    RepairMarkNotRepairedResponseSchema,
    (s, input) => markNotRepaired(db, s.ctx, input),
  );

  guarded("repair:print", "repair.view", RepairPrintRequestSchema, RepairPrintResponseSchema, (s, input) =>
    printRepair(db, s.ctx, input),
  );

  /* ------------------------------------------------------ cash (ADR-0015) */

  guarded("cash:current", "cash.view", z.object({}).default({}), CashCurrentResponseSchema, (s) => {
    const shift = openShift(db, s.ctx);
    return shift ? toShiftState(db, shift) : null;
  });

  guarded("cash:open", "cash.open", CashOpenRequestSchema, ShiftStateSchema, (s, input) =>
    openShiftTx(db, s.ctx, input),
  );

  guarded("cash:movements", "cash.view", CashMovementsRequestSchema, CashMovementsResponseSchema, (s, input) => {
    const shiftId = input.shiftId ?? openShift(db, s.ctx)?.id ?? null;
    if (!shiftId) return { rows: [], inCents: 0, outCents: 0, netCents: 0 };
    const rows = movementRows(db, shiftId);
    return { rows, ...movementTotals(rows) };
  });

  /**
   * Paid in and paid out.
   *
   * The permission is chosen per call from the amount, the way
   * `repair:setLineCharge` chooses its own: below the threshold this is counter
   * work, above it somebody else has to say yes. Reading the threshold from
   * settings rather than the payload means a renderer cannot pick its own gate.
   */
  const manualPermission = (req: { amountCents: number }): PermissionKey => {
    const threshold = getSettings(db, tillContext(db).ctx).cashMovementApprovalCents;
    return req.amountCents > threshold ? "cash.movement_over_threshold" : "cash.movement";
  };

  guarded("cash:paidIn", manualPermission, CashManualRequestSchema, CashMovementsResponseSchema, (s, input) =>
    postManualMovement(db, s.ctx, { ...input, direction: "in" }),
  );

  guarded("cash:paidOut", manualPermission, CashManualRequestSchema, CashMovementsResponseSchema, (s, input) =>
    postManualMovement(db, s.ctx, { ...input, direction: "out" }),
  );

  /* The X. The same computation a close would freeze, uncommitted — literally
     the same function over the same rows, which is the whole guarantee
     (ADR-0015 §12). It oplogs, because "someone took an X at 19:40" is exactly
     the fact that matters later when the count is short. */
  guarded("cash:preview", "cash.view", z.object({}).default({}), CashPreviewResponseSchema, (s) => {
    const shift = requireOpenShift(db, s.ctx);
    const totals = shiftTotals(db, shift);
    logShiftPreview(db, s.ctx, shift.id, totals.expectedCashCents);
    return { shift: toShiftState(db, shift), totals };
  });

  /**
   * Closing.
   *
   * The permission is chosen per call: within tolerance this is counter work,
   * outside it somebody else has to say yes. The expected figure comes from the
   * database and only the counted one from the payload, because nothing else
   * could supply it.
   */
  guarded(
    "cash:close",
    (req: { countedCents: number }) =>
      closeNeedsApproval(db, tillContext(db).ctx, req.countedCents, getSettings(db, tillContext(db).ctx).cashVarianceToleranceCents)
        ? "cash.close_over_tolerance"
        : "cash.close",
    CashCloseRequestSchema,
    CashCloseResponseSchema,
    (s, input) => closeShiftTx(db, s.ctx, input),
  );

  guarded("cash:history", "cash.history", CashHistoryRequestSchema, CashHistoryResponseSchema, (s, input) => ({
    rows: shiftListRows(db, s.ctx, input.limit),
  }));

  guarded("cash:get", "cash.history", CashGetRequestSchema, CashGetResponseSchema, (s, { shiftId }) => {
    const shift = shiftById(db, shiftId);
    if (!shift) throw appError("VALIDATION", "Ese turno no existe.");
    return {
      shift: toShiftState(db, shift),
      totals: totalsFor(db, shift),
      movements: movementRows(db, shift.id),
    };
  });

  guarded(
    "cash:print",
    (req: { what: "z" | "x"; shiftId?: string }) => (req.what === "x" || !req.shiftId ? "cash.view" : "cash.history"),
    CashPrintRequestSchema,
    PrintTicketResponseSchema,
    (s, input) => printShiftReport(db, s.ctx, input),
  );

  /* --------------------------------------------------- reports (ADR-0016) */

  /**
   * Read-only, every one of them.
   *
   * `reports.view` is the operational view — what sold, what is on the bench.
   * `reports.costs` is the shop's buying position and its profit, which is a
   * different thing to be allowed to know. A caller with only the first receives
   * responses from which the cost fields are ABSENT, never blanked (§7).
   */
  const canCosts = (s: AuthedSession) => s.permissions.includes("reports.costs");

  guarded("reports:hub", "reports.view", z.object({}).default({}), ReportsHubResponseSchema, (s) => {
    const thresholdDays = getSettings(db, s.ctx).deadStockDays;
    return { ...reportsHub(db, s.ctx, canCosts(s), thresholdDays), thresholdDays };
  });

  guarded("reports:sales", "reports.view", ReportsSalesRequestSchema, ReportsSalesResponseSchema, (s, input) => {
    const withCosts = canCosts(s);
    const f = { fromMs: input.fromMs, toMs: input.toMs, shiftId: input.shiftId };
    return {
      summary: salesSummary(db, s.ctx, f),
      rows: salesRows(db, s.ctx, { ...f, groupBy: input.groupBy }, withCosts),
      estimate: withCosts ? salesEstimate(db, s.ctx, f) : null,
      withCosts,
      shifts: shiftOptions(db, s.ctx),
    };
  });

  guarded(
    "reports:salesDetail",
    "reports.view",
    ReportsSalesDetailRequestSchema,
    ReportsSalesDetailResponseSchema,
    (s, input) => ({ rows: salesDetail(db, s.ctx, input) }),
  );

  guarded(
    "reports:repairsOpen",
    "reports.view",
    ReportsRepairsOpenRequestSchema,
    ReportsRepairsOpenResponseSchema,
    (s, input) => {
      const rows = reportsRepairsOpen(db, s.ctx, input);
      return {
        summary: repairsOpenSummary(rows),
        rows,
        technicians: listUsers(db, s.ctx)
          .filter((u) => u.active)
          .map((u) => ({ id: u.id, name: u.name })),
      };
    },
  );

  guarded(
    "reports:repairsClosed",
    "reports.costs",
    ReportsRepairsClosedRequestSchema,
    ReportsRepairsClosedResponseSchema,
    (s, input) => {
      const tickets = repairsClosed(db, s.ctx, input);
      const notRepaired = notRepairedInPeriod(db, s.ctx, input);
      const turnarounds = tickets.map((t) => t.turnaroundDays).filter((d): d is number => d !== null);
      const summary = {
        collected: tickets.length,
        revenueCents: tickets.reduce((sum, t) => sum + t.revenueCents, 0),
        partsCostCents: tickets.reduce((sum, t) => sum + t.partsCostCents, 0),
        laborCents: tickets.reduce((sum, t) => sum + t.laborCents, 0),
        marginCents: tickets.reduce((sum, t) => sum + t.marginCents, 0),
        averageTurnaroundDays:
          turnarounds.length > 0
            ? Math.round((turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length) * 10) / 10
            : null,
        notRepaired: notRepaired.reduce((sum, r) => sum + r.count, 0),
      };

      if (!input.byTechnician) {
        return {
          summary,
          rows: tickets.map((t) => ({
            key: t.ticketId,
            ticketId: t.ticketId,
            docNumber: t.docNumber,
            label: t.customerName,
            device: t.device,
            intakeAtMs: t.intakeAtMs,
            collectedAtMs: t.collectedAtMs,
            turnaroundDays: t.turnaroundDays,
            count: 1,
            revenueCents: t.revenueCents,
            partsCostCents: t.partsCostCents,
            marginCents: t.marginCents,
            technicianName: t.technicianName,
          })),
          notRepaired,
        };
      }

      /* grouped in the handler rather than in SQL: the per-ticket rows are
         already loaded and a shop closes tens of repairs a month, not tens of
         thousands. A second query would be a second definition of the margin. */
      const byTech = new Map<string, (typeof tickets)[number][]>();
      for (const t of tickets) {
        const key = t.technicianName ?? "";
        byTech.set(key, [...(byTech.get(key) ?? []), t]);
      }
      return {
        summary,
        rows: [...byTech.entries()].map(([name, list]) => ({
          key: name,
          ticketId: null,
          docNumber: null,
          label: name || "Sin asignar",
          device: "",
          intakeAtMs: null,
          collectedAtMs: null,
          turnaroundDays: null,
          count: list.length,
          revenueCents: list.reduce((sum, t) => sum + t.revenueCents, 0),
          partsCostCents: list.reduce((sum, t) => sum + t.partsCostCents, 0),
          marginCents: list.reduce((sum, t) => sum + t.marginCents, 0),
          technicianName: name || null,
        })),
        notRepaired,
      };
    },
  );

  guarded("reports:used", "reports.costs", ReportsUsedRequestSchema, ReportsUsedResponseSchema, (s, input) => {
    const rows = usedHolding(db, s.ctx, input);
    const all = usedHolding(db, s.ctx, {});
    const states = ["held", "needs_review", "in_stock"] as const;
    return {
      /* the summary describes the WHOLE position, not the filtered slice: a
         filter narrows the table, it does not change how much is tied up */
      summary: states.map((state) => {
        const list = all.filter((r) => r.state === state);
        return { state, count: list.length, costCents: list.reduce((sum, r) => sum + r.costCents, 0) };
      }),
      totalCostCents: all.reduce((sum, r) => sum + r.costCents, 0),
      storeCredit: storeCreditOutstanding(db, s.ctx),
      rows,
    };
  });

  guarded(
    "reports:valuation",
    "reports.costs",
    ReportsValuationRequestSchema,
    ReportsValuationResponseSchema,
    (s, input) => valuation(db, s.ctx, input),
  );

  guarded(
    "reports:deadStock",
    "reports.costs",
    ReportsDeadStockRequestSchema,
    ReportsDeadStockResponseSchema,
    (s, input) => {
      const thresholdDays = getSettings(db, s.ctx).deadStockDays;
      const rows = deadStock(db, s.ctx, { ...input, thresholdDays });
      return { thresholdDays, totalCostCents: rows.reduce((sum, r) => sum + r.costTiedUpCents, 0), rows };
    },
  );

  /**
   * Export.
   *
   * The permission is the exported REPORT's own, chosen per call — a cost-bearing
   * report cannot be exported by somebody who may not see it on screen, and the
   * Sales export drops its cost columns for a caller without them.
   */
  guarded(
    "reports:export",
    (req: { report: ReportId }) => reportPermission(req.report),
    ReportsExportRequestSchema,
    ReportsExportResponseSchema,
    (s, input) => exportReport(db, s.ctx, { report: input.report, filters: input.filters }, canCosts(s)),
  );
}



/**
 * Park whatever is on the screen when someone switches user.
 *
 * Abandoning it would leave the next cashier's lines mixed with the last one's
 * under a single attribution, which is exactly the thing this slice exists to
 * prevent.
 */
function parkOpenCart(db: ArkomDb, session: AuthedSession): string | null {
  try {
    const draft = currentDraft(db, session.ctx);
    if (!draft || draft.lines.length === 0) return null;
    const at = new Date();
    const stamp = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
    park(db, session.ctx, { docId: draft.docId, label: `Cambio de usuario · ${session.name} · ${stamp}` });
    return draft.docId;
  } catch (err) {
    // never let a parking problem trap someone in a session they want to leave
    console.error("[auth] could not park the open cart on logout:", err);
    return null;
  }
}
