/**
 * The leak-finder itself.
 *
 * Two security assertions now depend on these two functions — the device
 * passcode never reaching an oplog payload, and the owner's PIN never reaching
 * the cloud. A helper that quietly found nothing would turn both of those into
 * tests that pass because they look in the wrong place, which is the worst
 * failure mode a test can have. So it gets its own cases.
 */
import { describe, expect, it } from "vitest";
import { keyNames, leafValues } from "./leaks";

describe("finding a value", () => {
  it("finds one buried at depth, in an array, inside an object", () => {
    const payload = { ticket: { device: { notes: [{ was: "0451" }] } } };
    expect(leafValues(payload)).toContain("0451");
  });

  it("finds one stored as a number rather than a string", () => {
    expect(leafValues({ pin: 4827 })).toContain("4827");
  });

  it("does NOT find one that is merely part of a longer value", () => {
    /* the whole point: a UUIDv7 containing those digits is not that secret, and
       a test that says otherwise fails about once in a hundred runs */
    const rows = [{ opId: "0199c0451f7e-7000-8a11-9999ab", createdAt: 1790000009999 }];
    expect(leafValues(rows)).not.toContain("0451");
    expect(leafValues(rows)).not.toContain("9999");
  });

  it("reads a Date as its ISO form rather than walking into it", () => {
    const when = new Date("2026-09-24T10:00:00.000Z");
    expect(leafValues({ when })).toEqual(["2026-09-24T10:00:00.000Z"]);
  });

  it("is not confused by null, undefined or an empty payload", () => {
    expect(leafValues(null)).toEqual([]);
    expect(leafValues({ a: null, b: undefined, c: {} })).toEqual([]);
  });
});

describe("finding a field name", () => {
  it("finds one at any depth, whatever it was set to", () => {
    const entry = { after: { device: { devicePasscode: "" } } };
    expect(keyNames(entry)).toContain("devicePasscode");
  });

  it("finds one inside an array of payloads", () => {
    expect(keyNames([{ ok: 1 }, { pinHash: "scrypt$..." }])).toContain("pinHash");
  });

  it("does not report a VALUE that happens to read like a field name", () => {
    expect(keyNames({ note: "devicePasscode" })).not.toContain("devicePasscode");
    expect(leafValues({ note: "devicePasscode" })).toContain("devicePasscode");
  });
});
