import { getStroke } from 'perfect-freehand';
import type { Stroke } from '../types';

function outlineOptions(stroke: Stroke) {
  if (stroke.tool === 'highlighter') {
    return {
      size: stroke.baseWidth * 2.4,
      thinning: 0,
      smoothing: 0.55,
      streamline: 0.5,
      simulatePressure: false,
      last: true,
    };
  }
  return {
    size: stroke.baseWidth,
    thinning: 0.45,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: stroke.simulatePressure,
    last: true,
  };
}

/** Filled outline polygon via quadratic midpoint curves. A single filled path
 *  means highlighter self-overlap never double-darkens. */
export function strokePath(stroke: Stroke): Path2D | null {
  if (stroke.points.length === 0) return null;
  // getStroke accepts {x, y, pressure} objects directly — no copy needed.
  const outline = getStroke(stroke.points, outlineOptions(stroke));
  if (outline.length < 3) return null;
  const path = new Path2D();
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    path.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  path.closePath();
  return path;
}

/** World-space outline paths for committed strokes. Point arrays are immutable
 *  once committed, so the path never goes stale; entries drop with the stroke. */
const pathCache = new WeakMap<Stroke, Path2D | null>();

/**
 * Set `cache` for committed strokes only: the in-progress stroke gains points
 * every event and must be re-outlined on each draw.
 */
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, cache = false): void {
  // Live highlighter preview: the outline uses thinning 0 (constant width),
  // so a round-capped polyline is visually equivalent at a fraction of the
  // cost — no re-outline of the whole stroke on every frame. The commit
  // still renders the true filled outline (cache=true path below).
  if (!cache && stroke.tool === 'highlighter') {
    drawHighlighterPreview(ctx, stroke);
    return;
  }
  let path: Path2D | null | undefined;
  if (cache) {
    path = pathCache.get(stroke);
    if (path === undefined) {
      path = strokePath(stroke);
      pathCache.set(stroke, path);
    }
  } else {
    path = strokePath(stroke);
  }
  if (!path) return;
  ctx.save();
  ctx.globalAlpha = stroke.opacity;
  ctx.fillStyle = stroke.color;
  ctx.fill(path);
  ctx.restore();
}

/** A single stroked polyline composites its alpha once, so self-overlap
 *  never double-darkens — the same property as the filled outline. */
function drawHighlighterPreview(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const pts = stroke.points;
  if (pts.length === 0) return;
  const width = stroke.baseWidth * 2.4;
  ctx.save();
  ctx.globalAlpha = stroke.opacity;
  if (pts.length === 1) {
    // Zero-length lines don't render; draw the cap dot directly.
    ctx.fillStyle = stroke.color;
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const bboxCache = new WeakMap<Stroke, BBox>();

export function strokeBBox(stroke: Stroke): BBox {
  const cached = bboxCache.get(stroke);
  if (cached) return cached;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of stroke.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const box = { minX, minY, maxX, maxY };
  bboxCache.set(stroke, box);
  return box;
}
