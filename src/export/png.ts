import { drawBackground } from '../lib/backgrounds';
import { drawElement, elementBBox, elementVisualPad } from '../lib/elements';
import type { InkEngine } from '../ink/InkEngine';
import type { Viewport } from '../ink/Viewport';
import { STAGE_WIDTH, STAGE_HEIGHT } from '../types';
import type { BackgroundKind, BoardElement, ViewportState } from '../types';

/** Longest edge of a whole-board export, so huge boards can't OOM a tab. */
const MAX_EDGE = 4096;
const BOARD_PADDING = 60; // world px around the ink

/**
 * Render a world rect into a fresh canvas and encode it as PNG.
 * view.x/y/zoom pick the world window; outW×outH is the output size in
 * stage px and outScale multiplies it into device px.
 */
async function renderPng(
  elements: readonly BoardElement[],
  background: BackgroundKind,
  view: ViewportState,
  outW: number,
  outH: number,
  outScale: number,
): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(outW * outScale);
  canvas.height = Math.round(outH * outScale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.setTransform(outScale, 0, 0, outScale, 0, 0);
  drawBackground(ctx, background, { ...view, outW, outH });

  const s = outScale * view.zoom;
  ctx.setTransform(s, 0, 0, s, -view.x * s, -view.y * s);
  const minX = view.x;
  const minY = view.y;
  const maxX = view.x + outW / view.zoom;
  const maxY = view.y + outH / view.zoom;
  for (const el of elements) {
    const box = elementBBox(el);
    const pad = elementVisualPad(el);
    if (
      box.maxX + pad < minX ||
      box.minX - pad > maxX ||
      box.maxY + pad < minY ||
      box.minY - pad > maxY
    ) {
      continue;
    }
    drawElement(ctx, el, true);
  }

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** PNG of exactly what the stage shows right now, at 2× (2560×1440). */
export function exportViewPng(engine: InkEngine, viewport: Viewport, background: BackgroundKind) {
  return renderPng(engine.getStrokes(), background, viewport.get(), STAGE_WIDTH, STAGE_HEIGHT, 2);
}

/** PNG of all ink with padding, regardless of the current viewport.
 *  Returns null when the board is empty. */
export function exportBoardPng(engine: InkEngine, background: BackgroundKind) {
  const box = engine.getInkBBox();
  if (!box) return Promise.resolve(null);
  const w = box.maxX - box.minX + BOARD_PADDING * 2;
  const h = box.maxY - box.minY + BOARD_PADDING * 2;
  // 2× for crispness, capped so the longest edge stays within MAX_EDGE.
  const zoom = Math.min(2, MAX_EDGE / w, MAX_EDGE / h);
  const view: ViewportState = { x: box.minX - BOARD_PADDING, y: box.minY - BOARD_PADDING, zoom };
  return renderPng(engine.getStrokes(), background, view, w * zoom, h * zoom, 1);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
