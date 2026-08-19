import { describe, expect, it } from "vitest";
import { uuidv7, uuidv7Timestamp } from "../ids";

const UUIDV7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("uuidv7", () => {
  it("matches the RFC 9562 v7 format (version and variant bits)", () => {
    for (let i = 0; i < 1000; i++) {
      expect(uuidv7()).toMatch(UUIDV7_RE);
    }
  });

  it("never collides across a large batch", () => {
    const n = 50_000;
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) seen.add(uuidv7());
    expect(seen.size).toBe(n);
  });

  it("is monotonic: sequential ids sort by creation order", () => {
    const ids = Array.from({ length: 10_000 }, () => uuidv7());
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it("embeds the current unix-ms timestamp", () => {
    const before = Date.now();
    const id = uuidv7();
    const after = Date.now();
    const ts = uuidv7Timestamp(id);
    // monotonic counter may borrow +1ms under burst; allow slack
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 5);
  });
});
