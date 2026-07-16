import { drawStroke } from '../lib/strokes';
import type { BBox } from '../lib/strokes';
import {
  drawElement,
  elementBBox,
  elementVisualPad,
  hitTestElement,
  normalizeElement,
  translateElement,
} from '../lib/elements';
import { elementInPolygon } from '../lib/lasso';
import type { LassoPoint } from '../lib/lasso';
import { drawLaserTrail, pruneLaserTrail } from '../lib/laser';
import type { LaserPoint } from '../lib/laser';
import { onImageCacheChange } from '../lib/imageCache';
import { STAGE_WIDTH, STAGE_HEIGHT, BACKING_SCALE, isLocked, nextId } from '../types';
import type {
  BoardElement,
  ImageElement,
  ShapeElement,
  ShapeKind,
  Stroke,
  TextElement,
  Tool,
} from '../types';
import type { Viewport, Point } from './Viewport';

/** World-space rect snapshot for image resize undo. */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Command =
  | { type: 'add'; element: BoardElement }
  | { type: 'erase'; entries: { index: number; element: BoardElement }[] }
  | { type: 'move'; ids: string[]; dx: number; dy: number }
  | { type: 'setText'; id: string; before: string; after: string }
  | { type: 'resize'; id: string; before: Rect; after: Rect }
  | { type: 'setLocked'; ids: string[]; locked: boolean };

export interface TextEditRequest {
  /** Existing element being edited, or null to create new text at `world`. */
  element: TextElement | null;
  world: Point;
}

export interface InkEngineCallbacks {
  onHistoryChange(canUndo: boolean, canRedo: boolean): void;
  /** Document changed (add / erase / clear / undo / redo) — autosave hook. */
  onCommit(): void;
  /** The text tool tapped the board — the host shows a DOM editor. */
  onTextEdit(request: TextEditRequest): void;
  /** Selection changed (or a selected element's rect/lock settled) — the
   *  host repositions its selection-actions overlay. */
  onSelectionChange(): void;
}

/** What the host needs to render selection actions (lock/unlock overlay). */
export interface SelectionInfo {
  ids: string[];
  /** Union bbox in world coordinates, null when nothing is selected. */
  bbox: BBox | null;
  /** Image elements inside the selection (lock/unlock targets). */
  images: ImageElement[];
}

const ERASER_RADIUS = 20;
/** Stage-px reach of an image resize corner handle. */
const HANDLE_REACH = 12;
/** Smallest world-px edge an image can be resized down to. */
const MIN_IMAGE_SIZE = 8;
/** A lasso whose whole extent stays under this many stage px is a tap. */
const LASSO_TAP_PX = 6;
/** A touch that lands this soon after another may convert the gesture to pan. */
const PAN_TAKEOVER_MS = 150;
/** ...but only while the provisional stroke is still short (stage px). */
const PAN_TAKEOVER_TRAVEL_PX = 12;
/** Fingers must spread/close by this many stage px from the gesture's start
 *  before pinch-zoom engages — a plain two-finger drag stays a pure pan. */
const PINCH_INTENT_PX = 24;
/** ...and by at least this ratio, so close-together fingers don't latch on
 *  the same absolute drift a wide grip shrugs off. */
const PINCH_INTENT_RATIO = 1.12;

