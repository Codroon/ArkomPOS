/**
 * Looking for a secret in a payload, without finding one by coincidence.
 *
 * The obvious assertion — `expect(JSON.stringify(rows)).not.toContain("0451")` —
 * searches a dump that also contains UUIDv7 ids and epoch timestamps. Those are
 * hex and digits, so a four-character secret turns up inside one roughly once in
 * a hundred runs, and the test fails having found nothing. A security assertion
 * that cries wolf at random is worse than no assertion: it teaches whoever sees
 * it next to re-run the suite instead of reading it.
 *
 * So: compare LEAF VALUES for equality, and KEY NAMES separately. A passcode is
 * a value; an id that happens to contain those four digits is not that value.
 * The key check is the stronger half — it catches a secret that reached the
 * payload under any name at all, whatever it was set to.
 */

/** Every leaf a JSON payload holds, as a string, at any depth. */
export function leafValues(value: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node instanceof Date) {
      out.push(node.toISOString());
      return;
    }
    if (typeof node === "object") {
      Object.values(node as Record<string, unknown>).forEach(walk);
      return;
    }
    out.push(String(node));
  };
  walk(value);
  return out;
}

/** Every key name a JSON payload uses, at any depth. */
export function keyNames(value: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object" || node instanceof Date) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    for (const [key, inner] of Object.entries(node as Record<string, unknown>)) {
      out.push(key);
      walk(inner);
    }
  };
  walk(value);
  return out;
}
