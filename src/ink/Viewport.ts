import { clamp } from '../lib/geometry';
import { STAGE_WIDTH, STAGE_HEIGHT, BACKING_SCALE, MIN_ZOOM, MAX_ZOOM } from '../types';
import type { ViewportState } from '../types';
import type { BBox } from '../lib/strokes';

export interface Point {
  x: number;
  y: number;
}

/**
 * The window onto the infinite world that the fixed 1280×720 stage shows.
 *
 * Coordinate spaces:
 *   stage px — 0..1280 × 0..720, what pointer math and the camera HUD use
 *   world px — unbounded document coordinates that strokes are stored in
 *
 *   world = stage / zoom + origin
 *
 * Imperative and ref-held: pan/pinch mutate it every pointer move, so it must
 * never flow through per-frame React state. Consumers subscribe via onChange.
 */
export class Viewport {
  private x = 0;
  private y = 0;
  private zoom = 1;
  private listeners = new Set<(state: ViewportState) => void>();

  get(): ViewportState {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }

  set(state: ViewportState): void {
    this.x = state.x;
    this.y = state.y;
    this.zoom = clamp(state.zoom, MIN_ZOOM, MAX_ZOOM);
    this.emit();
  }

  stageToWorld(p: Point): Point {
    return { x: p.x / this.zoom + this.x, y: p.y / this.zoom + this.y };
  }

  worldToStage(p: Point): Point {
    return { x: (p.x - this.x) * this.zoom, y: (p.y - this.y) * this.zoom };
  }

  /** Drag the world by a delta measured in stage px (finger movement). */
  panBy(dxStage: number, dyStage: number): void {
    if (dxStage === 0 && dyStage === 0) return;
    this.x -= dxStage / this.zoom;
    this.y -= dyStage / this.zoom;
    this.emit();
  }

  /** Multiply zoom by factor keeping the world point under anchorStage fixed. */
  zoomAt(anchorStage: Point, factor: number): void {
    const next = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (next === this.zoom) return;
    this.x += anchorStage.x * (1 / this.zoom - 1 / next);
    this.y += anchorStage.y * (1 / this.zoom - 1 / next);
    this.zoom = next;
    this.emit();
  }

  /** Center the stage on a world point at the current zoom. */
  centerOn(world: Point): void {
    this.x = world.x - STAGE_WIDTH / (2 * this.zoom);
    this.y = world.y - STAGE_HEIGHT / (2 * this.zoom);
    this.emit();
  }

  /** Fit a world rect into the stage with padding (world px). */
  fitBBox(box: BBox, padding = 60): void {
    const w = box.maxX - box.minX + padding * 2;
    const h = box.maxY - box.minY + padding * 2;
    this.zoom = clamp(Math.min(STAGE_WIDTH / w, STAGE_HEIGHT / h), MIN_ZOOM, MAX_ZOOM);
    this.x = (box.minX + box.maxX) / 2 - STAGE_WIDTH / (2 * this.zoom);
    this.y = (box.minY + box.maxY) / 2 - STAGE_HEIGHT / (2 * this.zoom);
    this.emit();
  }

  /**
   * Install this viewport as the context transform so drawing happens in
   * world coordinates. outScale is the backing-store multiplier of the target
   * canvas: BACKING_SCALE for display layers, 1 for the recording compositor.
   */
  applyTo(ctx: CanvasRenderingContext2D, outScale = BACKING_SCALE): void {
    const s = outScale * this.zoom;
    ctx.setTransform(s, 0, 0, s, -this.x * s, -this.y * s);
  }

  /** World rect currently visible through the stage. */
  visibleWorldRect(): BBox {
    return {
      minX: this.x,
      minY: this.y,
      maxX: this.x + STAGE_WIDTH / this.zoom,
      maxY: this.y + STAGE_HEIGHT / this.zoom,
    };
  }

  onChange(listener: (state: ViewportState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const state = this.get();
    for (const listener of this.listeners) listener(state);
  }
}
