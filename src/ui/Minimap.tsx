import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { InkEngine } from '../ink/InkEngine';
import type { Viewport } from '../ink/Viewport';
import { elementBBox } from '../lib/elements';
import { BACKGROUNDS } from '../lib/backgrounds';
import type { BackgroundKind } from '../types';

const MAP_W = 192;
const MAP_H = 108;
const DPR = 2;
/** Cap polyline detail per stroke — the minimap is a sketch, not a render. */
const MAX_POINTS = 24;

interface MinimapProps {
  engine: InkEngine;
  viewport: Viewport;
  /** Mirror the board background so ink colors keep their contrast. */
  background: BackgroundKind;
  /** Bumped on every document commit so erased/undone ink disappears. */
  revision: number;
}

/** world → minimap px mapping for the current frame. */
interface MapTransform {
  scale: number;
  ox: number;
  oy: number;
}

/**
 * Corner overview of the whole board: all ink plus the current viewport
 * rectangle. Lives in DOM outside the stage, so it is never recorded.
 * Tap or drag to jump the viewport.
 */
export function Minimap({ engine, viewport, background, revision }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transformRef = useRef<MapTransform>({ scale: 1, ox: 0, oy: 0 });

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = BACKGROUNDS[background].base;
    ctx.fillRect(0, 0, MAP_W, MAP_H);

    const view = viewport.visibleWorldRect();
    const ink = engine.getInkBBox();
    const minX = Math.min(view.minX, ink?.minX ?? Infinity);
    const minY = Math.min(view.minY, ink?.minY ?? Infinity);
    const maxX = Math.max(view.maxX, ink?.maxX ?? -Infinity);
    const maxY = Math.max(view.maxY, ink?.maxY ?? -Infinity);
    const pad = Math.max(maxX - minX, maxY - minY) * 0.06;
    const w = maxX - minX + pad * 2;
    const h = maxY - minY + pad * 2;
    const scale = Math.min(MAP_W / w, MAP_H / h);
    const ox = (MAP_W - w * scale) / 2 - (minX - pad) * scale;
    const oy = (MAP_H - h * scale) / 2 - (minY - pad) * scale;
    transformRef.current = { scale, ox, oy };
    const mapX = (wx: number) => wx * scale + ox;
    const mapY = (wy: number) => wy * scale + oy;

    // Content as simplified marks: strokes become polylines, shapes and text
    // become bbox outlines — the minimap is a sketch, not a render.
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    for (const el of engine.getElements()) {
      const box = elementBBox(el);
      // Images carry no color of their own — sketch them in neutral gray.
      const color = el.kind === 'image' ? '#9aa0aa' : el.color;
      // Sub-pixel elements: a dot is cheaper and reads better.
      if ((box.maxX - box.minX) * scale < 1.5 && (box.maxY - box.minY) * scale < 1.5) {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(mapX(box.minX) - 0.75, mapY(box.minY) - 0.75, 1.5, 1.5);
        continue;
      }
      if (el.kind !== 'stroke') {
        ctx.strokeStyle = color;
        ctx.globalAlpha = ('opacity' in el ? el.opacity : 1) * 0.9;
        ctx.strokeRect(
          mapX(box.minX),
          mapY(box.minY),
          (box.maxX - box.minX) * scale,
          (box.maxY - box.minY) * scale,
        );
        continue;
      }
      const pts = el.points;
      ctx.strokeStyle = el.color;
      ctx.globalAlpha = el.opacity * 0.9;
      ctx.beginPath();
      const stride = Math.max(1, Math.floor(pts.length / MAX_POINTS));
      ctx.moveTo(mapX(pts[0].x), mapY(pts[0].y));
      for (let i = stride; i < pts.length; i += stride) {
        ctx.lineTo(mapX(pts[i].x), mapY(pts[i].y));
      }
      ctx.lineTo(mapX(pts[pts.length - 1].x), mapY(pts[pts.length - 1].y));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Viewport rectangle — focus blue reads on both light and dark boards.
    ctx.strokeStyle = '#6ea8ff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      mapX(view.minX),
      mapY(view.minY),
      (view.maxX - view.minX) * scale,
      (view.maxY - view.minY) * scale,
    );
  };
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        drawRef.current();
      });
    };
    const unsubscribe = viewport.onChange(schedule);
    schedule();
    return () => {
      unsubscribe();
      cancelAnimationFrame(raf);
    };
  }, [engine, viewport]);

  // Ink or board background changed.
  useEffect(() => {
    drawRef.current();
  }, [revision, background]);

  const jumpTo = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) * MAP_W) / rect.width;
    const my = ((e.clientY - rect.top) * MAP_H) / rect.height;
    const { scale, ox, oy } = transformRef.current;
    viewport.centerOn({ x: (mx - ox) / scale, y: (my - oy) / scale });
  };

  return (
    <canvas
      ref={canvasRef}
      className="minimap"
      width={MAP_W * DPR}
      height={MAP_H * DPR}
      role="button"
      aria-label="Board overview, tap to move the view"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        jumpTo(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) jumpTo(e);
      }}
    />
  );
}
