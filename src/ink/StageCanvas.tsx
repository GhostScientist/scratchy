import { useEffect, useRef } from 'react';
import { InkEngine } from './InkEngine';
import type { TextEditRequest } from './InkEngine';
import { Viewport } from './Viewport';
import { drawBackground } from '../lib/backgrounds';
import type { BackgroundKind, ShapeKind, StageSize, Tool } from '../types';

interface StageCanvasProps {
  background: BackgroundKind;
  tool: Tool;
  color: string;
  width: number;
  shapeKind: ShapeKind;
  /** Logical stage window (landscape or portrait). */
  stageSize: StageSize;
  /** DPR-aware backing-store multiplier for the display canvases. */
  backingScale: number;
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

  // Latest geometry without re-running the mount effect.
  const geometryRef = useRef({ stageSize: props.stageSize, backingScale: props.backingScale });
  geometryRef.current = { stageSize: props.stageSize, backingScale: props.backingScale };

  const redrawBackground = () => {
    const canvas = bgRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport) return;
    const ctx = canvas.getContext('2d')!;
    const stage = viewport.getStageSize();
    const bs = viewport.getDisplayScale();
    ctx.setTransform(bs, 0, 0, bs, 0, 0);
    drawBackground(ctx, bgKindRef.current, {
      ...viewport.get(),
      outW: stage.w,
      outH: stage.h,
    });
  };
  const redrawRef = useRef(redrawBackground);
  redrawRef.current = redrawBackground;

  useEffect(() => {
    const { stageSize, backingScale } = geometryRef.current;
    const bgCanvas = bgRef.current!;
    bgCanvas.width = Math.round(stageSize.w * backingScale);
    bgCanvas.height = Math.round(stageSize.h * backingScale);

    const viewport = new Viewport();
    viewport.setDisplayScale(backingScale);
    viewport.setStageSize(stageSize.w, stageSize.h);
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

  // Stage size / backing changed (rotation, DPR shift, recording floor):
  // update the viewport first (the ink cache rebuild reads it), then resize
  // every layer and repaint in the same effect so no blank frame is shown.
  useEffect(() => {
    const viewport = viewportRef.current;
    const engine = engineRef.current;
    const bgCanvas = bgRef.current;
    if (!viewport || !engine || !bgCanvas) return;
    const { w, h } = props.stageSize;
    const bs = props.backingScale;
    const current = viewport.getStageSize();
    if (current.w === w && current.h === h && viewport.getDisplayScale() === bs) {
      return; // Mount effect already built this geometry.
    }
    viewport.setDisplayScale(bs);
    viewport.setStageSize(w, h);
    bgCanvas.width = Math.round(w * bs);
    bgCanvas.height = Math.round(h * bs);
    engine.setStageGeometry(w, h, bs);
    redrawRef.current();
  }, [props.stageSize, props.backingScale]);

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
