import type { BackgroundKind, CameraLayout, Stroke, Tool } from '../types';

const KEY = 'scratchy.lesson.v1';

export interface SavedLesson {
  version: 1;
  title: string;
  background: BackgroundKind;
  tool: Tool;
  color: string;
  width: number;
  cameraLayout: CameraLayout;
  strokes: Stroke[];
  updatedAt: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Shrink stroke payloads before persisting — coordinates to 0.1 logical px. */
export function compactStrokes(strokes: readonly Stroke[]): Stroke[] {
  return strokes.map((s) => ({
    ...s,
    points: s.points.map((p) => ({
      x: round1(p.x),
      y: round1(p.y),
      pressure: Math.round(p.pressure * 1000) / 1000,
    })),
  }));
}

export function saveLesson(lesson: SavedLesson): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(lesson));
    return true;
  } catch {
    return false;
  }
}

export function loadLesson(): SavedLesson | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedLesson;
    if (parsed?.version !== 1 || !Array.isArray(parsed.strokes)) return null;
    return parsed;
  } catch {
    return null;
  }
}
