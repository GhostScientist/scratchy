import { DEFAULT_VIEWPORT } from '../types';
import type { BackgroundKind, BoardElement, CameraLayout, Tool, ViewportState } from '../types';

const KEY_V2 = 'scratchy.lesson.v2';
const KEY_V1 = 'scratchy.lesson.v1';

export interface SavedLesson {
  version: 2;
  title: string;
  background: BackgroundKind;
  tool: Tool;
  color: string;
  width: number;
  cameraLayout: CameraLayout;
  viewport: ViewportState;
  /** Board content. The field name predates shapes/text; loaders normalize
   *  entries without a `kind` to strokes. */
  strokes: BoardElement[];
  updatedAt: number;
}

/** v1 lessons predate the infinite canvas: no viewport, fixed 1280×720 board. */
interface SavedLessonV1 extends Omit<SavedLesson, 'version' | 'viewport'> {
  version: 1;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Committed strokes are immutable (edits replace the object — the same
 *  invariant the render Path2D cache relies on), so each stroke only ever
 *  needs its points rounded once, not on every debounced save. */
const compactCache = new WeakMap<BoardElement, BoardElement>();

/** Shrink stroke payloads before persisting — coordinates to 0.1 world px.
 *  Shapes and text are already tiny and pass through unchanged. */
export function compactStrokes(elements: readonly BoardElement[]): BoardElement[] {
  return elements.map((el) => {
    if (el.kind !== 'stroke') return el;
    let compact = compactCache.get(el);
    if (!compact) {
      compact = {
        ...el,
        points: el.points.map((p) => ({
          x: round1(p.x),
          y: round1(p.y),
          pressure: Math.round(p.pressure * 1000) / 1000,
        })),
      };
      compactCache.set(el, compact);
    }
    return compact;
  });
}

export function saveLesson(lesson: SavedLesson): boolean {
  try {
    localStorage.setItem(KEY_V2, JSON.stringify(lesson));
    // The old copy is only kept as a fallback until a v2 write succeeds.
    localStorage.removeItem(KEY_V1);
    return true;
  } catch {
    return false;
  }
}

export function loadLesson(): SavedLesson | null {
  try {
    const rawV2 = localStorage.getItem(KEY_V2);
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as SavedLesson;
      if (parsed?.version === 2 && Array.isArray(parsed.strokes)) {
        return { ...parsed, viewport: parsed.viewport ?? { ...DEFAULT_VIEWPORT } };
      }
      return null;
    }
    const rawV1 = localStorage.getItem(KEY_V1);
    if (!rawV1) return null;
    const v1 = JSON.parse(rawV1) as SavedLessonV1;
    if (v1?.version !== 1 || !Array.isArray(v1.strokes)) return null;
    // v1 content occupied world (0,0)–(1280,720); the identity viewport shows
    // it exactly where it was.
    return { ...v1, version: 2, viewport: { ...DEFAULT_VIEWPORT } };
  } catch {
    return null;
  }
}
