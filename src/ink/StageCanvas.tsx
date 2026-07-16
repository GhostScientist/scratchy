import { useEffect, useRef } from 'react';
import { InkEngine } from './InkEngine';
import type { TextEditRequest } from './InkEngine';
import { Viewport } from './Viewport';
import { drawBackground } from '../lib/backgrounds';
import { detectPerfTier } from '../capability/tier';
import { STAGE_WIDTH, STAGE_HEIGHT, BACKING_SCALE } from '../types';
import type { BackgroundKind, ShapeKind, Tool } from '../types';

/**
 * Backing-store multiplier for the stage layers: enough device pixels to be
 * crisp at the stage's actual on-screen size, never more than BACKING_SCALE.
 * A 1×-DPR budget tablet gets ~1× buffers (4× fewer pixels per frame than the
 * old fixed 2×); a hi-dpr or large desktop stage still gets its full 2×.
 * Quantized to 0.25 steps so resize jitter doesn't thrash canvas reallocation.
 */
function computeBackingScale(canvas: HTMLCanvasElement): number {
  const cssWidth = canvas.getBoundingClientRect().width || STAGE_WIDTH;
  const raw = (window.devicePixelRatio || 1) * (cssWidth / STAGE_WIDTH);
  const cap = detectPerfTier() === 'low' ? 1.5 : BACKING_SCALE;
  const quantized = Math.round(raw * 4) / 4;
  return Math.min(cap, Math.max(1, quantized));
}

interface StageCanvasProps {
  background: BackgroundKind;
  tool: Tool;
  color: string;
  width: number;
  shapeKind: ShapeKind;
  onReady(engine: InkEngine, viewport: Viewport): void;
  onHistoryChange(canUndo: boolean, canRedo: boolean): void;
  onCommit(): void;
  onTextEdit(request: TextEditRequest): void;
  onSelectionChange(): void;
}

export function StageCanvas(props: StageCanvasProps) {
  const bgRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<InkEngine | null>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const bgKindRef = useRef(props.background);

  // Latest callbacks without re-creating the engine.
  const cbRef = useRef({
    onReady: props.onReady,
    onHistoryChange: props.onHistoryChange,
    onCommit: props.onCommit,
    onTextEdit: props.onTextEdit,
    onSelectionChange: props.onSelectionChange,
  });
  cbRef.current = {
    onReady: props.onReady,
    onHistoryChange: props.onHistoryChange,
    onCommit: props.onCommit,
    onTextEdit: props.onTextEdit,
    onSelectionChange: props.onSelectionChange,
  };

  const backingRef = useRef(BACKING_SCALE);

  const redrawBackground = () => {
    const canvas = bgRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport) return;
    // Opaque layer (drawBackground always lays a base fill) — lets the
    // browser skip alpha blending when compositing the stage stack.
    const ctx = canvas.getContext('2d', { alpha: false })!;
    const backing = backingRef.current;
    ctx.setTransform(backing, 0, 0, backing, 0, 0);
    drawBackground(ctx, bgKindRef.current, {
      ...viewport.get(),
      outW: STAGE_WIDTH,
      outH: STAGE_HEIGHT,
    });
  };
  const redrawRef = useRef(redrawBackground);
  redrawRef.current = redrawBackground;

  useEffect(() => {
    const bgCanvas = bgRef.current!;
    backingRef.current = computeBackingScale(bgCanvas);
    bgCanvas.width = STAGE_WIDTH * backingRef.current;
    bgCanvas.height = STAGE_HEIGHT * backingRef.current;

    const viewport = new Viewport();
    const engine = new InkEngine(
      inkRef.current!,
      activeRef.current!,
      viewport,
      {
        onHistoryChange: (u, r) => cbRef.current.onHistoryChange(u, r),
        onCommit: () => cbRef.current.onCommit(),
        onTextEdit: (req) => cbRef.current.onTextEdit(req),
        onSelectionChange: () => cbRef.current.onSelectionChange(),
      },
      backingRef.current,
    );
    engineRef.current = engine;
    viewportRef.current = viewport;

    // Rotation / window resize changes the stage's on-screen size — follow
    // it (debounced; the engine defers the change if a recording is live).
    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        const next = computeBackingScale(bgCanvas);
        if (next === backingRef.current) return;
        backingRef.current = next;
        bgCanvas.width = STAGE_WIDTH * next;
        bgCanvas.height = STAGE_HEIGHT * next;
        engine.setBackingScale(next);
        redrawRef.current();
      }, 300);
    };
    window.addEventListener('resize', onResize);

    // Background scrolls with the world; coalesce pan/pinch bursts into one
    // redraw per frame.
    let bgRaf = 0;
    const unsubscribe = viewport.onChange(() => {
      if (bgRaf) return;
      bgRaf = requestAnimationFrame(() => {
        bgRaf = 0;
        redrawRef.current();
      });
    });
    redrawRef.current();

    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__scratchy = { engine, viewport };
    }

    cbRef.current.onReady(engine, viewport);
    return () => {
      unsubscribe();
      cancelAnimationFrame(bgRaf);
      window.removeEventListener('resize', onResize);
      window.clearTimeout(resizeTimer);
      engine.destroy();
      engineRef.current = null;
      viewportRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setBrush(props.tool, props.color, props.width);
  }, [props.tool, props.color, props.width]);

  useEffect(() => {
    engineRef.current?.setShapeKind(props.shapeKind);
  }, [props.shapeKind]);

  useEffect(() => {
    bgKindRef.current = props.background;
    redrawRef.current();
  }, [props.background]);

  return (
    <>
      <canvas ref={bgRef} className="stage-layer" aria-hidden="true" />
      <canvas ref={inkRef} className="stage-layer" aria-hidden="true" />
      <canvas ref={activeRef} className="stage-layer stage-input" aria-label="Lesson drawing surface" />
    </>
  );
}
