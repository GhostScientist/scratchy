/**
 * Person-segmentation engine behind the "cutout" camera shape. Wraps
 * MediaPipe's selfie segmenter (loaded lazily — wasm + model ship with the
 * app, no CDN) and maintains an RGBA canvas holding the current video frame
 * with the background removed. Consumers (the DOM preview and the recording
 * Compositor) only ever read that canvas; they never wait on inference.
 *
 * Two independent rates keep the feed smooth:
 *  - The cutout canvas is composited every display frame (video at full
 *    rate, carved by the latest mask) — two GPU drawImages, no readback.
 *  - Inference runs at ~30 fps on a downscaled copy of the frame. MediaPipe
 *    returns the mask at input resolution and resamples to 256×256
 *    internally anyway, so segmenting a ~256-wide canvas costs a fraction
 *    of a full-resolution readback with no quality loss. A slow device
 *    self-throttles to fewer mask updates while the video stays fluid.
 *
 * The engine watches its own cost: if the median inference time stays over
 * budget (mask lag bad enough to look broken), it reports a performance
 * fallback so the app can leave cutout mode. The record-time capability
 * probe can't cover this — the camera runs without recording — so the
 * check lives here.
 */

import type { ImageSegmenter, ImageSegmenterResult } from '@mediapipe/tasks-vision';
import { detectPerfTier } from '../capability/tier';

export type CutoutState = 'idle' | 'loading' | 'ready' | 'failed' | 'unsupported';

export interface CutoutCallbacks {
  onState(state: CutoutState): void;
  /** Sustained over-budget inference — caller should revert to a framed shape. */
  onPerformanceFallback(): void;
}

/** ~30 fps mask updates; the composite itself runs every display frame.
 *  Low-tier devices drop to ~15 fps masks — a slightly laggier silhouette
 *  beats tripping the perf watchdog and losing cutout entirely. */
const INFERENCE_INTERVAL_MS = 33;
const LOW_TIER_INFERENCE_INTERVAL_MS = 66;
/** Segmentation input width — matches the model's internal working size. */
const INFER_WIDTH = 256;
/** Median inference budget. Misses only degrade the mask rate (the loop
 *  self-throttles), so the hard revert fires only when even the lagging
 *  mask would look broken. */
const DEFAULT_BUDGET_MS = 80;
/** Samples per watchdog window. */
const PERF_WINDOW = 30;
/** First inferences include wasm/GPU warmup — never judge them. */
const PERF_WARMUP = 5;
/** Temporal mask smoothing: new*0.7 + previous*0.3 kills edge flicker. */
const MASK_BLEND = 0.7;
/** Edge feather, baked into the full-size mask once per inference. The
 *  canvas blur filter is one of the most expensive 2D ops on weak GPUs, so
 *  low-tier devices use a lighter feather. */
const MASK_FEATHER_PX = 3;
const LOW_TIER_FEATHER_PX = 2;

// Dev/test hooks (wired to window.__scratchyCutout in useCutout): let e2e
// force the failure path and neutralize the perf watchdog on slow CI.
let devBudgetOverrideMs: number | null = null;
let devForceFailure = false;
export function setDevBudgetMs(ms: number): void {
  devBudgetOverrideMs = ms;
}
export function setDevForceFailure(fail: boolean): void {
  devForceFailure = fail;
}

export class CutoutEngine {
  /** Video-sized RGBA frame with the background removed. 0×0 until the
   *  first mask lands. */
  readonly canvas: HTMLCanvasElement;

  private ctx: CanvasRenderingContext2D;
  /** Downscaled video frame handed to the segmenter. */
  private inferCanvas: HTMLCanvasElement;
  private inferCtx: CanvasRenderingContext2D;
  /** Raw mask alpha at inference size. */
  private maskCanvas: HTMLCanvasElement;
  private maskCtx: CanvasRenderingContext2D;
  /** Video-sized, feathered mask the per-frame composite stamps with. */
  private maskFull: HTMLCanvasElement;
  private maskFullCtx: CanvasRenderingContext2D;
  private maskImage: ImageData | null = null;
  private prevMask: Float32Array | null = null;

