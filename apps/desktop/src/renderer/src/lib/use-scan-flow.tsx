/**
 * One scan pipeline for every screen: code → `scan:resolve` → either the
 * instant path (exactly one match), the ambiguity picker, or the unknown-code
 * rescue. Screens supply what to do with a product/unit and get back a
 * `resolve()` plus the modals to render.
 */
import { useCallback, useRef, useState, type ReactNode } from "react";
import type { ScanMatch, ScanProduct, ScanUnit } from "@arkom/core";
import { useT } from "@arkom/ui";
import { ScanPickerModal } from "../components/scan-picker-modal";
import { UnknownCodeModal } from "../components/unknown-code-modal";
import { errorMessage } from "./errors";

export interface ScanFlowHandlers {
  onProduct: (product: ScanProduct, code: string) => void;
  onUnit: (unit: ScanUnit, product: ScanProduct, code: string) => void;
  /** rescue: create a new product with the code prefilled */
  onCreateProduct: (code: string) => void;
  onError?: (message: string) => void;
  /** rescue: the code was attached to an existing product (toast, etc.) */
  onAttached?: (product: ScanProduct, code: string) => void;
  /** the code matched nothing — the rescue modal opens; screens may also shake */
  onUnknown?: (code: string) => void;
}

export function useScanFlow(handlers: ScanFlowHandlers): {
  resolve: (code: string) => void;
  modals: ReactNode;
  /** true while the picker or the rescue is up — hosts must not treat Esc as their own */
  isModalOpen: boolean;
} {
  const t = useT();
  const ref = useRef(handlers);
  ref.current = handlers; // keep resolve() stable while always calling the latest handlers

  const [ambiguous, setAmbiguous] = useState<{ code: string; matches: ScanMatch[] } | null>(null);
  const [unknown, setUnknown] = useState<{
    code: string;
    unavailableUnit?: { imei: string; status: string; productName: string };
  } | null>(null);

  const deliver = useCallback((match: ScanMatch, code: string) => {
    if (match.kind === "product") ref.current.onProduct(match.product, code);
    else ref.current.onUnit(match.unit, match.product, code);
  }, []);

  const resolve = useCallback(
    (rawCode: string) => {
      const code = rawCode.trim();
      if (code === "") return;
      window.arkom
        .invoke("scan:resolve", { code })
        .then((result) => {
          if (result.kind === "product") ref.current.onProduct(result.product, code);
          else if (result.kind === "unit") ref.current.onUnit(result.unit, result.product, code);
          else if (result.kind === "ambiguous") setAmbiguous({ code: result.code, matches: result.matches });
          else {
            setUnknown({ code: result.code, unavailableUnit: result.unavailableUnit });
            ref.current.onUnknown?.(result.code);
          }
        })
        .catch((err) => ref.current.onError?.(errorMessage(t, err)));
    },
    [t],
  );

  const modals = (
    <>
      {ambiguous ? (
        <ScanPickerModal
          code={ambiguous.code}
          matches={ambiguous.matches}
          onPick={(match) => {
            const code = ambiguous.code;
            setAmbiguous(null);
            deliver(match, code);
          }}
          onClose={() => setAmbiguous(null)}
        />
      ) : null}
      {unknown ? (
        <UnknownCodeModal
          code={unknown.code}
          unavailableUnit={unknown.unavailableUnit}
          onCreateProduct={(code) => {
            setUnknown(null);
            ref.current.onCreateProduct(code);
          }}
          onAttached={(product, code) => {
            setUnknown(null);
            // resume FIRST: selecting the product resets the screen's notice,
            // so the confirmation has to be the last thing written
            ref.current.onProduct(product, code);
            ref.current.onAttached?.(product, code);
          }}
          onClose={() => setUnknown(null)}
        />
      ) : null}
    </>
  );

  return { resolve, modals, isModalOpen: ambiguous !== null || unknown !== null };
}
