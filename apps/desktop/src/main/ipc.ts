/**
 * IPC handlers — contract in docs/design/system-design.md §4, schemas in
 * @arkom/core ipc.ts. Handlers do no business math (that lives in core);
 * requests and results are Zod-parsed on this side of the bridge, and failures
 * cross as typed error envelopes (the renderer maps codes, never messages).
 */
import { ipcMain } from "electron";
import {
  MetaContextRequestSchema,
  MetaContextResponseSchema,
  type IpcError,
} from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";

/** Throw a typed IPC error — Electron serializes the message across the bridge. */
function ipcError(error: IpcError): never {
  throw new Error(JSON.stringify(error));
}

export function registerIpcHandlers(db: ArkomDb): void {
  ipcMain.handle("meta:context", (_event, payload: unknown) => {
    MetaContextRequestSchema.parse(payload);
    const tenant = db.select().from(schema.tenants).limit(1).all()[0];
    const location = db.select().from(schema.locations).limit(1).all()[0];
    const terminal = db.select().from(schema.terminals).limit(1).all()[0];
    if (!tenant || !location || !terminal) {
      ipcError({ code: "VALIDATION", message: "Base de datos vacía — ejecuta `pnpm db:seed`." });
    }
    return MetaContextResponseSchema.parse({
      tenant: { id: tenant.id, name: tenant.name },
      location: { id: location.id, name: location.name },
      terminal: { id: terminal.id, name: terminal.name },
    });
  });
}