  private segmenter: ImageSegmenter | null = null;
  private video: HTMLVideoElement | null = null;
  private state: CutoutState = 'idle';
  private raf = 0;
  private generation = 0;
  private lastInferenceAt = 0;
  private lastVideoTime = -1;
  private perfSamples: number[] = [];
  private perfSeen = 0;
  private readonly inferenceIntervalMs: number;
  private readonly featherPx: number;

  constructor(private cb: CutoutCallbacks) {
    const low = detectPerfTier() === 'low';
    this.inferenceIntervalMs = low ? LOW_TIER_INFERENCE_INTERVAL_MS : INFERENCE_INTERVAL_MS;
    this.featherPx = low ? LOW_TIER_FEATHER_PX : MASK_FEATHER_PX;
    this.canvas = document.createElement('canvas');
    this.inferCanvas = document.createElement('canvas');
    this.maskCanvas = document.createElement('canvas');
    this.maskFull = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d');
    const inferCtx = this.inferCanvas.getContext('2d');
    const maskCtx = this.maskCanvas.getContext('2d');
    const maskFullCtx = this.maskFull.getContext('2d');
    if (!ctx || !inferCtx || !maskCtx || !maskFullCtx) {
      throw new Error('Canvas 2D is not available');
    }
    this.ctx = ctx;
    this.inferCtx = inferCtx;
    this.maskCtx = maskCtx;
    this.maskFullCtx = maskFullCtx;
  }

  getState(): CutoutState {
    return this.state;
  }

  /** Idempotent. Lazy-loads the segmenter, then runs until dispose(). */
  start(video: HTMLVideoElement): void {
    if (this.state !== 'idle') return;
    this.video = video;
    if (devForceFailure) {
      this.setState('failed');
      return;
    }
    if (typeof WebAssembly === 'undefined') {
      this.setState('unsupported');
      return;
    }
    this.setState('loading');
    void this.load();
  }

  dispose(): void {
    this.generation += 1;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.video = null;
    this.segmenter?.close();
    this.segmenter = null;
    this.state = 'idle';
  }

  private setState(state: CutoutState): void {
    this.state = state;
    this.cb.onState(state);
  }

