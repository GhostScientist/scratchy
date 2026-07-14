import { drawStroke, strokeBBox } from '../lib/strokes';
import { distPointToSegment } from '../lib/geometry';
import { STAGE_WIDTH, STAGE_HEIGHT, BACKING_SCALE, nextId } from '../types';
import type { Stroke, Tool } from '../types';

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

/**
 * Imperative ink core. Owns the committed-ink cache canvas and the
 * active-stroke canvas, handles pointer input directly (React never sees
 * per-point events), and keeps a command-stack history over vector strokes.
 */
export class InkEngine {
  private strokes: Stroke[] = [];
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  private active: Stroke | null = null;
  private activePointerId: number | null = null;

  private eraseEntries: { index: number; stroke: Stroke }[] = [];
  private erasing = false;
  private lastErasePoint: { x: number; y: number } | null = null;

  private cursor: { x: number; y: number } | null = null;

  private tool: Tool = 'pen';
  private color = '#1d1f24';
  private width = 4;

  private inkCtx: CanvasRenderingContext2D;
  private activeCtx: CanvasRenderingContext2D;
  private raf = 0;
  private repaintQueued = false;
  private destroyed = false;

  constructor(
    private inkCanvas: HTMLCanvasElement,
    private activeCanvas: HTMLCanvasElement,
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
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    const el = this.activeCanvas;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerCancel);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    el.removeEventListener('contextmenu', this.onContextMenu);
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
    this.requestRepaint();
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

  // ---- pointer handling ---------------------------------------------------

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const rect = this.activeCanvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * STAGE_WIDTH) / rect.width,
      y: ((e.clientY - rect.top) * STAGE_HEIGHT) / rect.height,
    };
  }

  private pressureOf(e: PointerEvent): number {
    return e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
  }

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private onPointerDown = (e: PointerEvent): void => {
    // Finger drawing is off: touch never draws, and any touch contact that
    // arrives while a pen stroke is live (a resting palm) is ignored outright.
    if (e.pointerType === 'touch') return;
    if (this.activePointerId !== null) return;

    e.preventDefault();
    this.activePointerId = e.pointerId;
    this.activeCanvas.setPointerCapture(e.pointerId);
    const p = this.toLogical(e);

    if (this.tool === 'eraser') {
      this.erasing = true;
      this.eraseEntries = [];
      this.lastErasePoint = p;
      this.cursor = p;
      this.eraseAlong(p, p);
      this.requestRepaint();
      return;
    }

    this.active = {
      id: nextId('s'),
      tool: this.tool,
      color: this.color,
      baseWidth: this.width,
      opacity: this.tool === 'highlighter' ? 0.45 : 1,
      simulatePressure: e.pointerType !== 'pen',
      points: [{ x: p.x, y: p.y, pressure: this.pressureOf(e) }],
    };
    this.requestRepaint();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.tool === 'eraser' && e.pointerType !== 'touch') {
      this.cursor = this.toLogical(e);
      this.requestRepaint();
    }
    if (e.pointerId !== this.activePointerId) return;

    if (this.erasing) {
      const p = this.toLogical(e);
      if (this.lastErasePoint) this.eraseAlong(this.lastErasePoint, p);
      this.lastErasePoint = p;
      return;
    }

    if (!this.active) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
    const source = events.length > 0 ? events : [e];
    const rect = this.activeCanvas.getBoundingClientRect();
    for (const ev of source) {
      this.active.points.push({
        x: ((ev.clientX - rect.left) * STAGE_WIDTH) / rect.width,
        y: ((ev.clientY - rect.top) * STAGE_HEIGHT) / rect.height,
        pressure: this.pressureOf(ev),
      });
    }
    this.requestRepaint();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    this.finishGesture(false);
  };

  private onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    this.finishGesture(true);
  };

  private onPointerLeave = (): void => {
    if (this.cursor && this.activePointerId === null) {
      this.cursor = null;
      this.requestRepaint();
    }
  };

  private finishGesture(cancelled: boolean): void {
    this.activePointerId = null;

    if (this.erasing) {
      this.erasing = false;
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
    drawStroke(this.inkCtx, stroke); // incremental — no full rebuild on commit
    this.undoStack.push({ type: 'add', stroke });
    this.redoStack = [];
    this.notifyHistory();
    this.cb.onCommit();
    this.requestRepaint();
  }

  // ---- eraser -------------------------------------------------------------

  private eraseAlong(from: { x: number; y: number }, to: { x: number; y: number }): void {
    let removed = false;
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const stroke = this.strokes[i];
      const reach = ERASER_RADIUS + stroke.baseWidth * (stroke.tool === 'highlighter' ? 2.4 : 1);
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
    this.inkCtx.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    for (const stroke of this.strokes) drawStroke(this.inkCtx, stroke);
  }

  private requestRepaint(): void {
    if (this.repaintQueued || this.destroyed) return;
    this.repaintQueued = true;
    this.raf = requestAnimationFrame(() => {
      this.repaintQueued = false;
      this.paintActiveLayer();
    });
  }

  private paintActiveLayer(): void {
    const ctx = this.activeCtx;
    ctx.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    if (this.active) drawStroke(ctx, this.active);
    if (this.tool === 'eraser' && this.cursor) {
      ctx.save();
      ctx.strokeStyle = 'rgba(90, 100, 120, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(this.cursor.x, this.cursor.y, ERASER_RADIUS, 0, Math.PI * 2);
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
}
