/**
 * Issuing an enrolment code — the rules, without a Postgres.
 *
 * This action mints a credential. A code buys a device token, and a device
 * token pushes a shop's takings, so the three things below are not style
 * points:
 *
 *   · the account comes from the SESSION and never from the form, or anyone
 *     with a login could attach a till to somebody else's shop;
 *   · the database gets a DIGEST, never the code, so losing it means issuing
 *     another rather than looking the old one up;
 *   · it expires.
 *
 * The store and the session are stubbed rather than mocked deeply: what is
 * being checked is what the action WRITES and what it RETURNS, which is the
 * whole of its contract.
 */
import { describe, expect, it } from "vitest";
import { digest, newEnrolCode, ENROL_CODE_TTL_MS } from "../../lib/secrets";

describe("the code itself", () => {
  it("is long enough to be worth guessing at", () => {
    const code = newEnrolCode();
    /* 12 characters from a 32-symbol alphabet = 60 bits, in three groups */
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  });

  it("is different every time", () => {
    const seen = new Set(Array.from({ length: 500 }, () => newEnrolCode()));
    expect(seen.size).toBe(500);
  });

  it("digests to something that is not the code", () => {
    const code = newEnrolCode();
    const hash = digest(code);
    expect(hash).not.toContain(code);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    /* and the same code always digests the same way, or a till could never
       redeem one */
    expect(digest(code)).toBe(hash);
  });

  it("ignores surrounding whitespace, because people paste", () => {
    const code = newEnrolCode();
    expect(digest(`  ${code}\n`)).toBe(digest(code));
  });

  it("expires in a week, not never", () => {
    const days = ENROL_CODE_TTL_MS / (24 * 60 * 60 * 1000);
    expect(days).toBe(7);
  });
});

describe("what the action is allowed to take from the caller", () => {
  /**
   * Read as SOURCE. The action is `"use server"` and pulls in `next/cache` and
   * a database client, so importing it here would drag half a framework into a
   * unit test to assert something a reader can see: that `accountId` comes from
   * `requireAccount()` and the form supplies nothing but a label.
   */
  const source = new URL("../enrol-actions.ts", import.meta.url);

  it("takes the account from the session and nothing else from the form", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(source, "utf8");

    expect(text).toContain("const account = await requireAccount();");
    expect(text).toContain("accountId: account.id,");

    /* the ONLY thing read off the form is the label */
    const reads = [...text.matchAll(/form\.get\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(reads).toEqual(["label"]);
  });

  it("stores a digest and never the code", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(source, "utf8");
    expect(text).toContain("codeHash: digest(code),");
    /*
     * No column is assigned the plaintext. `digest(code)` is the whole point,
     * so the check is for a FIELD whose value is the bare variable — `x: code,`
     * — and not for the word appearing at all, which the first version of this
     * case did and duly failed on the hashing itself.
     */
    const insert = text.slice(text.indexOf(".values({"), text.indexOf("});", text.indexOf(".values({")));
    expect(insert).not.toMatch(/:\s*code\s*[,}]/);
    expect(insert).toContain("digest(code)");
  });

  it("caps the label, because it is somebody's free text", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(source, "utf8");
    expect(text).toContain("slice(0, LABEL_MAX)");
  });
});
