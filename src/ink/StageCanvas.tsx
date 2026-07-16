import { useEffect, useRef } from 'react';
import { InkEngine } from './InkEngine';
import type { TextEditRequest } from './InkEngine';
import { Viewport } from './Viewport';
import { drawBackground } from '../lib/backgrounds';
import { STAGE_WIDTH, STAGE_HEIGHT, BACKING_SCALE } from '../types';
import type { BackgroundKind, ShapeKind, Tool } from '../types';

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

  const redrawBackground = () => {
    const canvas = bgRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport) return;
    // Opaque layer (drawBackground always lays a base fill) — lets the
    // browser skip alpha blending when compositing the stage stack.
    const ctx = canvas.getContext('2d', { alpha: false })!;
    ctx.setTransform(BACKING_SCALE, 0, 0, BACKING_SCALE, 0, 0);
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
    bgCanvas.width = STAGE_WIDTH * BACKING_SCALE;
    bgCanvas.height = STAGE_HEIGHT * BACKING_SCALE;

    const viewport = new Viewport();
    const engine = new InkEngine(inkRef.current!, activeRef.current!, viewport, {
      onHistoryChange: (u, r) => cbRef.current.onHistoryChange(u, r),
      onCommit: () => cbRef.current.onCommit(),
      onTextEdit: (req) => cbRef.current.onTextEdit(req),
      onSelectionChange: () => cbRef.current.onSelectionChange(),
    });
    engineRef.current = engine;
    viewportRef.current = viewport;

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
