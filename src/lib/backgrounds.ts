import type { BackgroundKind, ViewportState } from '../types';
import { STAGE_WIDTH, STAGE_HEIGHT } from '../types';

export interface BackgroundSpec {
  label: string;
  base: string;
  line: string;
}

export const BACKGROUNDS: Record<BackgroundKind, BackgroundSpec> = {
  white: { label: 'White', base: '#ffffff', line: '' },
  dark: { label: 'Dark', base: '#191b20', line: '' },
  grid: { label: 'Grid', base: '#ffffff', line: '#e2e7ef' },
  dots: { label: 'Dots', base: '#ffffff', line: '#ccd3de' },
};

export const BACKGROUND_KINDS: BackgroundKind[] = ['white', 'grid', 'dots', 'dark'];

const GRID_STEP = 40;
const DOT_STEP = 36;
/** Grow the pattern step so cells never shrink below this many stage px. */
const MIN_STEP_PX = 14;

export interface BackgroundView extends ViewportState {
  outW: number;
  outH: number;
}

const DEFAULT_VIEW: BackgroundView = { x: 0, y: 0, zoom: 1, outW: STAGE_WIDTH, outH: STAGE_HEIGHT };

/** World-step widened so the pattern stays readable when zoomed far out. */
function adaptiveStep(base: number, zoom: number): number {
  let step = base;
  while (step * zoom < MIN_STEP_PX) step *= 2;
  return step;
}

/**
 * Shared by the display background canvas and the recording compositor so the
 * recorded frame is pixel-identical to the visible stage. The grid/dot pattern
 * is anchored in world space: it scrolls and scales with the viewport. Expects
 * a context whose transform maps 1 unit → 1 stage px; draws in stage px so
 * lines stay crisp at any zoom.
 */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  kind: BackgroundKind,
  view: BackgroundView = DEFAULT_VIEW,
): void {
  const spec = BACKGROUNDS[kind];
  ctx.fillStyle = spec.base;
  ctx.fillRect(0, 0, view.outW, view.outH);

  if (kind !== 'grid' && kind !== 'dots') return;

  const worldLeft = view.x;
  const worldTop = view.y;
  const worldRight = view.x + view.outW / view.zoom;
  const worldBottom = view.y + view.outH / view.zoom;
  const toStageX = (wx: number) => (wx - view.x) * view.zoom;
  const toStageY = (wy: number) => (wy - view.y) * view.zoom;

  if (kind === 'grid') {
    const step = adaptiveStep(GRID_STEP, view.zoom);
    ctx.strokeStyle = spec.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let wx = Math.ceil(worldLeft / step) * step; wx <= worldRight; wx += step) {
      const sx = Math.round(toStageX(wx)) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, view.outH);
    }
    for (let wy = Math.ceil(worldTop / step) * step; wy <= worldBottom; wy += step) {
      const sy = Math.round(toStageY(wy)) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(view.outW, sy);
    }
    ctx.stroke();
  } else {
    const step = adaptiveStep(DOT_STEP, view.zoom);
    const half = step / 2;
    if (!drawDotsPattern(ctx, spec.line, view, step, half)) {
      drawDotsLoop(ctx, spec.line, view, step, half, toStageX, toStageY);
    }
  }
}

const DOT_RADIUS = 1.6; // stage px, constant at any zoom

/**
 * Dots via a repeating pattern tile: one small cell render + one fillRect
 * replaces up to ~4,600 arc() calls per pan/pinch frame — the difference
 * between a smooth pinch and a slideshow on a weak GPU. The cell renders at
 * the context's device scale so dots stay crisp, and the pattern transform
 * derives its scale from the rounded cell size so the period is exact (no
 * cumulative drift across the stage). Returns false where the Pattern/
 * DOMMatrix APIs are unavailable so the arc loop can take over.
 */
function drawDotsPattern(
  ctx: CanvasRenderingContext2D,
  color: string,
  view: BackgroundView,
  step: number,
  half: number,
): boolean {
  if (typeof DOMMatrix === 'undefined') return false;
  const deviceScale = ctx.getTransform().a || 1;
  const period = step * view.zoom; // stage px between dots
  const cellPx = Math.max(1, Math.round(period * deviceScale));
  const cell = dotCell(color, cellPx, DOT_RADIUS * deviceScale);
  if (!cell) return false;
  const pattern = ctx.createPattern(cell, 'repeat');
  if (!pattern) return false;
  // Anchor the lattice: the first world dot column/row maps to stage px, and
  // the cell's dot sits at its center.
  const firstWx = Math.ceil((view.x - half) / step) * step + half;
  const firstWy = Math.ceil((view.y - half) / step) * step + half;
  const s = period / cellPx; // stage px per pattern px — period stays exact
  const tx = (firstWx - view.x) * view.zoom - period / 2;
  const ty = (firstWy - view.y) * view.zoom - period / 2;
  pattern.setTransform(new DOMMatrix().translateSelf(tx, ty).scaleSelf(s));
  ctx.save();
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, view.outW, view.outH);
  ctx.restore();
  return true;
}

/** One dot centered in a period-sized tile, cached by size/color. Zoom only
 *  changes the cell size on pinch frames; pans reuse the same cell. */
let cachedCell: { key: string; canvas: HTMLCanvasElement } | null = null;

function dotCell(color: string, cellPx: number, radiusPx: number): HTMLCanvasElement | null {
  const key = `${color}|${cellPx}|${radiusPx.toFixed(2)}`;
  if (cachedCell?.key === key) return cachedCell.canvas;
  const canvas = document.createElement('canvas');
  canvas.width = cellPx;
  canvas.height = cellPx;
  const cctx = canvas.getContext('2d');
  if (!cctx) return null;
  cctx.fillStyle = color;
  cctx.beginPath();
  cctx.arc(cellPx / 2, cellPx / 2, radiusPx, 0, Math.PI * 2);
  cctx.fill();
  cachedCell = { key, canvas };
  return canvas;
}

function drawDotsLoop(
  ctx: CanvasRenderingContext2D,
  color: string,
  view: BackgroundView,
  step: number,
  half: number,
  toStageX: (wx: number) => number,
  toStageY: (wy: number) => number,
): void {
  const worldRight = view.x + view.outW / view.zoom;
  const worldBottom = view.y + view.outH / view.zoom;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let wx = Math.ceil((view.x - half) / step) * step + half; wx <= worldRight; wx += step) {
    for (let wy = Math.ceil((view.y - half) / step) * step + half; wy <= worldBottom; wy += step) {
      const sx = toStageX(wx);
      const sy = toStageY(wy);
      ctx.moveTo(sx + DOT_RADIUS, sy);
      ctx.arc(sx, sy, DOT_RADIUS, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}
