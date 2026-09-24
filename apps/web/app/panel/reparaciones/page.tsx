/**
 * Reparaciones — every ticket the workshop holds.
 *
 * The status column is the one the till DERIVED and stored (ADR-0014 §1). It is
 * displayed, never recomputed: working it out again here would be a second
 * implementation of a rule whose whole point is that there is only one.
 *
 * There is no passcode column, and there never will be. It is stripped before
 * the row leaves the shop (ADR-0020 §3), so the cloud has nothing to show and
 * nothing to leak.
 */
import Link from "next/link";
import { requireAccount } from "../../../src/auth/session";
import { getT } from "../../../src/i18n/server";
import { repairsForAccount } from "../../../src/db/workshop-queries";
import { dateTime, euros } from "../../../src/lib/format";
import { Card, CardBody, CardHead, Chip, EmptyState, Stat, TD, TH, TR, Table } from "../../../src/ui";

export const dynamic = "force-dynamic";

/** Which statuses still owe the customer something. */
const OPEN = new Set(["received", "quoted", "waiting_part", "in_repair"]);

const TONE: Record<string, "neutral" | "ok" | "warn" | "bad"> = {
  received: "neutral",
  quoted: "neutral",
  waiting_part: "warn",
  in_repair: "warn",
  ready: "ok",
  collected: "neutral",
  not_repaired: "bad",
};

export default async function RepairsPage() {
  const account = await requireAccount();
  const { t } = await getT();
  const repairs = await repairsForAccount(account.id);

  if (repairs.length === 0) {
    return (
      <Card>
        <EmptyState title={t("rp.empty")} hint={t("rp.emptyHint")} />
      </Card>
    );
  }

  const open = repairs.filter((row) => OPEN.has(row.status));
  const ready = repairs.filter((row) => row.status === "ready");
  const deposits = open.reduce((sum, row) => sum + row.depositCents, 0);

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap divide-line sm:divide-x">
        <Stat label={t("rp.open")} value={String(open.length)} />
        <Stat label={t("rp.ready")} value={String(ready.length)} />
        <Stat label={t("rp.deposit")} value={euros(deposits)} sub={t("rp.open")} />
      </Card>

      <Card>
        <CardHead title={t("rp.title")} hint={t("rp.hint")} />
        <CardBody className="pt-2">
          <Table>
            <thead>
              <tr>
                <TH>{t("rp.device")}</TH>
                <TH>{t("rp.customer")}</TH>
                <TH>{t("rp.fault")}</TH>
                <TH>{t("doc.when")}</TH>
                <TH right>{t("rp.parts")}</TH>
                <TH right>{t("rp.quoted")}</TH>
                <TH right>{t("rp.deposit")}</TH>
                <TH>{t("rp.status")}</TH>
              </tr>
            </thead>
            <tbody>
              {repairs.map((repair) => (
                <TR key={repair.id}>
                  <TD>
                    <Link
                      className="underline underline-offset-2"
                      href={`/panel/reparaciones/${repair.id}`}
                    >
                      {repair.device}
                    </Link>
                    {repair.imei ? (
                      <div className="tabular text-[11px] text-muted">{repair.imei}</div>
                    ) : null}
                  </TD>
                  <TD>{repair.customerName ?? "—"}</TD>
                  <TD className="max-w-[260px] text-muted">{repair.fault ?? "—"}</TD>
                  <TD>{dateTime(repair.createdAt)}</TD>
                  <TD right>{repair.parts}</TD>
                  <TD right>{euros(repair.quotedCents)}</TD>
                  <TD right>{repair.depositCents > 0 ? euros(repair.depositCents) : "—"}</TD>
                  <TD>
                    <Chip tone={TONE[repair.status] ?? "neutral"}>
                      {t(`rps.${repair.status}` as "rps.received")}
                    </Chip>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
