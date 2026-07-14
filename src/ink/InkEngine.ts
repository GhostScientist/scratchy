import { drawStroke, strokeBBox } from '../lib/strokes';
import type { BBox } from '../lib/strokes';
import { drawLaserTrail, pruneLaserTrail } from '../lib/laser';
import type { LaserPoint } from '../lib/laser';
import { distPointToSegment } from '../lib/geometry';
import { STAGE_WIDTH, STAGE_HEIGHT, BACKING_SCALE, nextId } from '../types';
import type { Stroke, Tool } from '../types';
import type { Viewport, Point } from './Viewport';

type Command =
  | { type: 'add'; stroke: Stroke }
  | { type: 'erase'; entries: { index: number; stroke: Stroke }[] }
  | { type: 'clear'; strokes: Stroke[] };

export interface InkEngineCallbacks {
  onHistoryChange(canUndo: boolean, canRedo: boolean): void;
  /** Document changed (add / erase / clear / undo / redo) — autosave hook. */
  onCommit(): void;
}

const ERASER_RADIUS = 20;
/** A touch that lands this soon after another may convert the gesture to pan. */
const PAN_TAKEOVER_MS = 150;
/** ...but only while the provisional stroke is still short (stage px). */
const PAN_TAKEOVER_TRAVEL_PX = 12;

type Mode = 'idle' | 'stroke' | 'erase' | 'pan' | 'laser';

/**
 * Imperative ink core. Owns the committed-ink cache canvas and the
 * active-stroke canvas, handles pointer input directly (React never sees
 * per-point events), and keeps a command-stack history over vector strokes.
 *
 * Strokes are stored in world coordinates; the Viewport maps them onto the
 * fixed 1280×720 stage. The ink cache always holds the current viewport's
 * view, which is what lets the recording compositor blit it unchanged.
 */
export class InkEngine {
  private strokes: Stroke[] = [];
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  private mode: Mode = 'idle';
  private active: Stroke | null = null;
  private activePointerId: number | null = null;
  private strokeStartedAt = 0;
  private lastStagePoint: Point | null = null;

  /** Live pan/pinch pointers, in stage coordinates. */
  private panPoints = new Map<number, Point>();
  private lastCentroid: Point | null = null;
  private lastPinchDist = 0;
  private spacePan = false;

  private eraseEntries: { index: number; stroke: Stroke }[] = [];
  private lastErasePoint: Point | null = null;

  /** Eraser cursor position in world coordinates. */
  private cursor: Point | null = null;

  /** Ephemeral pointing trail (world coords). Never part of the document. */
  private laserTrail: LaserPoint[] = [];

  private tool: Tool = 'pen';
  private color = '#1d1f24';
  private width = 4;

  private inkCtx: CanvasRenderingContext2D;
  private activeCtx: CanvasRenderingContext2D;
  private raf = 0;
  private repaintQueued = false;
  private cacheDirty = false;
  private destroyed = false;
  private unsubscribeViewport: () => void;

  constructor(
    private inkCanvas: HTMLCanvasElement,
    private activeCanvas: HTMLCanvasElement,
    readonly viewport: Viewport,
    private cb: InkEngineCallbacks,
  ) {
    this.inkCtx = this.setupCanvas(inkCanvas);
    this.activeCtx = this.setupCanvas(activeCanvas);

    const el = this.activeCanvas;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerCancel);
    el.addEventListener('pointerleave', this.onPointerLeave);
    el.addEventListener('contextmenu', this.onContextMenu);
    el.addEventListener('wheel', this.onWheel, { passive: false });