type Mode =
  | 'idle'
  | 'stroke'
  | 'erase'
  | 'pan'
  | 'laser'
  | 'shape'
  | 'lasso'
  | 'select-move'
  | 'select-resize';

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
  private elements: BoardElement[] = [];
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  private mode: Mode = 'idle';
  private active: Stroke | null = null;
  private activePointerId: number | null = null;
  private strokeStartedAt = 0;
  private lastStagePoint: Point | null = null;

  /** Shape being dragged out; enters the document on pointer-up. */
  private activeShape: ShapeElement | null = null;
  private shapeKind: ShapeKind = 'rect';

  /** Lasso polygon in world coordinates while the select tool drags. */
  private lassoPoints: LassoPoint[] = [];
  private selectedIds = new Set<string>();
  private moveLast: Point | null = null;
  private moveDx = 0;
  private moveDy = 0;

  /** Live image resize: the dragged element, its pre-drag rect, and the
   *  fixed opposite corner (world coordinates). */
  private resizeId: string | null = null;
  private resizeBefore: Rect | null = null;
  private resizeAnchor: Point | null = null;

  /** Element hidden from the ink cache while a DOM text editor covers it. */
  private hiddenElementId: string | null = null;

  /** Live pan/pinch pointers, in stage coordinates. */
  private panPoints = new Map<number, Point>();
  private lastCentroid: Point | null = null;
  private lastPinchDist = 0;
  /** Finger distance when the current two-pointer gesture began. */
  private pinchStartDist = 0;
  /** Two-finger moves only zoom once the pinch intent threshold is crossed. */
  private pinchZoomLatched = false;
  private spacePan = false;

  private eraseEntries: { index: number; element: BoardElement }[] = [];
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
  private unsubscribeImageCache: () => void;

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
    // Image assets decode async — repaint committed ink once pixels arrive.
    this.unsubscribeImageCache = onImageCacheChange(() => {
      this.cacheDirty = true;
      this.requestRepaint();
    });
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.unsubscribeViewport();
    this.unsubscribeImageCache();
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
    if (this.tool === 'select' && tool !== 'select') {
      this.selectedIds.clear();
      this.lassoPoints = [];
      this.notifySelection();
    }
    this.tool = tool;
    this.color = color;
    this.width = width;
    if (tool !== 'eraser') this.cursor = null;
    this.updateCursorStyle();
    this.requestRepaint();
  }

  setShapeKind(kind: ShapeKind): void {
    this.shapeKind = kind;
  }

  /** Transient pan while the spacebar is held (mouse/keyboard workflow). */
  setSpacePan(on: boolean): void {
    if (this.spacePan === on) return;
    this.spacePan = on;
    this.updateCursorStyle();
  }

  /** Undo applies a command inverted; redo re-applies it forward. */
  private applyCommand(cmd: Command, invert: boolean): void {
    switch (cmd.type) {
      case 'add': {
        if (invert) {
          const i = this.elements.indexOf(cmd.element);
          if (i >= 0) this.elements.splice(i, 1);
        } else {
          this.elements.push(cmd.element);
        }
        break;
      }
      case 'erase': {
        if (invert) {
          for (let j = cmd.entries.length - 1; j >= 0; j--) {
            this.elements.splice(cmd.entries[j].index, 0, cmd.entries[j].element);
          }
        } else {
          for (const entry of cmd.entries) this.elements.splice(entry.index, 1);
        }
        break;
      }
      case 'resize': {
        const rect = invert ? cmd.before : cmd.after;
        this.elements = this.elements.map((el) =>
          el.id === cmd.id && el.kind === 'image' ? { ...el, ...rect } : el,
        );
        break;
      }
      case 'setLocked': {
        const locked = invert ? !cmd.locked : cmd.locked;
        const set = new Set(cmd.ids);
        this.elements = this.elements.map((el) =>
          set.has(el.id) && el.kind === 'image' ? { ...el, locked } : el,
        );
        break;
      }
      case 'move': {
        const set = new Set(cmd.ids);
        const dx = invert ? -cmd.dx : cmd.dx;
        const dy = invert ? -cmd.dy : cmd.dy;
        this.elements = this.elements.map((el) =>
          set.has(el.id) ? translateElement(el, dx, dy) : el,
        );
        break;
      }
      case 'setText': {
        const text = invert ? cmd.before : cmd.after;
        this.elements = this.elements.map((el) =>
          el.id === cmd.id && el.kind === 'text' ? { ...el, text } : el,
        );
        break;
      }
    }
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    this.applyCommand(cmd, true);
    this.redoStack.push(cmd);
    this.selectedIds.clear();
    this.notifySelection();
    this.afterDocumentChange();
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    this.applyCommand(cmd, false);
    this.undoStack.push(cmd);
    this.selectedIds.clear();
    this.notifySelection();
    this.afterDocumentChange();
  }

  clear(): void {
    // Clearing is an erase of everything unlocked: locked backdrops (PDF
    // slides) survive so "clear" wipes the annotations, not the slide.
    const entries: { index: number; element: BoardElement }[] = [];
    for (let i = this.elements.length - 1; i >= 0; i--) {
      if (isLocked(this.elements[i])) continue;
      entries.push({ index: i, element: this.elements[i] });
      this.elements.splice(i, 1);
    }
    if (entries.length === 0) return;
    this.undoStack.push({ type: 'erase', entries });
    this.redoStack = [];
    this.selectedIds.clear();
    this.notifySelection();
    // Deliberately leaves the viewport alone: clearing removes content,
    // it is not a navigation action.
    this.afterDocumentChange();
  }

  loadStrokes(elements: BoardElement[]): void {
    // Pre-element saves stored bare strokes without `kind`.
    this.elements = elements.map(normalizeElement);
    this.undoStack = [];
    this.redoStack = [];
    this.selectedIds.clear();
    this.notifySelection();
    this.hiddenElementId = null;
    this.rebuildInkCache();
    this.cb.onHistoryChange(false, false);
  }

  getStrokes(): readonly BoardElement[] {
    return this.elements;
  }

  getElements(): readonly BoardElement[] {
    return this.elements;
  }

  hasStrokes(): boolean {
    return this.elements.length > 0;
  }

  /** The element currently being drawn (stroke or shape), for the compositor. */
  getActiveElement(): BoardElement | null {
    return this.active ?? this.activeShape;
  }

  // ---- selection ------------------------------------------------------------

  getSelection(): string[] {
    return [...this.selectedIds];
  }

  getSelectionInfo(): SelectionInfo {
    const ids: string[] = [];
    const images: ImageElement[] = [];
    let bbox: BBox | null = null;
    for (const el of this.elements) {
      if (!this.selectedIds.has(el.id)) continue;
      ids.push(el.id);
      if (el.kind === 'image') images.push(el);
      const box = elementBBox(el);
      const pad = elementVisualPad(el);
      if (!bbox) {
        bbox = { minX: box.minX - pad, minY: box.minY - pad, maxX: box.maxX + pad, maxY: box.maxY + pad };
      } else {
        bbox.minX = Math.min(bbox.minX, box.minX - pad);
        bbox.minY = Math.min(bbox.minY, box.minY - pad);
        bbox.maxX = Math.max(bbox.maxX, box.maxX + pad);
        bbox.maxY = Math.max(bbox.maxY, box.maxY + pad);
      }
    }
    return { ids, bbox, images };
  }

  clearSelection(): void {
    if (this.selectedIds.size === 0) return;
    this.selectedIds.clear();
    this.notifySelection();
    this.requestRepaint();
  }

  deleteSelection(): void {
    if (this.selectedIds.size === 0) return;
    const entries: { index: number; element: BoardElement }[] = [];
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const el = this.elements[i];
      if (this.selectedIds.has(el.id) && !isLocked(el)) {
        entries.push({ index: i, element: el });
        this.elements.splice(i, 1);
      }
    }
    this.selectedIds.clear();
    this.notifySelection();
    if (entries.length === 0) {
      this.requestRepaint();
      return;
    }
    this.undoStack.push({ type: 'erase', entries });
    this.redoStack = [];
    this.afterDocumentChange();
  }

  /** Lock/unlock every image in the selection. Undoable; keeps selection. */
  setLockedSelection(locked: boolean): void {
    const ids = this.elements
      .filter((el) => this.selectedIds.has(el.id) && el.kind === 'image' && isLocked(el) !== locked)
      .map((el) => el.id);
    if (ids.length === 0) return;
    const cmd: Command = { type: 'setLocked', ids, locked };
    this.applyCommand(cmd, false);
    this.undoStack.push(cmd);
    this.redoStack = [];
    this.notifySelection();
    this.afterDocumentChange();
  }

  // ---- text ------------------------------------------------------------------

  addTextElement(el: TextElement): void {
    if (el.text.trim() === '') return;
    this.elements.push(el);
    this.undoStack.push({ type: 'add', element: el });
    this.redoStack = [];
    this.afterDocumentChange();
  }

  // ---- images ----------------------------------------------------------------

  addImageElement(el: ImageElement): void {
    this.elements.push(el);
    this.undoStack.push({ type: 'add', element: el });
    this.redoStack = [];
    this.afterDocumentChange();
  }

  /** Empty text deletes the element; identical text is a no-op. */
  updateTextElement(id: string, text: string): void {
    const index = this.elements.findIndex((el) => el.id === id && el.kind === 'text');
    if (index < 0) return;
    const el = this.elements[index] as TextElement;
    if (text.trim() === '') {
      this.elements.splice(index, 1);
      this.undoStack.push({ type: 'erase', entries: [{ index, element: el }] });
    } else if (text !== el.text) {
      this.elements[index] = { ...el, text };
      this.undoStack.push({ type: 'setText', id, before: el.text, after: text });
    } else {
      return;
    }
    this.redoStack = [];
    this.afterDocumentChange();
  }

  /** Hide a committed element while a DOM editor overlays it. */
  setHiddenElementId(id: string | null): void {
    if (this.hiddenElementId === id) return;
    this.hiddenElementId = id;
    this.rebuildInkCache();
    this.requestRepaint();
  }

  getInkCanvas(): HTMLCanvasElement {
    return this.inkCanvas;
  }

  getLaserTrail(): readonly LaserPoint[] {
    return this.laserTrail;
  }

  /** Union bbox of all committed content in world coordinates. */
  getInkBBox(): BBox | null {
    if (this.elements.length === 0) return null;
    const box: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const el of this.elements) {
      const b = elementBBox(el);
      const pad = elementVisualPad(el);
      if (b.minX - pad < box.minX) box.minX = b.minX - pad;
      if (b.minY - pad < box.minY) box.minY = b.minY - pad;
      if (b.maxX + pad > box.maxX) box.maxX = b.maxX + pad;
      if (b.maxY + pad > box.maxY) box.maxY = b.maxY + pad;
    }
    return box;
  }

  /** Topmost element within touch reach of a world point (select/text tools).
   *  Locked elements are transparent to hits unless `includeLocked` — pointer
   *  gestures pass through a locked backdrop, but a deliberate tap can still
   *  select it for unlocking. */
  private hitAtPoint(
    p: Point,
    kindFilter?: BoardElement['kind'],
    includeLocked = false,
  ): BoardElement | null {
    const zoom = this.viewport.get().zoom;
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const el = this.elements[i];
      if (kindFilter && el.kind !== kindFilter) continue;
      if (!includeLocked && isLocked(el)) continue;
      if (el.kind === 'text') {
        // Text hits anywhere in its box, not just the glyph outlines.
        const box = elementBBox(el);
        const slop = 6 / zoom;
        if (
          p.x >= box.minX - slop &&
          p.x <= box.maxX + slop &&
          p.y >= box.minY - slop &&
          p.y <= box.maxY + slop
        ) {
          return el;
        }
        continue;
      }
      const reach = 8 / zoom + elementVisualPad(el);
      if (hitTestElement(el, p, p, reach)) return el;
    }
    return null;
  }

  /** The lone selected image, when it is resizable (single + unlocked). */
  private singleSelectedImage(): ImageElement | null {
    if (this.tool !== 'select' || this.selectedIds.size !== 1) return null;
    const [id] = this.selectedIds;
    const el = this.elements.find((e) => e.id === id);
    return el && el.kind === 'image' && !isLocked(el) ? el : null;
  }

  /** Corner handle under a stage point, with the opposite (fixed) corner. */
  private resizeHandleAt(stage: Point): { el: ImageElement; anchor: Point } | null {
    const el = this.singleSelectedImage();
    if (!el) return null;
    const corners = [
      { x: el.x, y: el.y },
      { x: el.x + el.w, y: el.y },
      { x: el.x + el.w, y: el.y + el.h },
      { x: el.x, y: el.y + el.h },
    ];
    for (let i = 0; i < 4; i++) {
      const c = this.viewport.worldToStage(corners[i]);
      if (Math.hypot(c.x - stage.x, c.y - stage.y) <= HANDLE_REACH) {
        return { el, anchor: corners[(i + 2) % 4] };
      }
    }
    return null;
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

    // Resting palm during an erase drag, pointing, or a shape/select gesture.
    if (this.mode !== 'idle') return;

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

    if (tool === 'text') {
      // Not a drag tool: report the tap (an existing text element or a new
      // position) and stay idle — the host opens a DOM editor.
      this.activePointerId = null;
      const existing = this.hitAtPoint(p, 'text') as TextElement | null;
      this.cb.onTextEdit({ element: existing, world: p });
      return;
    }

    if (tool === 'shape') {
      this.mode = 'shape';
      this.activeShape = {
        kind: 'shape',
        id: nextId('sh'),
        shape: this.shapeKind,
        x: p.x,
        y: p.y,
        w: 0,
        h: 0,
        color: this.color,
        strokeWidth: this.width,
        opacity: 1,
      };
      this.requestRepaint();
      return;
    }

    if (tool === 'select') {
      // Corner handles first: they extend past the image, and a grab must
      // win over hit-testing whatever sits underneath.
      const resize = this.resizeHandleAt(stage);
      if (resize) {
        this.mode = 'select-resize';
        this.resizeId = resize.el.id;
        this.resizeBefore = { x: resize.el.x, y: resize.el.y, w: resize.el.w, h: resize.el.h };
        this.resizeAnchor = resize.anchor;
        this.requestRepaint();
        return;
      }
      const hit = this.hitAtPoint(p);
      if (hit) {
        // Tap on an unselected element selects just it; dragging moves the
        // whole selection.
        if (!this.selectedIds.has(hit.id)) {
          this.selectedIds = new Set([hit.id]);
          this.notifySelection();
        }
        this.mode = 'select-move';
        this.moveLast = p;
        this.moveDx = 0;
        this.moveDy = 0;
      } else {
        if (this.selectedIds.size > 0) {
          this.selectedIds.clear();
          this.notifySelection();
        }
        this.mode = 'lasso';
        this.lassoPoints = [{ x: p.x, y: p.y }];
      }
      this.requestRepaint();
      return;
    }

    this.mode = 'stroke';
    this.strokeStartedAt = performance.now();
    this.active = {
      kind: 'stroke',
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
        if (this.pinchZoomLatched) {
          if (this.lastPinchDist > 0 && dist > 0) {
            this.viewport.zoomAt(centroid, dist / this.lastPinchDist);
          }
          this.lastPinchDist = dist;
        } else if (this.pinchStartDist > 0 && dist > 0) {
          // Dead-zone: incidental distance wobble during a two-finger drag
          // must not zoom. Latch only on deliberate spread/close, measured
          // cumulatively from the gesture's start, then apply the pent-up
          // factor at once so the canvas tracks the fingers with no jump.
          const drift = Math.abs(dist - this.pinchStartDist);
          const ratio = Math.abs(Math.log(dist / this.pinchStartDist));
          if (drift > PINCH_INTENT_PX && ratio > Math.log(PINCH_INTENT_RATIO)) {
            this.pinchZoomLatched = true;
            this.viewport.zoomAt(centroid, dist / this.pinchStartDist);
            this.lastPinchDist = dist;
          }
        }
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

    if (this.mode === 'shape') {
      if (!this.activeShape) return;
      const p = this.toWorld(e.clientX, e.clientY);
      this.activeShape.w = p.x - this.activeShape.x;
      this.activeShape.h = p.y - this.activeShape.y;
      this.requestRepaint();
      return;
    }

    if (this.mode === 'lasso') {
      const p = this.toWorld(e.clientX, e.clientY);
      this.lassoPoints.push({ x: p.x, y: p.y });
      this.requestRepaint();
      return;
    }

    if (this.mode === 'select-move') {
      const p = this.toWorld(e.clientX, e.clientY);
      if (!this.moveLast) return;
      const dx = p.x - this.moveLast.x;
      const dy = p.y - this.moveLast.y;
      this.moveLast = p;
      this.moveDx += dx;
      this.moveDy += dy;
      const set = this.selectedIds;
      this.elements = this.elements.map((el) =>
        set.has(el.id) && !isLocked(el) ? translateElement(el, dx, dy) : el,
      );
      // Coalesce cache rebuilds to one per frame while dragging.
      this.cacheDirty = true;
      this.requestRepaint();
      return;
    }

    if (this.mode === 'select-resize') {
      const anchor = this.resizeAnchor;
      const before = this.resizeBefore;
      if (!anchor || !before || !this.resizeId) return;
      const p = this.toWorld(e.clientX, e.clientY);
      // Aspect-true: grow to whichever of the drag's extents dominates.
      const aspect = before.h > 0 ? before.w / before.h : 1;
      let w = Math.abs(p.x - anchor.x);
      let h = Math.abs(p.y - anchor.y);
      if (w < h * aspect) w = h * aspect;
      else h = w / aspect;
      if (w < MIN_IMAGE_SIZE || h < MIN_IMAGE_SIZE) {
        const grow = Math.max(MIN_IMAGE_SIZE / Math.max(w, 0.001), MIN_IMAGE_SIZE / Math.max(h, 0.001));
        w *= grow;
        h *= grow;
      }
      const x = p.x >= anchor.x ? anchor.x : anchor.x - w;
      const y = p.y >= anchor.y ? anchor.y : anchor.y - h;
      const id = this.resizeId;
      this.elements = this.elements.map((el) =>
        el.id === id && el.kind === 'image' ? { ...el, x, y, w, h } : el,
      );
      this.cacheDirty = true;
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
    this.pinchStartDist = this.lastPinchDist;
    this.pinchZoomLatched = false;
  }

  /** Did this lasso stay within a tap's worth of movement on screen? */
  private lassoWasTap(poly: readonly LassoPoint[]): boolean {
    const zoom = this.viewport.get().zoom;
    const reach = LASSO_TAP_PX / zoom;
    const first = poly[0];
    for (const p of poly) {
      if (Math.abs(p.x - first.x) > reach || Math.abs(p.y - first.y) > reach) return false;
    }
    return true;
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
    const wasShape = this.mode === 'shape';
    const wasLasso = this.mode === 'lasso';
    const wasMove = this.mode === 'select-move';
    const wasResize = this.mode === 'select-resize';
    this.mode = 'idle';

    if (wasResize) {
      const id = this.resizeId;
      const before = this.resizeBefore;
      this.resizeId = null;
      this.resizeBefore = null;
      this.resizeAnchor = null;
      const el = this.elements.find((e) => e.id === id);
      if (id && before && el && el.kind === 'image') {
        if (cancelled) {
          this.elements = this.elements.map((e) =>
            e.id === id && e.kind === 'image' ? { ...e, ...before } : e,
          );
          this.cacheDirty = true;
        } else if (el.x !== before.x || el.y !== before.y || el.w !== before.w || el.h !== before.h) {
          this.undoStack.push({
            type: 'resize',
            id,
            before,
            after: { x: el.x, y: el.y, w: el.w, h: el.h },
          });
          this.redoStack = [];
          this.notifyHistory();
          this.cb.onCommit();
        }
      }
      this.notifySelection();
      this.requestRepaint();
      return;
    }

    if (wasLaser) {
      // Nothing to commit — the trail keeps fading on its own.
      this.requestRepaint();
      return;
    }

    if (wasShape) {
      const shape = this.activeShape;
      this.activeShape = null;
      if (shape && !cancelled && (Math.abs(shape.w) > 1 || Math.abs(shape.h) > 1)) {
        // Rect/ellipse normalize to positive extents; line/arrow keep their
        // direction (the arrowhead points where the drag ended).
        const el: ShapeElement =
          shape.shape === 'rect' || shape.shape === 'ellipse'
            ? {
                ...shape,
                x: Math.min(shape.x, shape.x + shape.w),
                y: Math.min(shape.y, shape.y + shape.h),
                w: Math.abs(shape.w),
                h: Math.abs(shape.h),
              }
            : shape;
        this.elements.push(el);
        if (!this.cacheDirty) drawElement(this.inkCtx, el, true);
        this.undoStack.push({ type: 'add', element: el });
        this.redoStack = [];
        this.notifyHistory();
        this.cb.onCommit();
      }
      this.requestRepaint();
      return;
    }

    if (wasLasso) {
      const poly = this.lassoPoints;
      this.lassoPoints = [];
      if (!cancelled && poly.length > 0) {
        if (this.lassoWasTap(poly)) {
          // A tap reached the lasso, so nothing unlocked sits here — but a
          // locked backdrop might, and a deliberate tap selects it so the
          // host can offer Unlock.
          const hit = this.hitAtPoint(poly[0], undefined, true);
          this.selectedIds = hit && isLocked(hit) ? new Set([hit.id]) : new Set();
        } else if (poly.length >= 3) {
          // Locked elements are not lassoable: circling annotations on top
          // of a backdrop must never scoop up the backdrop itself.
          this.selectedIds = new Set(
            this.elements
              .filter((el) => !isLocked(el) && elementInPolygon(el, poly))
              .map((el) => el.id),
          );
        }
        this.notifySelection();
      }
      this.requestRepaint();
      return;
    }

    if (wasMove) {
      this.moveLast = null;
      if ((this.moveDx !== 0 || this.moveDy !== 0) && this.selectedIds.size > 0) {
        if (cancelled) {
          // Put everything back where it was.
          const set = this.selectedIds;
          this.elements = this.elements.map((el) =>
            set.has(el.id) && !isLocked(el)
              ? translateElement(el, -this.moveDx, -this.moveDy)
              : el,
          );
          this.cacheDirty = true;
        } else {
          this.undoStack.push({
            type: 'move',
            ids: this.elements
              .filter((el) => this.selectedIds.has(el.id) && !isLocked(el))
              .map((el) => el.id),
            dx: this.moveDx,
            dy: this.moveDy,
          });
          this.redoStack = [];
          this.notifyHistory();
          this.cb.onCommit();
        }
        this.notifySelection();
      }
      this.moveDx = 0;
      this.moveDy = 0;
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
    this.elements.push(stroke);
    // Incremental — no full rebuild on commit. The ink ctx keeps the viewport
    // transform between rebuilds; skip when a rebuild is already pending
    // (its transform would be stale, and the rebuild redraws everything).
    if (!this.cacheDirty) drawStroke(this.inkCtx, stroke, true);
    this.undoStack.push({ type: 'add', element: stroke });
    this.redoStack = [];
    this.notifyHistory();
    this.cb.onCommit();
    this.requestRepaint();
  }

  // ---- eraser -------------------------------------------------------------

  private eraseAlong(from: Point, to: Point): void {
    // The cursor circle has a fixed on-screen size, so its reach in world
    // units shrinks as you zoom in; element thickness is world-sized.
    const zoom = this.viewport.get().zoom;
    let removed = false;
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const el = this.elements[i];
      // Locked backdrops are erase-proof — swipes clean the ink on top.
      if (isLocked(el)) continue;
      const reach = ERASER_RADIUS / zoom + elementVisualPad(el);
      if (hitTestElement(el, from, to, reach)) {
        this.elements.splice(i, 1);
        this.eraseEntries.push({ index: i, element: el });
        removed = true;
      }
    }
    if (removed) {
      // Coalesce to one rebuild per frame — a fast swipe over dense ink can
      // land several erase moves between paints, and each rebuild redraws
      // every visible element.
      this.cacheDirty = true;
      this.requestRepaint();
    }
  }

  // ---- rendering ----------------------------------------------------------

  private rebuildInkCache(): void {
    const ctx = this.inkCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.inkCanvas.width, this.inkCanvas.height);
    this.viewport.applyTo(ctx);
    const view = this.viewport.visibleWorldRect();
    for (const el of this.elements) {
      if (el.id === this.hiddenElementId) continue;
      const box = elementBBox(el);
      const pad = elementVisualPad(el);
      if (
        box.maxX + pad < view.minX ||
        box.minX - pad > view.maxX ||
        box.maxY + pad < view.minY ||
        box.minY - pad > view.maxY
      ) {
        continue;
      }
      drawElement(ctx, el, true);
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
    if (this.activeShape) drawElement(ctx, this.activeShape);
    if (this.lassoPoints.length > 1) {
      // Lasso trail: world-anchored dashes with screen-constant thickness.
      const zoom = this.viewport.get().zoom;
      ctx.save();
      ctx.strokeStyle = 'rgba(110, 168, 255, 0.9)';
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([6 / zoom, 5 / zoom]);
      ctx.beginPath();
      ctx.moveTo(this.lassoPoints[0].x, this.lassoPoints[0].y);
      for (let i = 1; i < this.lassoPoints.length; i++) {
        ctx.lineTo(this.lassoPoints[i].x, this.lassoPoints[i].y);
      }
      ctx.stroke();
      ctx.restore();
    }
    if (this.tool === 'select' && this.selectedIds.size > 0) {
      // Selection HUD: dashed bbox per element, screen-space line weight.
      ctx.setTransform(BACKING_SCALE, 0, 0, BACKING_SCALE, 0, 0);
      ctx.save();
      ctx.strokeStyle = 'rgba(110, 168, 255, 0.95)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      for (const el of this.elements) {
        if (!this.selectedIds.has(el.id)) continue;
        const box = elementBBox(el);
        const pad = elementVisualPad(el);
        const a = this.viewport.worldToStage({ x: box.minX - pad, y: box.minY - pad });
        const b = this.viewport.worldToStage({ x: box.maxX + pad, y: box.maxY + pad });
        ctx.strokeRect(a.x - 2, a.y - 2, b.x - a.x + 4, b.y - a.y + 4);
      }
      ctx.restore();
      // Corner handles: a single unlocked image resizes by its corners.
      const img = this.singleSelectedImage();
      if (img) {
        ctx.save();
        ctx.setLineDash([]);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = 'rgba(110, 168, 255, 0.95)';
        ctx.lineWidth = 1.5;
        const corners = [
          { x: img.x, y: img.y },
          { x: img.x + img.w, y: img.y },
          { x: img.x + img.w, y: img.y + img.h },
          { x: img.x, y: img.y + img.h },
        ];
        for (const corner of corners) {
          const c = this.viewport.worldToStage(corner);
          ctx.beginPath();
          ctx.rect(c.x - 4, c.y - 4, 8, 8);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }
      this.viewport.applyTo(ctx);
    }
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

  private notifySelection(): void {
    this.cb.onSelectionChange();
  }

  private updateCursorStyle(): void {
    this.activeCanvas.style.cursor = this.spacePan && this.tool !== 'hand' ? 'grab' : '';
  }
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