  private async load(): Promise<void> {
    const gen = this.generation;
    try {
      // Wasm loader/binary + model resolve to local bundled assets (the
      // pdf.js pattern — offline-safe, no CDN). SIMD build only: every
      // browser that can run the rest of the studio has wasm SIMD.
      const [{ ImageSegmenter: Segmenter }, loader, binary, model] = await Promise.all([
        import('@mediapipe/tasks-vision'),
        import('@mediapipe/tasks-vision/vision_wasm_internal.js?url'),
        import('@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'),
        import('../assets/selfie_segmenter.tflite?url'),
      ]);
      if (gen !== this.generation) return;

      const fileset = { wasmLoaderPath: loader.default, wasmBinaryPath: binary.default };
      const create = (delegate: 'GPU' | 'CPU') =>
        Segmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: model.default, delegate },
          runningMode: 'VIDEO',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });
      let segmenter: ImageSegmenter;
      try {
        segmenter = await create('GPU');
      } catch {
        if (gen !== this.generation) return;
        segmenter = await create('CPU');
      }
      if (gen !== this.generation) {
        segmenter.close();
        return;
      }
      this.segmenter = segmenter;
      this.setState('ready');
      this.raf = requestAnimationFrame(this.tick);
    } catch {
      if (gen !== this.generation) return;
      this.setState('failed');
    }
  }

  private tick = (): void => {
    if (this.state !== 'ready') return;
    this.raf = requestAnimationFrame(this.tick);
    const video = this.video;
    if (!video || video.readyState < 2 || video.videoWidth === 0) return;
    this.maybeInfer(video);
    this.compositeFrame(video);
  };

  /** Refresh the mask at inference rate on a downscaled frame. */
  private maybeInfer(video: HTMLVideoElement): void {
    const now = performance.now();
    if (now - this.lastInferenceAt < this.inferenceIntervalMs) return;
    if (video.currentTime === this.lastVideoTime) return;
    this.lastInferenceAt = now;
    this.lastVideoTime = video.currentTime;

    const iw = Math.min(INFER_WIDTH, video.videoWidth);
    const ih = Math.max(1, Math.round((iw * video.videoHeight) / video.videoWidth));
    if (this.inferCanvas.width !== iw || this.inferCanvas.height !== ih) {
      this.inferCanvas.width = iw;
      this.inferCanvas.height = ih;
    }
    this.inferCtx.drawImage(video, 0, 0, iw, ih);

    const t0 = performance.now();
    try {
      // The callback runs synchronously; the mask is only valid inside it.
      this.segmenter!.segmentForVideo(this.inferCanvas, now, (result) => {
        this.refreshMask(result, video);
      });
    } catch {
      this.dispose();
      this.setState('failed');
      return;
    }
    this.recordSample(performance.now() - t0);
  }

  private refreshMask(result: ImageSegmenterResult, video: HTMLVideoElement): void {
    const masks = result.confidenceMasks;
    const mask = masks?.[masks.length - 1];
    if (!mask) return;
    const data = mask.getAsFloat32Array();

    if (this.prevMask && this.prevMask.length === data.length) {
      const prev = this.prevMask;
      for (let i = 0; i < data.length; i++) {
        data[i] = data[i] * MASK_BLEND + prev[i] * (1 - MASK_BLEND);
      }
    } else {
      this.prevMask = new Float32Array(data.length);
    }
    // Reuse the blend buffer — a fresh ~65k-float allocation per inference
    // is steady GC pressure on low-RAM devices.
    this.prevMask.set(data);

    const mw = mask.width;
    const mh = mask.height;
    if (this.maskCanvas.width !== mw || this.maskCanvas.height !== mh || !this.maskImage) {
      this.maskCanvas.width = mw;
      this.maskCanvas.height = mh;
      this.maskImage = this.maskCtx.createImageData(mw, mh);
    }
    // Only alpha matters — destination-in keeps the destination's color.
    const px = this.maskImage.data;
    for (let i = 0; i < data.length; i++) {
      px[i * 4 + 3] = data[i] * 255;
    }
    this.maskCtx.putImageData(this.maskImage, 0, 0);

    // Upscale + feather once per inference so the per-frame composite is
    // two plain drawImages.
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (this.maskFull.width !== vw || this.maskFull.height !== vh) {
      this.maskFull.width = vw;
      this.maskFull.height = vh;
    }
    const full = this.maskFullCtx;
    full.clearRect(0, 0, vw, vh);
    full.save();
    full.filter = `blur(${this.featherPx}px)`;
    full.drawImage(this.maskCanvas, 0, 0, vw, vh);
    full.restore();
  }

  /** Every display frame: current video frame carved by the latest mask. */
  private compositeFrame(video: HTMLVideoElement): void {
    if (this.maskFull.width === 0) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (this.canvas.width !== vw || this.canvas.height !== vh) {
      this.canvas.width = vw;
      this.canvas.height = vh;
    }
    const ctx = this.ctx;
    // The video frame is opaque, so source-over restores full alpha before
    // the mask carves the new silhouette — no clear needed.
    ctx.drawImage(video, 0, 0, vw, vh);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    // Mid-resize the mask can be one video-size behind; stretching it for a
    // frame beats flashing the unmasked feed.
    ctx.drawImage(this.maskFull, 0, 0, vw, vh);
    ctx.restore();
  }

  private recordSample(ms: number): void {
    this.perfSeen += 1;
    if (this.perfSeen <= PERF_WARMUP) return;
    this.perfSamples.push(ms);
    if (this.perfSamples.length < PERF_WINDOW) return;
    const sorted = [...this.perfSamples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    this.perfSamples.length = 0;
    const budget = devBudgetOverrideMs ?? DEFAULT_BUDGET_MS;
    if (median > budget) {
      this.dispose();
      this.cb.onPerformanceFallback();
    }
  }
}
