/**
 * Issue an enrolment code for an account — the operator's side of ADR-0020 §1.
 *
 * This exists because the dashboard does not yet. When it does, it issues codes
 * the same way and this stays as the way to do it with no browser. It prints
 * the code ONCE: the database only ever holds a digest, so a code that scrolls
 * off the screen is gone and the answer is to issue another.
 *
 *   pnpm --filter @arkom/web cloud:code -- --email ana@tienda.es --name "Ana García"
 *   pnpm --filter @arkom/web cloud:code -- --email ana@tienda.es --label "caja de arriba"
 *
 * Run with Node's type stripping (the package script does): it imports the real
 * schema and the real `uuidv7`, rather than a second copy of either.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { uuidv7 } from "../../../packages/core/src/ids.ts";
import { accounts, enrolCodes } from "../src/db/schema.ts";
import { digest, newEnrolCode, ENROL_CODE_TTL_MS } from "../src/lib/secrets.ts";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const email = arg("email")?.trim().toLowerCase();
const name = arg("name")?.trim();
const label = arg("label")?.trim() ?? "";

if (!email) {
  console.error("usage: cloud:code -- --email <address> [--name \"Account name\"] [--label \"which till\"]");
  process.exit(2);
}

/* the direct connection, like migrations: a one-off script has no reason to go
   through a pooler sized for a serving app */
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL is not set. Put it in apps/web/.env.local (see .env.example).");
  process.exit(2);
}

const client = postgres(url, { prepare: false, max: 1 });
const db = drizzle(client, { schema: { accounts, enrolCodes } });

const existing = await db.select().from(accounts).where(eq(accounts.email, email)).limit(1);
let accountId = existing[0]?.id;

if (!accountId) {
  if (!name) {
    console.error(`No account for ${email}. Pass --name to create one.`);
    process.exit(2);
  }
  accountId = uuidv7();
  await db.insert(accounts).values({ id: accountId, name, email });
  console.log(`created account  ${name} <${email}>`);
}

const code = newEnrolCode();
const expiresAt = new Date(Date.now() + ENROL_CODE_TTL_MS);

await db.insert(enrolCodes).values({
  id: uuidv7(),
  accountId,
  codeHash: digest(code),
  label,
  expiresAt,
});

console.log("");
console.log(`  código de enlace   ${code}`);
console.log(`  caduca             ${expiresAt.toISOString().slice(0, 10)}`);
console.log(`  cuenta             ${email}`);
if (label) console.log(`  etiqueta           ${label}`);
console.log("");
console.log("Paste it into the till: Ajustes → Nube. It is shown once and used once.");

/* postgres.js holds the process open until the socket is closed */
await client.end();
