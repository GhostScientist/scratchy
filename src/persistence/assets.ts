import { idbGet, idbGetAll, idbPut, idbDelete, STORE_ASSETS } from './db';

/** Pixel data behind an ImageElement. Blobs store natively in IDB (like
 *  takes); elements only carry the id, so undo/redo never touches pixels. */
export interface StoredAsset {
  id: string;
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  createdAt: number;
}

export async function putAsset(asset: StoredAsset): Promise<boolean> {
  try {
    await idbPut(STORE_ASSETS, asset);
    return true;
  } catch {
    return false;
  }
}

export async function getAsset(id: string): Promise<StoredAsset | null> {
  try {
    return (await idbGet<StoredAsset>(STORE_ASSETS, id)) ?? null;
  } catch {
    return null;
  }
}

export async function deleteAsset(id: string): Promise<void> {
  try {
    await idbDelete(STORE_ASSETS, id);
  } catch {
    // Best effort — an orphan asset only costs storage.
  }
}

/**
 * Delete every asset not in `referenced`. Undo can't resurrect elements
 * across a board delete or reload, so anything unreferenced by any page of
 * any board is safe to drop. Best effort.
 */
export async function sweepOrphanAssets(referenced: ReadonlySet<string>): Promise<void> {
  try {
    const all = await idbGetAll<StoredAsset>(STORE_ASSETS);
    for (const asset of all) {
      if (!referenced.has(asset.id)) await idbDelete(STORE_ASSETS, asset.id);
    }
  } catch {
    // Best effort.
  }
}

// Test hook: lets e2e tests seed assets without a file chooser.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__scratchyAssets = {
    putAsset,
    getAsset,
    deleteAsset,
  };
}
