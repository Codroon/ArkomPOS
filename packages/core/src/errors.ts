/**
 * Typed error factory for the §4 IPC contract. Main-process code throws
 * AppError; the handler layer serializes it into the rejection message
 * (Electron only transports `message`); the renderer recovers the typed
 * envelope with parseIpcError and maps codes to UI — never string-matching.
 */
import { IpcErrorSchema, type ErrorCode, type IpcError } from "./ipc";

export class AppError extends Error {
  readonly ipc: IpcError;
  constructor(ipc: IpcError) {
    super(ipc.message);
    this.name = "AppError";
    this.ipc = ipc;
  }
}

export function appError(code: ErrorCode, message: string, field?: string): AppError {
  return new AppError(field === undefined ? { code, message } : { code, message, field });
}

/** The wire form: an Error whose message is the JSON envelope. */
export function toBridgeError(error: AppError): Error {
  return new Error(JSON.stringify(error.ipc));
}

/**
 * Recover the typed envelope from a bridge rejection. Electron wraps it as
 * "Error invoking remote method 'x': Error: {json}", so parse from the first
 * '{'. Returns null for anything that isn't a typed error (bugs, infra
 * failures) — the UI shows those as a generic failure, never invents a code.
 */
export function parseIpcError(error: unknown): IpcError | null {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : null;
  if (!message) return null;
  const start = message.indexOf("{");
  if (start === -1) return null;
  try {
    const result = IpcErrorSchema.safeParse(JSON.parse(message.slice(start)));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
