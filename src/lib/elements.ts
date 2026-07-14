/**
 * Rendering, bounds, and hit-testing for every board element kind. Strokes
 * delegate to lib/strokes.ts so its Path2D/bbox caches keep working; shapes
 * and text get the same treatment (WeakMap caches keyed on the immutable
 * committed element). Shared by the display engine, the recording
 * compositor, the minimap, and PNG export.
 */

import { drawStroke, strokeBBox } from './strokes';
import type { BBox } from './strokes';
import { distPointToSegment } from './geometry';
import { getImageBitmap } from './imageCache';
import type { BoardElement, ImageElement, ShapeElement, TextElement } from '../types';

export const TEXT_LINE_HEIGHT = 1.3;

export function textFont(fontSize: number): string {
  return `500 ${fontSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
}

/** Pre-element documents stored bare strokes — give them their discriminant. */
export function normalizeElement(el: BoardElement | Omit<BoardElement, 'kind'>): BoardElement {
  if (!('kind' in el) || el.kind === undefined) {
    return { ...(el as object), kind: 'stroke' } as BoardElement;
  }
  return el as BoardElement;
}

/** Normalized rect (positive w/h) for shapes dragged in any direction. */
function shapeRect(el: ShapeElement): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.min(el.x, el.x + el.w),
    y: Math.min(el.y, el.y + el.h),
    w: Math.abs(el.w),
    h: Math.abs(el.h),
  };
}

function shapePath(el: ShapeElement): Path2D {
  const path = new Path2D();
  if (el.shape === 'rect') {
    const r = shapeRect(el);
    path.rect(r.x, r.y, r.w, r.h);
  } else if (el.shape === 'ellipse') {
    const r = shapeRect(el);
    path.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
  } else {
    // line / arrow: the dragged segment.
    path.moveTo(el.x, el.y);
    path.lineTo(el.x + el.w, el.y + el.h);
    if (el.shape === 'arrow') {
      const angle = Math.atan2(el.h, el.w);
      const head = Math.max(el.strokeWidth * 3.5, 10);
      const tipX = el.x + el.w;
      const tipY = el.y + el.h;
      const spread = Math.PI / 7;
      path.moveTo(tipX - head * Math.cos(angle - spread), tipY - head * Math.sin(angle - spread));
      path.lineTo(tipX, tipY);
      path.lineTo(tipX - head * Math.cos(angle + spread), tipY - head * Math.sin(angle + spread));
    }
  }
  return path;
}

const shapePathCache = new WeakMap<ShapeElement, Path2D>();

interface TextMetricsBox {
  width: number;
  height: number;
}

let measureCtx: CanvasRenderingContext2D | null = null;
const textSizeCache = new WeakMap<TextElement, TextMetricsBox>();

function measureText(el: TextElement): TextMetricsBox {
  const cached = textSizeCache.get(el);
  if (cached) return cached;
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d');
  }
  const lines = el.text.split('\n');
  let width = 0;
  if (measureCtx) {
    measureCtx.font = textFont(el.fontSize);
    for (const line of lines) {
      const w = measureCtx.measureText(line).width;
      if (w > width) width = w;
    }
  } else {
    width = Math.max(...lines.map((l) => l.length)) * el.fontSize * 0.6;
  }
  const box = { width, height: lines.length * el.fontSize * TEXT_LINE_HEIGHT };
  textSizeCache.set(el, box);
  return box;
}

/** Neutral placeholder while an image asset is still decoding (or gone). */
function drawImagePlaceholder(ctx: CanvasRenderingContext2D, el: ImageElement): void {
  ctx.save();
  ctx.fillStyle = 'rgba(154, 160, 170, 0.18)';
  ctx.fillRect(el.x, el.y, el.w, el.h);
  ctx.strokeStyle = 'rgba(154, 160, 170, 0.6)';
  ctx.lineWidth = Math.max(1, Math.min(el.w, el.h) * 0.01);
  ctx.strokeRect(el.x, el.y, el.w, el.h);
  ctx.restore();
}

/**
 * Set `cache` for committed elements only — the in-progress element mutates
 * between draws.
 */
export function drawElement(
  ctx: CanvasRenderingContext2D,
  el: BoardElement,
  cache = false,
): void {
  if (el.kind === 'stroke') {
    drawStroke(ctx, el, cache);
    return;
  }
  if (el.kind === 'image') {
    const bitmap = getImageBitmap(el.assetId);
    if (bitmap) {
      ctx.drawImage(bitmap, el.x, el.y, el.w, el.h);
    } else {
      drawImagePlaceholder(ctx, el);
    }
    return;
  }
  ctx.save();
  ctx.globalAlpha = el.kind === 'shape' ? el.opacity : 1;
  if (el.kind === 'shape') {
    let path: Path2D | undefined;
    if (cache) {
      path = shapePathCache.get(el);
      if (!path) {
        path = shapePath(el);
        shapePathCache.set(el, path);
      }
    } else {
      path = shapePath(el);
    }
    ctx.strokeStyle = el.color;
    ctx.lineWidth = el.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(path);
  } else {
    ctx.fillStyle = el.color;
    ctx.font = textFont(el.fontSize);
    ctx.textBaseline = 'top';
    const lines = el.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], el.x, el.y + i * el.fontSize * TEXT_LINE_HEIGHT);
    }
  }
  ctx.restore();
}

const shapeBBoxCache = new WeakMap<ShapeElement, BBox>();
const textBBoxCache = new WeakMap<TextElement, BBox>();

export function elementBBox(el: BoardElement): BBox {
  if (el.kind === 'stroke') return strokeBBox(el);
  if (el.kind === 'image') {
    // Trivial to compute — no cache needed (and no WeakMap staleness risk).
    return { minX: el.x, minY: el.y, maxX: el.x + el.w, maxY: el.y + el.h };
  }
  if (el.kind === 'shape') {
    const cached = shapeBBoxCache.get(el);
    if (cached) return cached;
    const r = shapeRect(el);
    const box = { minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h };
    shapeBBoxCache.set(el, box);
    return box;
  }
  const cached = textBBoxCache.get(el);
  if (cached) return cached;
  const size = measureText(el);
  const box = { minX: el.x, minY: el.y, maxX: el.x + size.width, maxY: el.y + size.height };
  textBBoxCache.set(el, box);
  return box;
}

/** How far the painted result can extend past the element's bbox. */
export function elementVisualPad(el: BoardElement): number {
  if (el.kind === 'stroke') return el.baseWidth * (el.tool === 'highlighter' ? 2.4 : 1);
  if (el.kind === 'shape') {
    return el.shape === 'arrow' ? Math.max(el.strokeWidth * 3.5, 10) : el.strokeWidth;
  }
  if (el.kind === 'image') return 0;
  return 2;
}

/** Points that stand in for the element in hit tests and lasso containment. */
export function elementSamplePoints(el: BoardElement): { x: number; y: number }[] {
  if (el.kind === 'image') {
    // 3×3 grid: interior points let an eraser swipe across the middle hit,
    // and give lasso containment a meaningful majority.
    const out: { x: number; y: number }[] = [];
    for (let ix = 0; ix <= 2; ix++) {
      for (let iy = 0; iy <= 2; iy++) {
        out.push({ x: el.x + (el.w * ix) / 2, y: el.y + (el.h * iy) / 2 });
      }
    }
    return out;
  }
  if (el.kind === 'stroke') {
    const pts = el.points;
    const stride = Math.max(1, Math.floor(pts.length / 16));
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < pts.length; i += stride) out.push(pts[i]);
    out.push(pts[pts.length - 1]);
    return out;
  }
  if (el.kind === 'shape') {
    if (el.shape === 'line' || el.shape === 'arrow') {
      const out = [];
      for (let t = 0; t <= 8; t++) {
        out.push({ x: el.x + (el.w * t) / 8, y: el.y + (el.h * t) / 8 });
      }
      return out;
    }
    const r = shapeRect(el);
    if (el.shape === 'ellipse') {
      const out = [];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        out.push({
          x: r.x + r.w / 2 + (r.w / 2) * Math.cos(a),
          y: r.y + r.h / 2 + (r.h / 2) * Math.sin(a),
        });
      }
      return out;
    }
    // rect outline: corners plus edge midpoints.
    return [
      { x: r.x, y: r.y },
      { x: r.x + r.w / 2, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.h / 2 },
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x + r.w / 2, y: r.y + r.h },
      { x: r.x, y: r.y + r.h },
      { x: r.x, y: r.y + r.h / 2 },
    ];
  }
  const box = elementBBox(el);
  return [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
    { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
  ];
}

/** Does the swipe segment from→to pass within `reach` of the element? */
export function hitTestElement(
  el: BoardElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  reach: number,
): boolean {
  const box = elementBBox(el);
  if (
    Math.max(from.x, to.x) < box.minX - reach ||
    Math.min(from.x, to.x) > box.maxX + reach ||
    Math.max(from.y, to.y) < box.minY - reach ||
    Math.min(from.y, to.y) > box.maxY + reach
  ) {
    return false;
  }
  if (el.kind === 'image') {
    // Solid rect: an endpoint landing inside is a hit regardless of samples.
    const inside = (p: { x: number; y: number }) =>
      p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
    if (inside(from) || inside(to)) return true;
  }
  return elementSamplePoints(el).some(
    (p) => distPointToSegment(p.x, p.y, from.x, from.y, to.x, to.y) <= reach,
  );
}

/** Translation always returns a NEW object: the render caches are WeakMaps
 *  keyed on element identity, so mutating in place would draw stale paths. */
export function translateElement<T extends BoardElement>(el: T, dx: number, dy: number): T {
  if (el.kind === 'stroke') {
    return {
      ...el,
      points: el.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
    };
  }
  return { ...el, x: el.x + dx, y: el.y + dy };
}
