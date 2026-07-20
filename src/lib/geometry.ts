import type { CameraLayout, StageSize } from '../types';
import { CAMERA_MIN_WIDTH, CAMERA_MAX_WIDTH, cameraAspectFor } from '../types';

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Fit a camera layout back inside a stage window (after rotation): shrink if
 *  it can no longer fit, then pull it inside the bounds. */
export function clampCameraLayout(layout: CameraLayout, stage: StageSize): CameraLayout {
  const aspect = cameraAspectFor(layout.shape);
  const maxWidth = Math.min(CAMERA_MAX_WIDTH, stage.w - 48, (stage.h - 48) / aspect);
  const width = Math.round(clamp(layout.width, CAMERA_MIN_WIDTH, Math.max(CAMERA_MIN_WIDTH, maxWidth)));
  const height = Math.round(width * aspect);
  return {
    ...layout,
    width,
    height,
    x: Math.round(clamp(layout.x, 0, Math.max(0, stage.w - width))),
    y: Math.round(clamp(layout.y, 0, Math.max(0, stage.h - height))),
  };
}

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Source rect that fills dest at its aspect ratio (CSS object-fit: cover). */
export function coverCrop(srcW: number, srcH: number, destW: number, destH: number): CropRect {
  const destAspect = destW / destH;
  const srcAspect = srcW / srcH;
  if (srcAspect > destAspect) {
    const sw = srcH * destAspect;
    return { sx: (srcW - sw) / 2, sy: 0, sw, sh: srcH };
  }
  const sh = srcW / destAspect;
  return { sx: 0, sy: (srcH - sh) / 2, sw: srcW, sh };
}

export function distPointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** roundRect built from arcs — works on engines without Path2D.roundRect. */
export function addRoundRect(
  path: Path2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  path.moveTo(x + radius, y);
  path.arcTo(x + w, y, x + w, y + h, radius);
  path.arcTo(x + w, y + h, x, y + h, radius);
  path.arcTo(x, y + h, x, y, radius);
  path.arcTo(x, y, x + w, y, radius);
  path.closePath();
}

export function cameraCornerRadius(width: number, height: number): number {
  return Math.min(width, height) * 0.14;
}

/** Clip path for the camera overlay, in logical stage coordinates.
 *  Must stay in sync with the CSS border-radius used by the DOM overlay. */
export function cameraClipPath(layout: CameraLayout): Path2D {
  const path = new Path2D();
  if (layout.shape === 'circle') {
    const r = Math.min(layout.width, layout.height) / 2;
    path.arc(layout.x + layout.width / 2, layout.y + layout.height / 2, r, 0, Math.PI * 2);
  } else if (layout.shape === 'rounded') {
    addRoundRect(
      path,
      layout.x,
      layout.y,
      layout.width,
      layout.height,
      cameraCornerRadius(layout.width, layout.height),
    );
  } else {
    path.rect(layout.x, layout.y, layout.width, layout.height);
  }
  return path;
}
