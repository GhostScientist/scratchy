import { drawBackground } from '../lib/backgrounds';
import { drawStroke } from '../lib/strokes';
import { coverCrop, cameraClipPath } from '../lib/geometry';
import { STAGE_WIDTH, STAGE_HEIGHT } from '../types';
import type { BackgroundKind, CameraLayout, Stroke } from '../types';

export interface CompositorSources {
  getBackground(): BackgroundKind;
  getInkCanvas(): HTMLCanvasElement | null;
  getActiveStroke(): Stroke | null;
  /** null when the camera is off or hidden */
  getVideo(): HTMLVideoElement | null;
  getCameraLayout(): CameraLayout;
}

/**
 * Draws every output frame into a dedicated 1280×720 canvas — the
 * authoritative visual source for the recorded video. Runs its own rAF loop
 * only while a recording (or countdown) is in progress.
 */
export class Compositor {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private running = false;
  private track: MediaStreamTrack | null = null;

  constructor(private sources: CompositorSources) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = STAGE_WIDTH;
    this.canvas.height = STAGE_HEIGHT;
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
    drawBackground(ctx, this.sources.getBackground());

    const ink = this.sources.getInkCanvas();
    if (ink) ctx.drawImage(ink, 0, 0, STAGE_WIDTH, STAGE_HEIGHT);

    const active = this.sources.getActiveStroke();
    if (active) drawStroke(ctx, active);

    const video = this.sources.getVideo();
    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      const layout = this.sources.getCameraLayout();
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
