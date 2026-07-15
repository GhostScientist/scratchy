import { putAsset } from '../persistence/assets';
import { seedImageBitmap } from '../lib/imageCache';
import { nextId } from '../types';
import type { ImageElement } from '../types';
import type { InkEngine } from '../ink/InkEngine';
import type { Viewport } from '../ink/Viewport';

/** Encoded blobs above this are refused — decoding them can stall a tablet. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export interface ImportDeps {
  engine: InkEngine;
  viewport: Viewport;
  toast(text: string): void;
}

/** Place a w×h box centered in the visible world, capped to 80% of the view. */
export function fitInView(
  viewport: Viewport,
  naturalW: number,
  naturalH: number,
): { x: number; y: number; w: number; h: number } {
  const view = viewport.visibleWorldRect();
  const viewW = view.maxX - view.minX;
  const viewH = view.maxY - view.minY;
  const scale = Math.min(1, (viewW * 0.8) / naturalW, (viewH * 0.8) / naturalH);
  const w = naturalW * scale;
  const h = naturalH * scale;
  return {
    x: view.minX + (viewW - w) / 2,
    y: view.minY + (viewH - h) / 2,
    w,
    h,
  };
}

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
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

/**
 * Import image files as movable elements centered in the current view.
 * Assets go to IndexedDB; the decoded bitmap seeds the render cache so the
 * image appears instantly, not as a placeholder.
 */
export async function importImageFiles(files: File[], deps: ImportDeps): Promise<void> {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    if (file.size > MAX_FILE_BYTES) {
      deps.toast(`"${file.name}" is too large to import (20 MB max).`);
      continue;
    }
    let bitmap: ImageBitmap | HTMLImageElement;
    try {
      bitmap = await decodeImage(file);
    } catch {
      deps.toast(`Could not read "${file.name}".`);
      continue;
    }
    const naturalW = 'naturalWidth' in bitmap ? bitmap.naturalWidth : bitmap.width;
    const naturalH = 'naturalHeight' in bitmap ? bitmap.naturalHeight : bitmap.height;
    if (naturalW === 0 || naturalH === 0) {
      deps.toast(`Could not read "${file.name}".`);
      continue;
    }
    const assetId = nextId('as');
    const stored = await putAsset({
      id: assetId,
      blob: file,
      mime: file.type,
      width: naturalW,
      height: naturalH,
      createdAt: Date.now(),
    });
    if (!stored) {
      deps.toast('Could not save the image — device storage may be full.');
      return;
    }
    seedImageBitmap(assetId, bitmap);
    const el: ImageElement = {
      kind: 'image',
      id: nextId('im'),
      assetId,
      ...fitInView(deps.viewport, naturalW, naturalH),
      naturalW,
      naturalH,
    };
    deps.engine.addImageElement(el);
  }
}
