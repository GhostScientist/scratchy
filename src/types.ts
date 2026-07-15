export const STAGE_WIDTH = 1280;
export const STAGE_HEIGHT = 720;
/** Fixed backing-store multiplier for display canvases: crisp on hi-dpr,
 *  always >= composition resolution for a clean downscale into the recording. */
export const BACKING_SCALE = 2;

export type Tool =
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'hand'
  | 'laser'
  | 'shape'
  | 'text'
  | 'select';
export type InkTool = 'pen' | 'highlighter';
export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow';

/** x,y = world coordinates of the stage's top-left corner. */
export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export const DEFAULT_VIEWPORT: ViewportState = { x: 0, y: 0, zoom: 1 };
export type BackgroundKind = 'white' | 'dark' | 'grid' | 'dots';
export type CameraShape = 'circle' | 'rounded' | 'rect' | 'cutout';

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
}

export interface Stroke {
  kind: 'stroke';
  id: string;
  tool: InkTool;
  color: string;
  baseWidth: number;
  opacity: number;
  /** true when input came from mouse/touchpad — perfect-freehand fakes pressure from velocity */
  simulatePressure: boolean;
  points: StrokePoint[];
}

/** Outlined shape in world coordinates. For 'line'/'arrow', (x,y)→(x+w,y+h)
 *  is the segment, so w/h may be negative; rect/ellipse are normalized on
 *  commit. */
export interface ShapeElement {
  kind: 'shape';
  id: string;
  shape: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  strokeWidth: number;
  opacity: number;
}

export interface TextElement {
  kind: 'text';
  id: string;
  /** Top-left corner in world coordinates. */
  x: number;
  y: number;
  text: string;
  color: string;
  /** World units — scales with zoom like ink does. */
  fontSize: number;
}

/** A bitmap placed on the board. Pixels live in the IndexedDB assets store;
 *  the element only carries the reference plus its world rect. */
export interface ImageElement {
  kind: 'image';
  id: string;
  /** Key into the assets store (persistence/assets.ts). */
  assetId: string;
  /** Top-left corner in world coordinates; w/h are always positive. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Intrinsic pixel size — keeps resize aspect-true and sizes placeholders. */
  naturalW: number;
  naturalH: number;
  /** Locked images ignore move/erase/lasso/clear — annotations go over them.
   *  PDF slide backdrops import locked. */
  locked?: boolean;
}

/** Everything that lives in the board document, discriminated by `kind`.
 *  Pre-element saves lack the field; loaders normalize it to 'stroke'. */
export type BoardElement = Stroke | ShapeElement | TextElement | ImageElement;

/** Only images can be locked today, but every interaction gate asks through
 *  this helper so the rule lives in one place. */
export function isLocked(el: BoardElement): boolean {
  return el.kind === 'image' && el.locked === true;
}

/** One slide of a board. Each page keeps its own viewport so flipping back
 *  to a slide shows it framed the way you left it. */
export interface BoardPage {
  id: string;
  elements: BoardElement[];
  viewport: ViewportState;
}

export function blankPage(): BoardPage {
  return { id: nextId('pg'), elements: [], viewport: { ...DEFAULT_VIEWPORT } };
}

export interface CameraLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  shape: CameraShape;
  mirrored: boolean;
}

export interface Take {
  blob: Blob;
  url: string;
  mimeType: string;
  extension: string;
  durationMs: number;
  createdAt: number;
}

export const CAMERA_MIN_WIDTH = 140;
export const CAMERA_MAX_WIDTH = 640;
export const CAMERA_ASPECT = 9 / 16;

export const DEFAULT_CAMERA_LAYOUT: CameraLayout = {
  x: STAGE_WIDTH - 300 - 24,
  y: STAGE_HEIGHT - Math.round(300 * CAMERA_ASPECT) - 24,
  width: 300,
  height: Math.round(300 * CAMERA_ASPECT),
  shape: 'rounded',
  mirrored: true,
};

export function cameraAspectFor(shape: CameraShape): number {
  return shape === 'circle' ? 1 : CAMERA_ASPECT;
}

let idCounter = 0;
export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}
