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
import { listPrinters, printTest, printTicket, revealTicket, ticketsDir, printRecoveryCode } from "./print";
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
  guarded("settings:save", "settings.edit", SettingsSaveRequestSchema, SettingsSaveResponseSchema, (s, patch) =>
    saveSettings(db, s.ctx, patch),
  );
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
