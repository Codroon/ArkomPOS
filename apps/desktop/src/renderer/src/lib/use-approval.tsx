/**
 * The approval flow, from the renderer's side (ADR-0012 §5).
 *
 * A call site wraps its invoke in `run()`. If the guard in main answers
 * APPROVAL_REQUIRED, the modal opens, collects an owner's PIN, and the SAME
 * call is retried with it — so the action executes in one IPC call with both
 * `user_id` and `authorized_by_user_id` stamped, and the caller's code is
 * unchanged from the happy path.
 *
 * Nothing is remembered. Single-use is the design, not an oversight: a
 * "stay authorized for five minutes" window is exactly what a cashier learns
 * to exploit.
 */
import { useCallback, useState } from "react";
import { permissionLabelEs, type PermissionKey } from "@arkom/core";
import { usePermissionLabel } from "@arkom/ui";
import { ApprovalModal, type ApprovalDetail } from "../components/approval-modal";
import { ipcOf } from "./errors";

export type Approval = { userId: string; pin: string };

export interface ApprovalRequest {
  /** shown as the modal's title — plain Spanish, never a raw key */
  title: string;
  /** the specifics the approver needs to judge it */
  details: ApprovalDetail[];
}

interface Pending {
  permission: PermissionKey;
  request: ApprovalRequest;
  resolve: (approval: Approval | null) => void;
}

export function useApprovalFlow() {
  const permLabel = usePermissionLabel();
  const [pending, setPending] = useState<Pending | null>(null);

  /**
   * Run an action that may need approval.
   *
   * `call` is invoked immediately without approval; only if main asks does the
   * modal appear. That ordering matters — an owner doing this themselves must
   * never see a keypad (spec E7).
   */
  const run = useCallback(
    async <T,>(
      call: (approval?: Approval) => Promise<T>,
      permission: PermissionKey,
      request: ApprovalRequest,
    ): Promise<T> => {
      try {
        return await call();
      } catch (err) {
        const ipc = ipcOf(err);
        if (ipc?.code !== "APPROVAL_REQUIRED") throw err;

        const approval = await new Promise<Approval | null>((resolve) => {
          setPending({ permission, request, resolve });
        });
        setPending(null);
        // a cancel is a decision, and main has already logged the denial path;
        // rethrowing the original keeps the caller's error handling intact
        if (!approval) throw err;
        return await call(approval);
      }
    },
    [],
  );

  const modal = pending ? (
    <ApprovalModal
      title={pending.request.title}
      permissionLabel={permLabel(pending.permission, permissionLabelEs(pending.permission))}
      details={pending.request.details}
      onCancel={() => pending.resolve(null)}
      onApprove={(approval) => pending.resolve(approval)}
    />
  ) : null;

  return { run, modal };
}