    this.unsubscribeViewport = viewport.onChange(() => {
      this.cacheDirty = true;
      this.requestRepaint();
    });
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.unsubscribeViewport();
    const el = this.activeCanvas;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerCancel);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    el.removeEventListener('contextmenu', this.onContextMenu);
    el.removeEventListener('wheel', this.onWheel);
  }

  private setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    canvas.width = STAGE_WIDTH * BACKING_SCALE;
    canvas.height = STAGE_HEIGHT * BACKING_SCALE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    ctx.setTransform(BACKING_SCALE, 0, 0, BACKING_SCALE, 0, 0);
    return ctx;
  }

  // ---- public API ---------------------------------------------------------

  setBrush(tool: Tool, color: string, width: number): void {
    this.tool = tool;
    this.color = color;
    this.width = width;
    if (tool !== 'eraser') this.cursor = null;
    this.updateCursorStyle();
    this.requestRepaint();
  }

  /** Transient pan while the spacebar is held (mouse/keyboard workflow). */
  setSpacePan(on: boolean): void {
    if (this.spacePan === on) return;
    this.spacePan = on;
    this.updateCursorStyle();
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    if (cmd.type === 'add') {
      const i = this.strokes.indexOf(cmd.stroke);
      if (i >= 0) this.strokes.splice(i, 1);
    } else if (cmd.type === 'erase') {
      for (let j = cmd.entries.length - 1; j >= 0; j--) {
        this.strokes.splice(cmd.entries[j].index, 0, cmd.entries[j].stroke);
      }
    } else {
      this.strokes = cmd.strokes;
    }
    this.redoStack.push(cmd);
    this.afterDocumentChange();
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    if (cmd.type === 'add') {
      this.strokes.push(cmd.stroke);
    } else if (cmd.type === 'erase') {
      for (const entry of cmd.entries) this.strokes.splice(entry.index, 1);
    } else {
      this.strokes = [];
    }
    this.undoStack.push(cmd);
    this.afterDocumentChange();
  }

  clear(): void {
    if (this.strokes.length === 0) return;
    this.undoStack.push({ type: 'clear', strokes: this.strokes });
    this.redoStack = [];
    this.strokes = [];
    // Deliberately leaves the viewport alone: clearing removes content,
    // it is not a navigation action.
    this.afterDocumentChange();
  }

  loadStrokes(strokes: Stroke[]): void {
    this.strokes = strokes;
    this.undoStack = [];
    this.redoStack = [];
    this.rebuildInkCache();
    this.cb.onHistoryChange(false, false);
  }

  getStrokes(): readonly Stroke[] {
    return this.strokes;
  }

  hasStrokes(): boolean {
    return this.strokes.length > 0;
  }

  getActiveStroke(): Stroke | null {
    return this.active;
  }

  getInkCanvas(): HTMLCanvasElement {
    return this.inkCanvas;
  }

  getLaserTrail(): readonly LaserPoint[] {
    return this.laserTrail;
  }

  /** Union bbox of all committed ink in world coordinates. */
  getInkBBox(): BBox | null {
    if (this.strokes.length === 0) return null;
    const box: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const stroke of this.strokes) {
      const b = strokeBBox(stroke);
      const pad = strokeVisualPad(stroke);
      if (b.minX - pad < box.minX) box.minX = b.minX - pad;
      if (b.minY - pad < box.minY) box.minY = b.minY - pad;
      if (b.maxX + pad > box.maxX) box.maxX = b.maxX + pad;
      if (b.maxY + pad > box.maxY) box.maxY = b.maxY + pad;
    }
    return box;
  }

  // ---- pointer handling ---------------------------------------------------

  private toStage(clientX: number, clientY: number): Point {
    const rect = this.activeCanvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) * STAGE_WIDTH) / rect.width,
      y: ((clientY - rect.top) * STAGE_HEIGHT) / rect.height,
    };
  }

  private toWorld(clientX: number, clientY: number): Point {
    return this.viewport.stageToWorld(this.toStage(clientX, clientY));
  }

  private pressureOf(e: PointerEvent): number {
    return e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
  }

  private capturePointer(pointerId: number): void {
    try {
      this.activeCanvas.setPointerCapture(pointerId);
    } catch {
      // The pointer may already be gone (fast lift, synthetic events).
    }
  }

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private onWheel = (e: WheelEvent): void => {
    // Plain wheel and trackpad pinch (ctrl+wheel) both zoom, anchored at the
    // cursor so the point under the mouse stays put.
    e.preventDefault();
    this.viewport.zoomAt(this.toStage(e.clientX, e.clientY), Math.exp(-e.deltaY * 0.0015));
  };

  private onPointerDown = (e: PointerEvent): void => {
    const tool = this.tool;

    if (this.mode === 'pan') {
      // Second finger joins the pan as a pinch; further contacts are palms.
      if (this.panPoints.size < 2) {
        e.preventDefault();
        this.capturePointer(e.pointerId);
        this.panPoints.set(e.pointerId, this.toStage(e.clientX, e.clientY));
        this.resetPanRefs();
      }
      return;
    }

    if (this.mode === 'stroke') {
      // A second touch landing right after a touch-drawn stroke started is a
      // two-finger navigation gesture: discard the provisional stroke (it was
      // never committed, so no undo entry exists) and switch to pan/pinch.
      // Later contacts — and anything while a pen stroke is live — are palms.
      const zoom = this.viewport.get().zoom;
      if (
        e.pointerType === 'touch' &&
        this.active !== null &&
        this.active.simulatePressure &&
        performance.now() - this.strokeStartedAt < PAN_TAKEOVER_MS &&
        this.strokeTravelWorld() * zoom < PAN_TAKEOVER_TRAVEL_PX &&
        this.activePointerId !== null &&
        this.lastStagePoint !== null
      ) {
        const firstId = this.activePointerId;
        const firstPoint = this.lastStagePoint;
        this.active = null;
        this.activePointerId = null;
        this.lastStagePoint = null;
        this.mode = 'pan';
        this.capturePointer(e.pointerId);
        this.panPoints.set(firstId, firstPoint);
        this.panPoints.set(e.pointerId, this.toStage(e.clientX, e.clientY));
        this.resetPanRefs();
        this.requestRepaint();
      }
      return;
    }

    // Resting palm during an erase drag or while pointing.
    if (this.mode === 'erase' || this.mode === 'laser') return;

    // idle —
    e.preventDefault();

    // Hand tool, held spacebar, and middle-button drags all navigate.
    if (tool === 'hand' || this.spacePan || e.button === 1) {
      this.capturePointer(e.pointerId);
      this.mode = 'pan';
      this.panPoints.set(e.pointerId, this.toStage(e.clientX, e.clientY));
      this.resetPanRefs();
      return;
    }

    this.activePointerId = e.pointerId;
    this.capturePointer(e.pointerId);
    const stage = this.toStage(e.clientX, e.clientY);
    const p = this.viewport.stageToWorld(stage);
    this.lastStagePoint = stage;

    if (tool === 'laser') {
      this.mode = 'laser';
      this.laserTrail.push({ x: p.x, y: p.y, t: performance.now() });
      this.requestRepaint();
      return;
    }

    if (tool === 'eraser') {
      this.mode = 'erase';
      this.eraseEntries = [];
      this.lastErasePoint = p;
      this.cursor = p;
      this.eraseAlong(p, p);
      this.requestRepaint();
      return;
    }

    this.mode = 'stroke';
    this.strokeStartedAt = performance.now();
    this.active = {
      id: nextId('s'),
      tool,
      color: this.color,
      baseWidth: this.width,
      opacity: tool === 'highlighter' ? 0.45 : 1,
      simulatePressure: e.pointerType !== 'pen',
      points: [{ x: p.x, y: p.y, pressure: this.pressureOf(e) }],
    };
    this.requestRepaint();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.mode === 'pan') {
      if (!this.panPoints.has(e.pointerId)) return;
      this.panPoints.set(e.pointerId, this.toStage(e.clientX, e.clientY));
      const pts = [...this.panPoints.values()];
      const centroid = centroidOf(pts);
      if (this.lastCentroid) {
        this.viewport.panBy(centroid.x - this.lastCentroid.x, centroid.y - this.lastCentroid.y);
      }
      if (pts.length === 2) {
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (this.lastPinchDist > 0 && dist > 0) {
          this.viewport.zoomAt(centroid, dist / this.lastPinchDist);
        }
        this.lastPinchDist = dist;
      }
      this.lastCentroid = centroid;
      return;
    }

    if (this.tool === 'eraser') {
      this.cursor = this.toWorld(e.clientX, e.clientY);
      this.requestRepaint();
    }
    if (e.pointerId !== this.activePointerId) return;

    if (this.mode === 'erase') {
      const p = this.toWorld(e.clientX, e.clientY);
      if (this.lastErasePoint) this.eraseAlong(this.lastErasePoint, p);
      this.lastErasePoint = p;
      return;
    }

    if (this.mode === 'laser') {
      const p = this.toWorld(e.clientX, e.clientY);
      this.laserTrail.push({ x: p.x, y: p.y, t: performance.now() });
      this.requestRepaint();
      return;
    }

    if (!this.active) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
    const source = events.length > 0 ? events : [e];
    // One rect + viewport read per move event, shared by all coalesced points.
    const rect = this.activeCanvas.getBoundingClientRect();
    const { x: vx, y: vy, zoom } = this.viewport.get();
    for (const ev of source) {
      const sx = ((ev.clientX - rect.left) * STAGE_WIDTH) / rect.width;
      const sy = ((ev.clientY - rect.top) * STAGE_HEIGHT) / rect.height;
      this.active.points.push({
        x: sx / zoom + vx,
        y: sy / zoom + vy,
        pressure: this.pressureOf(ev),
      });
      this.lastStagePoint = { x: sx, y: sy };
    }
    this.requestRepaint();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.endPanPointer(e)) return;
    if (e.pointerId !== this.activePointerId) return;
    this.finishGesture(false);
  };

  private onPointerCancel = (e: PointerEvent): void => {
    if (this.endPanPointer(e)) return;
    if (e.pointerId !== this.activePointerId) return;
    this.finishGesture(true);
  };

  private onPointerLeave = (): void => {
    if (this.cursor && this.activePointerId === null) {
      this.cursor = null;
      this.requestRepaint();
    }
  };

  private endPanPointer(e: PointerEvent): boolean {
    if (!this.panPoints.delete(e.pointerId)) return false;
    this.resetPanRefs();
    if (this.panPoints.size === 0) this.mode = 'idle';
    return true;
  }

  private resetPanRefs(): void {
    const pts = [...this.panPoints.values()];
    this.lastCentroid = pts.length > 0 ? centroidOf(pts) : null;
    this.lastPinchDist =
      pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
  }

  /** Max distance (world px) the active stroke has travelled from its start. */
  private strokeTravelWorld(): number {
    const pts = this.active?.points;
    if (!pts || pts.length < 2) return 0;
    const first = pts[0];
    let max = 0;
    for (const p of pts) {
      const d = Math.hypot(p.x - first.x, p.y - first.y);
      if (d > max) max = d;
    }
    return max;
  }

  private finishGesture(cancelled: boolean): void {
    this.activePointerId = null;
    this.lastStagePoint = null;
    const wasErasing = this.mode === 'erase';
    const wasLaser = this.mode === 'laser';
    this.mode = 'idle';

    if (wasLaser) {
      // Nothing to commit — the trail keeps fading on its own.
      this.requestRepaint();
      return;
    }

    if (wasErasing) {
      this.lastErasePoint = null;
      if (this.eraseEntries.length > 0) {
        this.undoStack.push({ type: 'erase', entries: this.eraseEntries });
        this.redoStack = [];
        this.eraseEntries = [];
        this.notifyHistory();
        this.cb.onCommit();
      }
      this.requestRepaint();
      return;
    }

    const stroke = this.active;
    this.active = null;
    if (!stroke || cancelled) {
      this.requestRepaint();
      return;
    }
    // A tap becomes a dot: duplicate the point so the outline has area.
    if (stroke.points.length === 1) {
      const p = stroke.points[0];
      stroke.points.push({ x: p.x + 0.1, y: p.y + 0.1, pressure: p.pressure });
    }
    this.strokes.push(stroke);
    // Incremental — no full rebuild on commit. The ink ctx keeps the viewport
    // transform between rebuilds; skip when a rebuild is already pending
    // (its transform would be stale, and the rebuild redraws everything).
    if (!this.cacheDirty) drawStroke(this.inkCtx, stroke, true);
    this.undoStack.push({ type: 'add', stroke });
    this.redoStack = [];
    this.notifyHistory();
    this.cb.onCommit();
    this.requestRepaint();
  }

  // ---- eraser -------------------------------------------------------------

  private eraseAlong(from: Point, to: Point): void {
    // The cursor circle has a fixed on-screen size, so its reach in world
    // units shrinks as you zoom in; stroke thickness is world-sized.
    const zoom = this.viewport.get().zoom;
    let removed = false;
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const stroke = this.strokes[i];
      const reach =
        ERASER_RADIUS / zoom + stroke.baseWidth * (stroke.tool === 'highlighter' ? 2.4 : 1);
      const box = strokeBBox(stroke);
      if (
        Math.max(from.x, to.x) < box.minX - reach ||
        Math.min(from.x, to.x) > box.maxX + reach ||
        Math.max(from.y, to.y) < box.minY - reach ||
        Math.min(from.y, to.y) > box.maxY + reach
      ) {
        continue;
      }
      const hit = stroke.points.some(
        (p) => distPointToSegment(p.x, p.y, from.x, from.y, to.x, to.y) <= reach,
      );
      if (hit) {
        this.strokes.splice(i, 1);
        this.eraseEntries.push({ index: i, stroke });
        removed = true;
      }
    }
    if (removed) this.rebuildInkCache();
  }

  // ---- rendering ----------------------------------------------------------

  private rebuildInkCache(): void {
    const ctx = this.inkCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.inkCanvas.width, this.inkCanvas.height);
    this.viewport.applyTo(ctx);
    const view = this.viewport.visibleWorldRect();
    for (const stroke of this.strokes) {
      const box = strokeBBox(stroke);
      const pad = strokeVisualPad(stroke);
      if (
        box.maxX + pad < view.minX ||
        box.minX - pad > view.maxX ||
        box.maxY + pad < view.minY ||
        box.minY - pad > view.maxY
      ) {
        continue;
      }
      drawStroke(ctx, stroke, true);
    }
  }

  private requestRepaint(): void {
    if (this.repaintQueued || this.destroyed) return;
    this.repaintQueued = true;
    this.raf = requestAnimationFrame(() => {
      this.repaintQueued = false;
      if (this.cacheDirty) {
        this.cacheDirty = false;
        this.rebuildInkCache();
      }
      this.paintActiveLayer();
    });
  }

  private paintActiveLayer(): void {
    const ctx = this.activeCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.activeCanvas.width, this.activeCanvas.height);
    this.viewport.applyTo(ctx);
    if (this.active) drawStroke(ctx, this.active);
    if (this.laserTrail.length > 0) {
      const now = performance.now();
      this.laserTrail = pruneLaserTrail(this.laserTrail, now);
      if (this.laserTrail.length > 0) {
        ctx.setTransform(BACKING_SCALE, 0, 0, BACKING_SCALE, 0, 0);
        drawLaserTrail(ctx, this.laserTrail, this.viewport.get(), now);
        // Keep repainting until the trail has fully faded out.
        this.requestRepaint();
      }
    }
    if (this.tool === 'eraser' && this.cursor) {
      // The cursor is a screen-space HUD: constant size regardless of zoom.
      ctx.setTransform(BACKING_SCALE, 0, 0, BACKING_SCALE, 0, 0);
      const p = this.viewport.worldToStage(this.cursor);
      ctx.save();
      ctx.strokeStyle = 'rgba(90, 100, 120, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, ERASER_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private afterDocumentChange(): void {
    this.rebuildInkCache();
    this.notifyHistory();
    this.cb.onCommit();
    this.requestRepaint();
  }

  private notifyHistory(): void {
    this.cb.onHistoryChange(this.undoStack.length > 0, this.redoStack.length > 0);
  }

  private updateCursorStyle(): void {
    this.activeCanvas.style.cursor = this.spacePan && this.tool !== 'hand' ? 'grab' : '';
  }
}

/** How far a stroke's painted outline can extend past its point bbox. */
function strokeVisualPad(stroke: Stroke): number {
  return stroke.baseWidth * (stroke.tool === 'highlighter' ? 2.4 : 1);
}

function centroidOf(pts: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}
