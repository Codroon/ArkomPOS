/**
 * The two secrets, and the promises made about them.
 *
 * A code is read off one screen and typed on another — usually by somebody on
 * the phone to their installer — so the alphabet has to be unambiguous and the
 * shape has to be the one the till's own validator accepts, or the shop is
 * stuck at the last step of setup with a code that cannot be right.
 */
import { describe, expect, it } from "vitest";
import { EnrolCodeSchema } from "@arkom/core";
import { bearerToken, digest, newDeviceToken, newEnrolCode } from "./secrets";

describe("enrolment codes", () => {
  it("always come out in the shape the till accepts", () => {
    for (let i = 0; i < 500; i += 1) {
      expect(EnrolCodeSchema.safeParse(newEnrolCode()).success).toBe(true);
    }
  });

  it("never contain a character somebody could read two ways", () => {
    /* no O against 0, no I against 1 — the difference is invisible in most of
       the fonts this will be displayed in */
    for (let i = 0; i < 500; i += 1) {
      expect(newEnrolCode()).not.toMatch(/[OI01]/);
    }
  });

  it("do not repeat", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => newEnrolCode()));
    expect(seen.size).toBe(2000);
  });
});

describe("device tokens", () => {
  it("are long, URL-safe and recognisable", () => {
    const token = newDeviceToken();
    expect(token.startsWith("cdrn_")).toBe(true);
    expect(token.length).toBeGreaterThanOrEqual(20);
    expect(token).toMatch(/^cdrn_[A-Za-z0-9_-]+$/);
  });

  it("do not repeat", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => newDeviceToken()));
    expect(seen.size).toBe(2000);
  });
});

describe("digests", () => {
  it("are stable, and are not the secret", () => {
    const token = newDeviceToken();
    expect(digest(token)).toBe(digest(token));
    expect(digest(token)).not.toContain(token.slice(5));
    expect(digest(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("survive the whitespace a paste brings with it", () => {
    expect(digest("  ABCD-EFGH-JKLM\n")).toBe(digest("ABCD-EFGH-JKLM"));
  });

  it("differ when the secret differs by one character", () => {
    expect(digest("ABCD-EFGH-JKLM")).not.toBe(digest("ABCD-EFGH-JKLN"));
  });
});

describe("reading the Authorization header", () => {
  it("takes the token out of a Bearer header, however it was capitalised", () => {
    expect(bearerToken("Bearer cdrn_abc")).toBe("cdrn_abc");
    expect(bearerToken("bearer cdrn_abc")).toBe("cdrn_abc");
    expect(bearerToken("  Bearer   cdrn_abc  ")).toBe("cdrn_abc");
  });

  it("refuses anything that is not one", () => {
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken("")).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
    expect(bearerToken("Basic dXNlcjpwYXNz")).toBeNull();
    expect(bearerToken("cdrn_abc")).toBeNull();
  });
});
