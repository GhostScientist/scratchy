import { STAGE_WIDTH, STAGE_HEIGHT } from '../types';
import type { ViewportState } from '../types';

/**
 * Recording presets (SPEC §6.5). The interactive stage stays 1280×720; a
 * preset only changes the compositor's output canvas. Non-16:9 presets
 * record a centered crop of the stage, marked on screen by a frame guide.
 */
export interface RecordingPreset {
  id: 'compat' | 'quality' | 'vertical';
  label: string;
  description: string;
  width: number;
  height: number;
  fps: number;
  videoBitsPerSecond: number;
  /** Gated on the device profile's 1080p performance probe. */
  needsPerformance: boolean;
}

export const PRESETS: RecordingPreset[] = [
  {
    id: 'compat',
    label: '720p',
    description: '1280×720 · plays everywhere',
    width: 1280,
    height: 720,
    fps: 30,
    videoBitsPerSecond: 6_000_000,
    needsPerformance: false,
  },
  {
    id: 'quality',
    label: '1080p',
    description: '1920×1080 · sharper ink',
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitsPerSecond: 12_000_000,
    needsPerformance: true,
  },
  {
    id: 'vertical',
    label: 'Vertical',
    description: '1080×1920 · social video',
    width: 1080,
    height: 1920,
    fps: 30,
    videoBitsPerSecond: 10_000_000,
    needsPerformance: true,
  },
];

export function presetById(id: string): RecordingPreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

export interface OutputCrop {
  /** Crop rect in stage pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Output pixels per stage pixel. */
  scale: number;
}

/** Centered crop of the 1280×720 stage matching the preset's aspect. */
export function outputCrop(preset: RecordingPreset): OutputCrop {
  const stageAspect = STAGE_WIDTH / STAGE_HEIGHT;
  const outAspect = preset.width / preset.height;
  let w = STAGE_WIDTH;
  let h = STAGE_HEIGHT;
  if (outAspect < stageAspect) {
    w = Math.round(STAGE_HEIGHT * outAspect);
  } else if (outAspect > stageAspect) {
    h = Math.round(STAGE_WIDTH / outAspect);
  }
  return {
    x: Math.round((STAGE_WIDTH - w) / 2),
    y: Math.round((STAGE_HEIGHT - h) / 2),
    w,
    h,
    scale: preset.height / h,
  };
}

/** The viewport whose (0,0)→(outW,outH) render equals the stage crop: every
 *  world-space renderer (background, strokes, laser) works with it verbatim. */
export function effectiveView(view: ViewportState, preset: RecordingPreset): ViewportState {
  const crop = outputCrop(preset);
  return {
    x: view.x + crop.x / view.zoom,
    y: view.y + crop.y / view.zoom,
    zoom: view.zoom * crop.scale,
  };
}
