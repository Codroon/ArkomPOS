import { describe, expect, it } from "vitest";
import { AppError, appError, parseIpcError, toBridgeError } from "../errors";

describe("typed error factory (§4)", () => {
  it("builds an AppError carrying the typed envelope", () => {
    const err = appError("DUPLICATE_BARCODE", "Ese código ya existe.", "barcode");
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
    expect(err.ipc).toEqual({ code: "DUPLICATE_BARCODE", message: "Ese código ya existe.", field: "barcode" });
  });

  it("omits field when not provided", () => {
    expect(appError("VALIDATION", "Falta el grupo.").ipc).toEqual({
      code: "VALIDATION",
      message: "Falta el grupo.",
    });
  });

  it("round-trips through the bridge serialization", () => {
    const wire = toBridgeError(appError("NEGATIVE_STOCK", "Sin stock suficiente."));
    expect(parseIpcError(wire)).toEqual({ code: "NEGATIVE_STOCK", message: "Sin stock suficiente." });
  });

  it("survives Electron's remote-method message wrapping", () => {
    const inner = toBridgeError(appError("VALIDATION", "Falta el coste.", "costCents")).message;
    const wrapped = new Error(`Error invoking remote method 'catalog:save': Error: ${inner}`);
    expect(parseIpcError(wrapped)).toEqual({
      code: "VALIDATION",
      message: "Falta el coste.",
      field: "costCents",
    });
  });

  it("returns null for non-typed errors instead of inventing a code", () => {
    expect(parseIpcError(new Error("ECONNRESET"))).toBeNull();
    expect(parseIpcError(new Error('{"code":"NOT_A_CODE","message":"x"}'))).toBeNull();
    expect(parseIpcError(undefined)).toBeNull();
    expect(parseIpcError("plain string")).toBeNull();
  });
});
