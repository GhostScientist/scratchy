import { getAsset } from '../persistence/assets';
import type { BoardElement } from '../types';

/**
 * Decoded-bitmap cache for image elements. drawElement is synchronous but
 * assets load async, so a lookup miss kicks off the load and returns null —
 * callers draw a placeholder and repaint when onImageCacheChange fires.
 *
 * Keyed by assetId (a string), NOT element identity: move/resize/lock all
 * replace the element object but keep pointing at the same pixels.
 */

type Entry =
  | { state: 'ready'; bitmap: ImageBitmap | HTMLImageElement }
  | { state: 'loading' }
  | { state: 'missing' };

/** Decoded 2000px-class bitmaps are ~10-30 MB each; cap the working set so a
 *  long PDF can't OOM a tablet. Evicted entries re-load on demand. */
const MAX_ENTRIES = 40;

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

/** Fires whenever an asset finishes loading (or resolves to missing). */
export function onImageCacheChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function closeEntry(entry: Entry): void {
  if (entry.state === 'ready' && 'close' in entry.bitmap) entry.bitmap.close();
}

/** Map preserves insertion order — re-inserting on hit makes eviction LRU. */
function touch(id: string, entry: Entry): void {
  cache.delete(id);
  cache.set(id, entry);
  if (cache.size <= MAX_ENTRIES) return;
  for (const [key, value] of cache) {
    if (value.state !== 'ready') continue;
    cache.delete(key);
    closeEntry(value);
    if (cache.size <= MAX_ENTRIES) break;
  }
}

async function decode(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(blob);
  } catch {
    // Older Safari: fall back to a decoded <img>, drawable by drawImage too.
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function load(assetId: string): Promise<void> {
  try {
    const asset = await getAsset(assetId);
    if (!asset) {
      cache.set(assetId, { state: 'missing' });
      notify();
      return;
    }
    const bitmap = await decode(asset.blob);
    touch(assetId, { state: 'ready', bitmap });
  } catch {
    cache.set(assetId, { state: 'missing' });
  }
  notify();
}

/** Sync lookup; a miss starts the async load and returns null for now. */
export function getImageBitmap(assetId: string): ImageBitmap | HTMLImageElement | null {
  const entry = cache.get(assetId);
  if (entry) {
    if (entry.state === 'ready') {
      touch(assetId, entry);
      return entry.bitmap;
    }
    return null;
  }
  cache.set(assetId, { state: 'loading' });
  void load(assetId);
  return null;
}

/** Import already decoded the bitmap — skip the placeholder flash. */
export function seedImageBitmap(assetId: string, bitmap: ImageBitmap | HTMLImageElement): void {
  const existing = cache.get(assetId);
  if (existing) closeEntry(existing);
  touch(assetId, { state: 'ready', bitmap });
}

export function evictAsset(assetId: string): void {
  const entry = cache.get(assetId);
  if (!entry) return;
  cache.delete(assetId);
  closeEntry(entry);
}

/** Await bitmaps for every image element — PNG export and thumbnails call
 *  this so their synchronous render pass never hits a placeholder. */
export async function preloadImages(elements: readonly BoardElement[]): Promise<void> {
  const waiting = new Set<string>();
  for (const el of elements) {
    if (el.kind !== 'image') continue;
    const entry = cache.get(el.assetId);
    if (entry?.state === 'ready' || entry?.state === 'missing') continue;
    waiting.add(el.assetId);
    getImageBitmap(el.assetId);
  }
  if (waiting.size === 0) return;
  await new Promise<void>((resolve) => {
    const check = () => {
      for (const id of waiting) {
        const entry = cache.get(id);
        if (entry?.state === 'ready' || entry?.state === 'missing') waiting.delete(id);
      }
      if (waiting.size === 0) {
        unsubscribe();
        resolve();
      }
    };
    const unsubscribe = onImageCacheChange(check);
    check();
  });
}
