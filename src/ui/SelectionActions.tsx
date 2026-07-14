import { useEffect, useState } from 'react';
import type { Viewport } from '../ink/Viewport';
import type { BBox } from '../lib/strokes';
import { clamp } from '../lib/geometry';
import { STAGE_WIDTH, STAGE_HEIGHT } from '../types';
import { LockIcon, UnlockIcon } from './icons';

interface SelectionActionsProps {
  viewport: Viewport;
  /** Selection bbox in world coordinates. */
  bbox: BBox;
  /** True when every selected image is locked (button offers Unlock). */
  locked: boolean;
  onToggleLock(): void;
}

/**
 * Floating action chip above the selection: lock/unlock for images.
 * DOM inside the stage (like TextEditorOverlay), so it is never recorded —
 * it lives outside the canvas layers the compositor reads.
 */
export function SelectionActions({ viewport, bbox, locked, onToggleLock }: SelectionActionsProps) {
  // Follow pans/zooms; coalesced to one reposition per frame.
  const [, setTick] = useState(0);
  useEffect(() => {
    let raf = 0;
    const unsubscribe = viewport.onChange(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setTick((t) => t + 1);
      });
    });
    return () => {
      unsubscribe();
      cancelAnimationFrame(raf);
    };
  }, [viewport]);

  const anchor = viewport.worldToStage({ x: (bbox.minX + bbox.maxX) / 2, y: bbox.minY });
  const left = clamp(anchor.x, 60, STAGE_WIDTH - 60);
  const top = clamp(anchor.y - 44, 8, STAGE_HEIGHT - 44);

  return (
    <div className="selection-actions" style={{ left, top }}>
      <button
        type="button"
        className="selection-action-btn"
        aria-label={locked ? 'Unlock image' : 'Lock image'}
        title={locked ? 'Unlock to allow moving and erasing' : 'Lock to pin it under your annotations'}
        onClick={onToggleLock}
      >
        {locked ? <UnlockIcon /> : <LockIcon />}
        {locked ? 'Unlock' : 'Lock'}
      </button>
    </div>
  );
}
