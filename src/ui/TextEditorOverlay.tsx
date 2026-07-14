import { useEffect, useRef } from 'react';
import type { TextEditRequest } from '../ink/InkEngine';
import type { Viewport } from '../ink/Viewport';
import { TEXT_LINE_HEIGHT } from '../lib/elements';

interface TextEditorOverlayProps {
  request: TextEditRequest;
  viewport: Viewport;
  /** Used for NEW text; an existing element keeps its own color/size. */
  color: string;
  fontSize: number;
  onCommit(text: string): void;
  onCancel(): void;
}

/**
 * DOM text editing over the canvas: a positioned textarea inside the stage.
 * Editing is DOM, rendering is canvas — commit on blur or Cmd/Ctrl+Enter,
 * cancel on Escape. Positioned once when it opens; the board can't pan while
 * a textarea holds focus.
 */
export function TextEditorOverlay(props: TextEditorOverlayProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { request, viewport } = props;
  const existing = request.element;
  const world = existing ? { x: existing.x, y: existing.y } : request.world;
  const zoom = viewport.get().zoom;
  const stage = viewport.worldToStage(world);
  const fontSize = (existing?.fontSize ?? props.fontSize) * zoom;
  const color = existing?.color ?? props.color;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = existing?.text ?? '';
    el.focus();
    el.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The drawing surface calls preventDefault() on pointerdown, which blocks
  // the native focus change (and therefore blur) — commit on any outside
  // pointerdown ourselves, like the menu flyouts do. The host guards against
  // the blur that may still follow.
  const commitRef = useRef(props.onCommit);
  commitRef.current = props.onCommit;
  useEffect(() => {
    const onOutside = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        commitRef.current(ref.current.value);
      }
    };
    document.addEventListener('pointerdown', onOutside, true);
    return () => document.removeEventListener('pointerdown', onOutside, true);
  }, []);

  const autosize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.width = '0';
    el.style.height = '0';
    el.style.width = `${Math.max(el.scrollWidth + 8, 40)}px`;
    el.style.height = `${Math.max(el.scrollHeight, fontSize * TEXT_LINE_HEIGHT)}px`;
  };
  useEffect(autosize);

  return (
    <textarea
      ref={ref}
      className="text-editor"
      aria-label="Text element editor"
      spellCheck={false}
      style={{
        left: stage.x,
        top: stage.y,
        fontSize,
        lineHeight: TEXT_LINE_HEIGHT,
        color,
      }}
      onInput={autosize}
      onBlur={(e) => props.onCommit(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          props.onCancel();
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          props.onCommit(e.currentTarget.value);
        }
      }}
    />
  );
}
