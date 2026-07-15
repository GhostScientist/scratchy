/**
 * Person-segmentation engine behind the "cutout" camera shape. Wraps
 * MediaPipe's selfie segmenter (loaded lazily — wasm + model ship with the
 * app, no CDN) and maintains an RGBA canvas holding the current video frame
 * with the background removed. Consumers (the DOM preview and the recording
 * Compositor) only ever read that canvas; they never wait on inference.
 *
 * Inference runs at ~15 fps and the mask is composited immediately at that
 * rate — reusing a stale mask over newer video frames would ghost at the
 * edges, and at 15 fps the person moves little enough between masks.
 *
 * The engine watches its own cost: if the median inference+composite time
 * stays over budget, it reports a performance fallback so the app can leave
 * cutout mode. The record-time capability probe can't cover this — the
 * camera runs without recording — so the check lives here.
 */

import type { ImageSegmenter, ImageSegmenterResult } from '@mediapipe/tasks-vision';

export type CutoutState = 'idle' | 'loading' | 'ready' | 'failed' | 'unsupported';

export interface CutoutCallbacks {
  onState(state: CutoutState): void;
  /** Sustained over-budget inference — caller should revert to a framed shape. */
  onPerformanceFallback(): void;
}

/** ~15 fps inference; plenty for a talking head, cheap enough for tablets. */
const INFERENCE_INTERVAL_MS = 66;
/** Median inference+composite budget; sustained misses trigger the fallback. */
const DEFAULT_BUDGET_MS = 40;
/** Samples per watchdog window. */
const PERF_WINDOW = 30;
/** First inferences include wasm/GPU warmup — never judge them. */
const PERF_WARMUP = 5;
/** Temporal mask smoothing: new*0.7 + previous*0.3 kills edge flicker. */
const MASK_BLEND = 0.7;
/** Extra edge feather when stamping the mask, in destination pixels. */
const MASK_FEATHER_PX = 3;

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
  /** Video-sized RGBA frame with the background removed. 0×0 until ready. */
  readonly canvas: HTMLCanvasElement;

  private ctx: CanvasRenderingContext2D;
  private maskCanvas: HTMLCanvasElement;
  private maskCtx: CanvasRenderingContext2D;
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

  constructor(private cb: CutoutCallbacks) {
    this.canvas = document.createElement('canvas');
    this.maskCanvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d');
    const maskCtx = this.maskCanvas.getContext('2d');
    if (!ctx || !maskCtx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.maskCtx = maskCtx;
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
    const now = performance.now();
    if (now - this.lastInferenceAt < INFERENCE_INTERVAL_MS) return;
    if (video.currentTime === this.lastVideoTime) return;
    this.lastInferenceAt = now;
    this.lastVideoTime = video.currentTime;

    const t0 = performance.now();
    try {
      // The callback runs synchronously; the mask is only valid inside it.
      this.segmenter!.segmentForVideo(video, now, (result) => {
        this.composite(result, video);
      });
    } catch {
      this.dispose();
      this.setState('failed');
      return;
    }
    this.recordSample(performance.now() - t0);
  };

  private composite(result: ImageSegmenterResult, video: HTMLVideoElement): void {
    const masks = result.confidenceMasks;
    const mask = masks?.[masks.length - 1];
    if (!mask) return;
    const data = mask.getAsFloat32Array();

    if (this.prevMask && this.prevMask.length === data.length) {
      const prev = this.prevMask;
      for (let i = 0; i < data.length; i++) {
        data[i] = data[i] * MASK_BLEND + prev[i] * (1 - MASK_BLEND);
      }
    }
    this.prevMask = Float32Array.from(data);

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
    ctx.filter = `blur(${MASK_FEATHER_PX}px)`;
    ctx.drawImage(this.maskCanvas, 0, 0, vw, vh);
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
