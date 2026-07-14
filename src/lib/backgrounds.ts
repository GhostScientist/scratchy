import type { BackgroundKind } from '../types';
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

/** Shared by the display background canvas and the recording compositor so
 *  the recorded frame is pixel-identical to the visible stage. */
export function drawBackground(ctx: CanvasRenderingContext2D, kind: BackgroundKind): void {
  const spec = BACKGROUNDS[kind];
  ctx.fillStyle = spec.base;
  ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

  if (kind === 'grid') {
    ctx.strokeStyle = spec.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = GRID_STEP; x < STAGE_WIDTH; x += GRID_STEP) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, STAGE_HEIGHT);
    }
    for (let y = GRID_STEP; y < STAGE_HEIGHT; y += GRID_STEP) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(STAGE_WIDTH, y + 0.5);
    }
    ctx.stroke();
  } else if (kind === 'dots') {
    ctx.fillStyle = spec.line;
    for (let x = DOT_STEP / 2; x < STAGE_WIDTH; x += DOT_STEP) {
      for (let y = DOT_STEP / 2; y < STAGE_HEIGHT; y += DOT_STEP) {
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
