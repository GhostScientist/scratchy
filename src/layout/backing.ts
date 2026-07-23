import { outputCrop } from '../recording/presets';
import type { RecordingPreset } from '../recording/presets';
import { clamp } from '../lib/geometry';
import type { StageSize } from '../types';

/** Per-layer backing budget in px² (~20 MB RGBA). The reference 2× landscape
 *  backing (2560×1440 ≈ 3.7 MP) fits comfortably under it. */
const MAX_BACKING_AREA = 5_000_000;

/**
 * DPR-aware backing-store multiplier for the display canvases.
 *
 * Three forces, in priority order:
 *  1. Recording floor (hard guarantee): the ink cache must hold at least the
 *     active preset's output resolution so the compositor blit is a clean
 *     downscale, never an upscale. That floor is exactly the crop's
 *     output-px-per-stage-px scale.
 *  2. Device sharpness: match devicePixelRatio, quantized to 0.25 steps so
 *     fractional desktop zoom levels (1.1, 1.25…) don't churn reallocations,
 *     and capped at 3 (no visible gain beyond that).
 *  3. Memory budget: never allocate more than MAX_BACKING_AREA px² per layer
 *     — low-end phones with dpr 1–1.5 allocate far less than the old fixed
 *     2×, and dpr-3 phones stay bounded.
 */
export function computeBackingScale(stage: StageSize, preset: RecordingPreset): number {
  const minForRecording = outputCrop(preset, stage).scale;
  const dpr = Math.round(clamp(window.devicePixelRatio || 1, 1, 3) * 4) / 4;
  const budgetCap = Math.sqrt(MAX_BACKING_AREA / (stage.w * stage.h));
  return Math.max(minForRecording, Math.min(dpr, budgetCap));
}
