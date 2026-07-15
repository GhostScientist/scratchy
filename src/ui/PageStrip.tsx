import { useEffect, useRef, useState } from 'react';
import type { InkEngine } from '../ink/InkEngine';
import { drawElement, elementBBox, elementVisualPad } from '../lib/elements';
import { onImageCacheChange } from '../lib/imageCache';
import { BACKGROUNDS } from '../lib/backgrounds';
import { STAGE_WIDTH, STAGE_HEIGHT } from '../types';
import type { BackgroundKind, BoardElement, BoardPage } from '../types';
import { DuplicateIcon, PlusIcon, TrashIcon } from './icons';

const THUMB_W = 96;
const THUMB_H = 54;
const DPR = 2;
/** Trailing delay for live-ink thumbnail refreshes — drawing stays smooth. */
const REDRAW_DELAY_MS = 300;

interface PageStripProps {
  /** Read through a getter — the pages array lives in a ref, not state. */
  getPages(): readonly BoardPage[];
  activeIndex: number;
  /** Bumped on any page structure change (add/delete/reorder/open). */
  revision: number;
  /** Bumped on every ink commit — refreshes the active thumbnail. */
  inkRevision: number;
  engine: InkEngine;
  background: BackgroundKind;
  onOpen(index: number): void;
  onAdd(): void;
  onDuplicate(index: number): void;
  onDelete(index: number): void;
  onMove(index: number, dir: -1 | 1): void;
}

/** Sketch a page into a thumbnail canvas: content fitted, or the stage rect
 *  for an empty page. Uses the shared element renderer, so images and shapes
 *  look like themselves. */
function renderThumb(
  canvas: HTMLCanvasElement,
  elements: readonly BoardElement[],
  background: BackgroundKind,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = BACKGROUNDS[background].base;
  ctx.fillRect(0, 0, THUMB_W, THUMB_H);

  let box: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  for (const el of elements) {
    const b = elementBBox(el);
    const pad = elementVisualPad(el);
    if (!box) {
      box = { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
    } else {
      box.minX = Math.min(box.minX, b.minX - pad);
      box.minY = Math.min(box.minY, b.minY - pad);
      box.maxX = Math.max(box.maxX, b.maxX + pad);
      box.maxY = Math.max(box.maxY, b.maxY + pad);
    }
  }
  if (!box) box = { minX: 0, minY: 0, maxX: STAGE_WIDTH, maxY: STAGE_HEIGHT };
  const pad = Math.max(box.maxX - box.minX, box.maxY - box.minY) * 0.06 + 1;
  const w = box.maxX - box.minX + pad * 2;
  const h = box.maxY - box.minY + pad * 2;
  const scale = Math.min(THUMB_W / w, THUMB_H / h);
  const ox = (THUMB_W - w * scale) / 2 - (box.minX - pad) * scale;
  const oy = (THUMB_H - h * scale) / 2 - (box.minY - pad) * scale;
  ctx.setTransform(DPR * scale, 0, 0, DPR * scale, DPR * ox, DPR * oy);
  for (const el of elements) drawElement(ctx, el, true);
}

/**
 * Bottom slide strip: one thumbnail per page, tap to open, plus
 * add/duplicate/reorder/delete for the active page. Lives in DOM outside the
 * stage, so it is never recorded (same as the minimap).
 */
export function PageStrip(props: PageStripProps) {
  const { getPages, activeIndex, revision, inkRevision, engine, background } = props;
  const pages = getPages();
  const canvases = useRef(new Map<string, HTMLCanvasElement>());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const drawAll = () => {
    for (const [index, page] of getPages().entries()) {
      const canvas = canvases.current.get(page.id);
      if (!canvas) continue;
      // The active page's stored elements go stale between autosaves —
      // read them live from the engine instead.
      const elements = index === activeIndex ? engine.getElements() : page.elements;
      renderThumb(canvas, elements, background);
    }
  };
  const drawAllRef = useRef(drawAll);
  drawAllRef.current = drawAll;

  // Structure or board changed: redraw immediately.
  useEffect(() => {
    drawAllRef.current();
  }, [revision, background, activeIndex]);

  // Live ink: refresh the active thumbnail on a trailing delay.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const page = getPages()[activeIndex];
      const canvas = page && canvases.current.get(page.id);
      if (canvas) renderThumb(canvas, engine.getElements(), background);
    }, REDRAW_DELAY_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inkRevision]);

  // Image assets decode async — thumbnails self-heal once pixels arrive.
  useEffect(() => {
    let timer = 0;
    const unsubscribe = onImageCacheChange(() => {
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        drawAllRef.current();
      }, REDRAW_DELAY_MS);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (confirmDelete === null) return;
    const timer = window.setTimeout(() => setConfirmDelete(null), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmDelete]);

  const active = activeIndex;
  const activeId = pages[active]?.id ?? null;

  return (
    <div className="page-strip" aria-label="Pages">
      <div className="page-strip-scroll" role="tablist" aria-label="Page thumbnails">
        {pages.map((page, i) => (
          <div key={page.id} className={`page-thumb${i === active ? ' active' : ''}`}>
            <button
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={`Page ${i + 1} of ${pages.length}`}
              className="page-thumb-btn"
              onClick={() => {
                setConfirmDelete(null);
                props.onOpen(i);
              }}
            >
              <canvas
                width={THUMB_W * DPR}
                height={THUMB_H * DPR}
                ref={(el) => {
                  if (el) {
                    canvases.current.set(page.id, el);
                    const elements = i === active ? engine.getElements() : page.elements;
                    renderThumb(el, elements, background);
                  } else {
                    canvases.current.delete(page.id);
                  }
                }}
              />
              <span className="page-num" aria-hidden="true">
                {i + 1}
              </span>
            </button>
          </div>
        ))}
      </div>
      {/* Actions apply to the active page; they sit outside the scroller so
          they are never clipped by it. */}
      <div className="page-actions" role="group" aria-label="Page actions">
        <button
          type="button"
          className="page-action"
          aria-label="Move page left"
          title="Move page left"
          disabled={active === 0}
          onClick={() => props.onMove(active, -1)}
        >
          ‹
        </button>
        <button
          type="button"
          className="page-action"
          aria-label="Duplicate page"
          title="Duplicate page"
          onClick={() => props.onDuplicate(active)}
        >
          <DuplicateIcon />
        </button>
        {confirmDelete !== null && confirmDelete === activeId ? (
          <button
            type="button"
            className="page-action danger"
            aria-label="Confirm delete page"
            onClick={() => {
              setConfirmDelete(null);
              props.onDelete(active);
            }}
          >
            Delete?
          </button>
        ) : (
          <button
            type="button"
            className="page-action"
            aria-label="Delete page"
            title="Delete page"
            onClick={() => setConfirmDelete(activeId)}
          >
            <TrashIcon />
          </button>
        )}
        <button
          type="button"
          className="page-action"
          aria-label="Move page right"
          title="Move page right"
          disabled={active === pages.length - 1}
          onClick={() => props.onMove(active, 1)}
        >
          ›
        </button>
        <button
          type="button"
          className="page-add"
          aria-label="Add page (Page Down to flip)"
          title="Add page"
          onClick={props.onAdd}
        >
          <PlusIcon />
        </button>
      </div>
    </div>
  );
}
