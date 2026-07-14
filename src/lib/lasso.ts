import { elementSamplePoints } from './elements';
import type { BoardElement } from '../types';

export interface LassoPoint {
  x: number;
  y: number;
}

/** Ray-cast point-in-polygon (even-odd). */
export function pointInPolygon(x: number, y: number, poly: readonly LassoPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** An element is lassoed when most of its representative points fall inside. */
export function elementInPolygon(el: BoardElement, poly: readonly LassoPoint[]): boolean {
  if (poly.length < 3) return false;
  const samples = elementSamplePoints(el);
  let inside = 0;
  for (const p of samples) {
    if (pointInPolygon(p.x, p.y, poly)) inside += 1;
  }
  return inside > samples.length / 2;
}
