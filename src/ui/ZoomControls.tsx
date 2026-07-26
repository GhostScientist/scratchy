import { useEffect, useState } from 'react';
import type { InkEngine } from '../ink/InkEngine';
import type { Viewport } from '../ink/Viewport';
import { FitIcon } from './icons';

/** Zoom anchor: the center of the current stage window. */
function stageCenter(viewport: Viewport) {
  const { w, h } = viewport.getStageSize();
  return { x: w / 2, y: h / 2 };
}

interface ZoomControlsProps {
  engine: InkEngine;
  viewport: Viewport;
  onEmptyFit(): void;
}

export function zoomToFit(engine: InkEngine, viewport: Viewport): boolean {
  const box = engine.getInkBBox();
  if (!box) return false;
  viewport.fitBBox(box, 60);
  return true;
}

export function ZoomControls({ engine, viewport, onEmptyFit }: ZoomControlsProps) {
  const [pct, setPct] = useState(() => Math.round(viewport.get().zoom * 100));

  useEffect(() => {
    // Trailing throttle: pan/pinch fires per pointer event; the readout only
    // needs ~8 Hz, and pan frames must stay free of React work.
    let timer = 0;
    let last = 0;
    const update = () => {
      last = performance.now();
      setPct(Math.round(viewport.get().zoom * 100));
    };
    const unsubscribe = viewport.onChange(() => {
      if (timer) return;
      const wait = Math.max(0, 120 - (performance.now() - last));
      timer = window.setTimeout(() => {
        timer = 0;
        update();
      }, wait);
    });
    update();
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, [viewport]);

  return (
    <div className="zoom-controls" role="group" aria-label="Zoom">
      <button
        type="button"
        className="zoom-btn"
        aria-label="Zoom out"
        title="Zoom out"
        onClick={() => viewport.zoomAt(stageCenter(viewport), 1 / 1.25)}
      >
        −
      </button>
      <button
        type="button"
        className="zoom-btn zoom-readout"
        aria-label="Reset zoom to 100% (0)"
        title="Reset zoom to 100% (0)"
        onClick={() => viewport.zoomAt(stageCenter(viewport), 1 / viewport.get().zoom)}
      >
        {pct}%
      </button>
      <button
        type="button"
        className="zoom-btn"
        aria-label="Zoom in"
        title="Zoom in"
        onClick={() => viewport.zoomAt(stageCenter(viewport), 1.25)}
      >
        +
      </button>
      <button
        type="button"
        className="zoom-btn"
        aria-label="Zoom to fit all ink (1)"
        title="Zoom to fit all ink (1)"
        onClick={() => {
          if (!zoomToFit(engine, viewport)) onEmptyFit();
        }}
      >
        <FitIcon />
      </button>
    </div>
  );
}
