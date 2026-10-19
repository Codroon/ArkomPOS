/**
 * pnpm cloud:audit -- "<account name or id>"
 *
 * Rebuilds one account's business from its raw sync stream, independently of
 * the dashboard's queries, and checks every screen against the rebuild:
 * receipts and their lines, totals, top products, catalogue and stock,
 * repairs, used purchases, transfers, shifts and store credit, plus the till's
 * own rules (series without gaps, no negative stock, every sale paid). Read-only.
 * Run it before any deploy, beside db:truth + cloud:reconcile.
 */
import { spawnSync } from "node:child_process";

/* pnpm hands the "--" separator through as an argument */
const account = process.argv.slice(2).filter((a) => a !== "--").join(" ").trim();
if (!account) {
  console.error('usage: pnpm cloud:audit -- "<account name or id>"');
  process.exit(2);
}

const run = spawnSync(
  "npx",
  ["vitest", "run", "--config", "vitest.integration.config.ts", "src/db/__tests__/cloud-audit.integration.test.ts"],
  { stdio: "inherit", shell: true, env: { ...process.env, AUDIT_ACCOUNT: account } },
);
process.exit(run.status ?? 1);
