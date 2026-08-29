/**
 * Photographs of purchased devices.
 *
 * **Files on disk, paths in the database, never blobs** (ADR-0013 §3). A
 * hundred phone photos in SQLite is a database the online-backup API has to
 * copy in full every night and a WAL that never settles; the same hundred as
 * JPEGs are a folder the backup copies alongside it.
 *
 * The folder lives beside the database under userData, so "the shop's data" is
 * one directory and a restore that takes the database has an obvious sibling to
 * take with it.
 */
import { app } from "electron";
import { mkdir, rm } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { PhotoKind } from "@arkom/core";

export interface SavedPhoto {
  kind: PhotoKind;
  /** stored in the DB: relative to photosRoot(), so moving the shop's folder works */
  relativePath: string;
  absolutePath: string;
}

export function photosRoot(): string {
  return join(app.getPath("userData"), "photos");
}

export function purchasePhotosDir(purchaseId: string): string {
  return join(photosRoot(), "purchases", purchaseId);
}

/** Absolute path for a stored relative path, refusing anything that escapes the root. */
export function resolvePhotoPath(relativePath: string): string {
  const root = resolve(photosRoot());
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error("photo path escapes the photos folder");
  }
  return target;
}

const DATA_URL_PREFIX = "data:image/jpeg;base64,";

/**
 * Write one intake's photos.
 *
 * Called BEFORE the purchase transaction opens, under the id about to be
 * inserted — see the note on logPurchase for why that direction is the right
 * one. Failures propagate: a purchase whose photos could not be written should
 * not be logged as though they exist.
 */
export async function savePurchasePhotos(
  purchaseId: string,
  photos: ReadonlyArray<{ kind: PhotoKind; dataUrl: string }>,
): Promise<SavedPhoto[]> {
  if (photos.length === 0) return [];

  const dir = purchasePhotosDir(purchaseId);
  await mkdir(dir, { recursive: true });

  const saved: SavedPhoto[] = [];
  const counts = new Map<PhotoKind, number>();

  for (const photo of photos) {
    if (!photo.dataUrl.startsWith(DATA_URL_PREFIX)) {
      throw new Error(`unexpected photo encoding for ${photo.kind}`);
    }
    // two "extra" slots share a kind, so the second gets a suffix rather than
    // silently overwriting the first
    const n = (counts.get(photo.kind) ?? 0) + 1;
    counts.set(photo.kind, n);
    const name = n === 1 ? `${photo.kind}.jpg` : `${photo.kind}-${n}.jpg`;

    const absolutePath = join(dir, name);
    await writeFile(absolutePath, Buffer.from(photo.dataUrl.slice(DATA_URL_PREFIX.length), "base64"));
    saved.push({
      kind: photo.kind,
      relativePath: relative(photosRoot(), absolutePath).split(sep).join("/"),
      absolutePath,
    });
  }
  return saved;
}

/**
 * Remove an intake's folder.
 *
 * Only ever called to clean up after a transaction that failed after the files
 * were written. Nothing in the app deletes a logged purchase's photos: they are
 * part of a record the shop is required to keep.
 */
export async function discardPurchasePhotos(purchaseId: string): Promise<void> {
  await rm(purchasePhotosDir(purchaseId), { recursive: true, force: true }).catch(() => {
    // best effort: an orphaned folder is untidy, not broken
  });
}
