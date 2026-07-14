import { useEffect, useRef } from 'react';
import { InkEngine } from './InkEngine';
import { drawBackground } from '../lib/backgrounds';
import { STAGE_WIDTH, STAGE_HEIGHT, BACKING_SCALE } from '../types';
import type { BackgroundKind, Tool } from '../types';

interface StageCanvasProps {
  background: BackgroundKind;
  tool: Tool;
  color: string;
  width: number;
  onReady(engine: InkEngine): void;
  onHistoryChange(canUndo: boolean, canRedo: boolean): void;
  onCommit(): void;
}

export function StageCanvas(props: StageCanvasProps) {
  const bgRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<InkEngine | null>(null);

  // Latest callbacks without re-creating the engine.
  const cbRef = useRef({
    onReady: props.onReady,
    onHistoryChange: props.onHistoryChange,
    onCommit: props.onCommit,
  });
  cbRef.current = {
    onReady: props.onReady,
    onHistoryChange: props.onHistoryChange,
    onCommit: props.onCommit,
  };

  useEffect(() => {
    const engine = new InkEngine(inkRef.current!, activeRef.current!, {
      onHistoryChange: (u, r) => cbRef.current.onHistoryChange(u, r),
      onCommit: () => cbRef.current.onCommit(),
    });
    engineRef.current = engine;
    cbRef.current.onReady(engine);
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setBrush(props.tool, props.color, props.width);
  }, [props.tool, props.color, props.width]);

  useEffect(() => {
    const canvas = bgRef.current!;
    canvas.width = STAGE_WIDTH * BACKING_SCALE;
    canvas.height = STAGE_HEIGHT * BACKING_SCALE;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(BACKING_SCALE, 0, 0, BACKING_SCALE, 0, 0);
    drawBackground(ctx, props.background);
  }, [props.background]);

  return (
    <>
      <canvas ref={bgRef} className="stage-layer" aria-hidden="true" />
      <canvas ref={inkRef} className="stage-layer" aria-hidden="true" />
      <canvas ref={activeRef} className="stage-layer stage-input" aria-label="Lesson drawing surface" />
    </>
  );
}
