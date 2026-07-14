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
    ctx.fillStyle = spec.line;
    ctx.beginPath();
    for (
      let wx = (Math.ceil((worldLeft - half) / step)) * step + half;
      wx <= worldRight;
      wx += step
    ) {
      for (
        let wy = (Math.ceil((worldTop - half) / step)) * step + half;
        wy <= worldBottom;
        wy += step
      ) {
        const sx = toStageX(wx);
        const sy = toStageY(wy);
        ctx.moveTo(sx + 1.6, sy);
        ctx.arc(sx, sy, 1.6, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }
}
