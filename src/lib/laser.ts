import type { ViewportState } from '../types';

export interface LaserPoint {
  x: number;
  y: number;
  /** performance.now() when the point was laid down. */
  t: number;
}

export const LASER_FADE_MS = 700;
const LASER_COLOR = '255, 69, 69'; // matches --accent

export function pruneLaserTrail(trail: readonly LaserPoint[], now: number): LaserPoint[] {
  return trail.filter((p) => now - p.t < LASER_FADE_MS);
}

/**
 * Tapered, fading trail. Points are world coords; drawing happens in stage px
 * (the trail keeps a constant on-screen thickness at any zoom), so the ctx
 * transform must map 1 unit → 1 stage px. Shared by the active display layer
 * and the recording compositor.
 */
export function drawLaserTrail(
  ctx: CanvasRenderingContext2D,
  trail: readonly LaserPoint[],
  view: ViewportState,
  now: number,
): void {
  if (trail.length === 0) return;
  const sx = (p: LaserPoint) => (p.x - view.x) * view.zoom;
  const sy = (p: LaserPoint) => (p.y - view.y) * view.zoom;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 1; i < trail.length; i++) {
    const b = trail[i];
    const alpha = Math.max(0, 1 - (now - b.t) / LASER_FADE_MS);
    if (alpha === 0) continue;
    ctx.strokeStyle = `rgba(${LASER_COLOR}, ${(alpha * 0.85).toFixed(3)})`;
    ctx.lineWidth = 1.5 + 2.5 * alpha;
    ctx.beginPath();
    ctx.moveTo(sx(trail[i - 1]), sy(trail[i - 1]));
    ctx.lineTo(sx(b), sy(b));
    ctx.stroke();
  }
  const head = trail[trail.length - 1];
  const headAlpha = Math.max(0, 1 - (now - head.t) / LASER_FADE_MS);
  if (headAlpha > 0) {
    ctx.fillStyle = `rgba(${LASER_COLOR}, ${(headAlpha * 0.95).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(sx(head), sy(head), 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
