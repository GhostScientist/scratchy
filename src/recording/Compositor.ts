import { drawBackground } from '../lib/backgrounds';
import { drawElement } from '../lib/elements';
import { drawLaserTrail } from '../lib/laser';
import type { LaserPoint } from '../lib/laser';
import { coverCrop, cameraClipPath } from '../lib/geometry';
import { BACKING_SCALE } from '../types';
import type { BackgroundKind, BoardElement, CameraLayout, ViewportState } from '../types';
import { effectiveView, outputCrop } from './presets';
import type { OutputCrop, RecordingPreset } from './presets';

export interface CompositorSources {
  getBackground(): BackgroundKind;
  getInkCanvas(): HTMLCanvasElement | null;
  /** Engine frame counter; unchanged = committed ink and viewport are static. */
  getInkRevision(): number;
  /** Stroke or shape currently being drawn; null between gestures. */
  getActiveElement(): BoardElement | null;
  /** Current view onto the infinite world — the recording follows it. */
  getViewport(): ViewportState;
  /** Fading laser-pointer trail; empty when the laser is idle. */
  getLaserTrail(): readonly LaserPoint[];
  /** null when the camera is off or hidden */
  getVideo(): HTMLVideoElement | null;
  /** Background-removed camera frame; null unless the cutout shape is live. */
  getCutoutCanvas(): HTMLCanvasElement | null;
  getCameraLayout(): CameraLayout;
}

/**
 * Draws every output frame into a dedicated canvas sized by the recording
 * preset — the authoritative visual source for the recorded video. Non-16:9
 * presets render the centered stage crop; all world-space drawing reuses the
 * display renderers through an "effective viewport" (see presets.ts). Runs
 * its own rAF loop only while a recording (or countdown) is in progress.
 */
export class Compositor {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private running = false;
  private track: MediaStreamTrack | null = null;
  private crop: OutputCrop;
  private lastRevision = -1;
  private lastBackground: BackgroundKind | null = null;
  private lastPush = 0;

  constructor(
    private sources: CompositorSources,
    private preset: RecordingPreset,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = preset.width;
    this.canvas.height = preset.height;
    this.crop = outputCrop(preset);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.frame();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.track = null;
  }

  captureStream(fps: number): MediaStream {
    const stream = this.canvas.captureStream(fps);
    this.track = stream.getVideoTracks()[0] ?? null;
    return stream;
  }

  private frame = (): void => {
    if (!this.running) return;
    // A mostly-static board is the common case while the presenter talks —
    // skip the full re-composite unless something visible changed. Live
    // camera/cutout frames and the fading laser advance on their own clock,
    // so any of them forces a draw; committed ink + viewport changes are
    // covered by the engine's frame revision, the background by identity.
    const revision = this.sources.getInkRevision();
    const background = this.sources.getBackground();
    const dirty =
      this.sources.getVideo() !== null ||
      this.sources.getActiveElement() !== null ||
      this.sources.getLaserTrail().length > 0 ||
      revision !== this.lastRevision ||
      background !== this.lastBackground;
    if (dirty) {
      this.draw();
      this.lastRevision = revision;
      this.lastBackground = background;
    }
    // Belt and braces: some engines only emit captureStream frames when the
    // canvas is painted; requestFrame forces delivery even for a static board.
    // While static, a 1 Hz keepalive re-pushes the unchanged canvas so the
    // encoder never starves.
    const now = performance.now();
    if (this.track && 'requestFrame' in this.track && (dirty || now - this.lastPush >= 1000)) {
      (this.track as CanvasCaptureMediaStreamTrack).requestFrame();
      this.lastPush = now;
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private draw(): void {
    const ctx = this.ctx;
    const { width: outW, height: outH } = this.preset;
    const crop = this.crop;
    const view = this.sources.getViewport();
    const eff = effectiveView(view, this.preset);

    drawBackground(ctx, this.sources.getBackground(), { ...eff, outW, outH });

    // The ink cache always holds the current viewport's view at 2×, so a
    // source-rect blit of the crop keeps the recording glued to the viewport
    // (a clean downscale for 1080p, a mild upscale for vertical). It is
    // rebuilt on the engine's rAF, so a frame sampled mid-pan can be one
    // frame stale relative to the active stroke — invisible at 30 fps.
    const ink = this.sources.getInkCanvas();
    if (ink) {
      ctx.drawImage(
        ink,
        crop.x * BACKING_SCALE,
        crop.y * BACKING_SCALE,
        crop.w * BACKING_SCALE,
        crop.h * BACKING_SCALE,
        0,
        0,
        outW,
        outH,
      );
    }

    const active = this.sources.getActiveElement();
    if (active) {
      ctx.save();
      ctx.setTransform(eff.zoom, 0, 0, eff.zoom, -eff.x * eff.zoom, -eff.y * eff.zoom);
      drawElement(ctx, active);
      ctx.restore();
    }

    const laser = this.sources.getLaserTrail();
    if (laser.length > 0) drawLaserTrail(ctx, laser, eff, performance.now());

    const video = this.sources.getVideo();
    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      // Camera layout is stage-anchored: map it through the crop.
      const src = this.sources.getCameraLayout();
      const layout: CameraLayout = {
        ...src,
        x: (src.x - crop.x) * crop.scale,
        y: (src.y - crop.y) * crop.scale,
        width: src.width * crop.scale,
        height: src.height * crop.scale,
      };
      // Cutout mode draws the background-removed canvas unclipped — the
      // alpha channel is the mask. Before the first segmented frame lands
      // (canvas still 0×0) fall back to the raw video in a plain rect,
      // matching the DOM preview; the recording never waits on inference.
      const cutout = src.shape === 'cutout' ? this.sources.getCutoutCanvas() : null;
      const frame = cutout && cutout.width > 0 && cutout.height > 0 ? cutout : video;
      const frameW = frame === video ? video.videoWidth : cutout!.width;
      const frameH = frame === video ? video.videoHeight : cutout!.height;
      ctx.save();
      if (frame === video) ctx.clip(cameraClipPath(layout));
      const { sx, sy, sw, sh } = coverCrop(frameW, frameH, layout.width, layout.height);
      if (layout.mirrored) {
        ctx.translate(layout.x + layout.width, layout.y);
        ctx.scale(-1, 1);
        ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, layout.width, layout.height);
      } else {
        ctx.drawImage(frame, sx, sy, sw, sh, layout.x, layout.y, layout.width, layout.height);
      }
      ctx.restore();
    }
  }
}
