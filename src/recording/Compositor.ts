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
  /** Stroke or shape currently being drawn; null between gestures. */
  getActiveElement(): BoardElement | null;
  /** Current view onto the infinite world — the recording follows it. */
  getViewport(): ViewportState;
  /** Fading laser-pointer trail; empty when the laser is idle. */
  getLaserTrail(): readonly LaserPoint[];
  /** null when the camera is off or hidden */
  getVideo(): HTMLVideoElement | null;
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
    this.draw();
    // Belt and braces: some engines only emit captureStream frames when the
    // canvas is painted; requestFrame forces delivery even for a static board.
    if (this.track && 'requestFrame' in this.track) {
      (this.track as CanvasCaptureMediaStreamTrack).requestFrame();
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
      ctx.save();
      ctx.clip(cameraClipPath(layout));
      const { sx, sy, sw, sh } = coverCrop(
        video.videoWidth,
        video.videoHeight,
        layout.width,
        layout.height,
      );
      if (layout.mirrored) {
        ctx.translate(layout.x + layout.width, layout.y);
        ctx.scale(-1, 1);
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, layout.width, layout.height);
      } else {
        ctx.drawImage(video, sx, sy, sw, sh, layout.x, layout.y, layout.width, layout.height);
      }
      ctx.restore();
    }
  }
}
