/**
 * A backup is two artefacts now.
 *
 * Device and ID photographs live beside the database rather than inside it
 * (ADR-0013 §3), which is right for the database and puts an obligation on the
 * backup: the pair has to travel together, prune together, and fail together.
 * A backup that quietly dropped the photographs would look complete until the
 * day it was needed — which is the only day it matters.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "./electron-stub";
import { uuidv7 } from "@arkom/core";
import { photosRoot, savePurchasePhotos } from "../photos";

const JPEG_1PX =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
  "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAA" +
  "AAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

describe("the photos folder", () => {
  it("lives beside the database, under the shop's one data folder", () => {
    // a restore that takes "the shop's folder" has to get both without thinking
    expect(photosRoot().startsWith(app.getPath())).toBe(true);
    expect(photosRoot().endsWith("photos")).toBe(true);
  });

  it("stores a path relative to that root, so the folder can move", async () => {
    const purchaseId = uuidv7();
    const saved = await savePurchasePhotos(purchaseId, [{ kind: "front", dataUrl: JPEG_1PX }]);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.relativePath).toBe(`purchases/${purchaseId}/front.jpg`);
    // never a drive letter or a leading slash: those pin the shop to one machine
    expect(saved[0]!.relativePath).not.toMatch(/^[A-Za-z]:|^\//);
    expect(existsSync(saved[0]!.absolutePath)).toBe(true);
  });

  it("keeps both extra shots rather than overwriting one with the other", async () => {
    const purchaseId = uuidv7();
    const saved = await savePurchasePhotos(purchaseId, [
      { kind: "extra", dataUrl: JPEG_1PX },
      { kind: "extra", dataUrl: JPEG_1PX },
    ]);
    expect(saved.map((p) => p.relativePath.split("/").pop()).sort()).toEqual(["extra-2.jpg", "extra.jpg"]);
  });

  it("refuses a path that climbs out of the photos folder", async () => {
    const { resolvePhotoPath } = await import("../photos");
    expect(() => resolvePhotoPath("../../arkom-pos.db")).toThrow();
    expect(() => resolvePhotoPath("purchases/x/front.jpg")).not.toThrow();
  });
});
