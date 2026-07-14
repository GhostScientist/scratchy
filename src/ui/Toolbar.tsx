import { useEffect, useRef, useState } from 'react';
import { BACKGROUNDS, BACKGROUND_KINDS } from '../lib/backgrounds';
import type { BackgroundKind, ShapeKind, Tool } from '../types';
import {
  PenIcon,
  HighlighterIcon,
  EraserIcon,
  HandIcon,
  LaserIcon,
  TextIcon,
  SelectIcon,
  ShapeRectToolIcon,
  ShapeEllipseToolIcon,
  ShapeLineToolIcon,
  ShapeArrowToolIcon,
  UndoIcon,
  RedoIcon,
  TrashIcon,
  ChevronLeftIcon,
} from './icons';

export const INK_COLORS = ['#1d1f24', '#e5484d', '#3b82f6', '#30a46c', '#f5a524', '#ffffff'];
export const INK_WIDTHS = [2, 4, 7, 12];

interface ToolbarProps {
  tool: Tool;
  color: string;
  width: number;
  background: BackgroundKind;
  shapeKind: ShapeKind;
  canUndo: boolean;
  canRedo: boolean;
  collapsed: boolean;
  onTool(tool: Tool): void;
  onColor(color: string): void;
  onWidth(width: number): void;
  onBackground(kind: BackgroundKind): void;
  onShapeKind(kind: ShapeKind): void;
  onUndo(): void;
  onRedo(): void;
  onClear(): void;
  onCollapsed(collapsed: boolean): void;
}

type Flyout = 'color' | 'width' | 'background' | 'shape' | null;

const TOOLS: { tool: Tool; label: string; keyHint: string; Icon: typeof PenIcon }[] = [
  { tool: 'pen', label: 'Pen', keyHint: 'P', Icon: PenIcon },
  { tool: 'highlighter', label: 'Highlighter', keyHint: 'H', Icon: HighlighterIcon },
  { tool: 'eraser', label: 'Eraser', keyHint: 'E', Icon: EraserIcon },
];

const TOOLS_AFTER_SHAPE: { tool: Tool; label: string; keyHint: string; Icon: typeof PenIcon }[] = [
  { tool: 'text', label: 'Text', keyHint: 'T', Icon: TextIcon },
  { tool: 'select', label: 'Select', keyHint: 'S', Icon: SelectIcon },
  { tool: 'laser', label: 'Laser pointer', keyHint: 'L', Icon: LaserIcon },
  { tool: 'hand', label: 'Move around', keyHint: 'V', Icon: HandIcon },
];

const SHAPE_KINDS: { kind: ShapeKind; label: string; Icon: typeof PenIcon }[] = [
  { kind: 'rect', label: 'Rectangle', Icon: ShapeRectToolIcon },
  { kind: 'ellipse', label: 'Ellipse', Icon: ShapeEllipseToolIcon },
  { kind: 'line', label: 'Line', Icon: ShapeLineToolIcon },
  { kind: 'arrow', label: 'Arrow', Icon: ShapeArrowToolIcon },
];

function shapeIconFor(kind: ShapeKind) {
  return (SHAPE_KINDS.find((s) => s.kind === kind) ?? SHAPE_KINDS[0]).Icon;
}

export function Toolbar(props: ToolbarProps) {
  const [flyout, setFlyout] = useState<Flyout>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!flyout) return;
    const onOutside = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setFlyout(null);
    };
    document.addEventListener('pointerdown', onOutside, true);
    return () => document.removeEventListener('pointerdown', onOutside, true);
  }, [flyout]);

  useEffect(() => {
    if (props.collapsed) setFlyout(null);
  }, [props.collapsed]);

  const toggleFlyout = (which: Exclude<Flyout, null>) =>
    setFlyout((f) => (f === which ? null : which));

  if (props.collapsed) {
    const ActiveIcon =
      props.tool === 'shape'
        ? shapeIconFor(props.shapeKind)
        : ([...TOOLS, ...TOOLS_AFTER_SHAPE].find((t) => t.tool === props.tool)?.Icon ?? PenIcon);
    return (
      <button
        type="button"
        className="rail-handle"
        onClick={() => props.onCollapsed(false)}
        aria-label="Show tools"
        title="Show tools"
      >
        <ActiveIcon />
        <span className="rail-handle-dot" style={{ background: props.color }} />
      </button>
    );
  }

  return (
    <div className="rail" ref={rootRef} role="toolbar" aria-label="Drawing tools">
      {TOOLS.map(({ tool, label, keyHint, Icon }) => (
        <button
          key={tool}
          type="button"
          className={`rail-btn${props.tool === tool ? ' active' : ''}`}
          aria-label={`${label} (${keyHint})`}
          aria-pressed={props.tool === tool}
          title={`${label} (${keyHint})`}
          onClick={() => props.onTool(tool)}
        >
          <Icon />
        </button>
      ))}

      <div className="rail-slot">
        {(() => {
          const ShapeIcon = shapeIconFor(props.shapeKind);
          return (
            <button
              type="button"
              className={`rail-btn${props.tool === 'shape' ? ' active' : ''}`}
              aria-label="Shapes (R)"
              aria-pressed={props.tool === 'shape'}
              aria-expanded={flyout === 'shape'}
              title="Shapes (R) — tap again for shape kinds"
              onClick={() => {
                if (props.tool === 'shape') toggleFlyout('shape');
                else props.onTool('shape');
              }}
            >
              <ShapeIcon />
            </button>
          );
        })()}
        {flyout === 'shape' && (
          <div className="flyout" role="menu" aria-label="Shape kinds">
            {SHAPE_KINDS.map(({ kind, label, Icon }) => (
              <button
                key={kind}
                type="button"
                className={`shape-btn${props.shapeKind === kind ? ' active' : ''}`}
                aria-label={label}
                title={label}
                onClick={() => {
                  props.onShapeKind(kind);
                  setFlyout(null);
                }}
              >
                <Icon />
              </button>
            ))}
          </div>
        )}
      </div>

      {TOOLS_AFTER_SHAPE.map(({ tool, label, keyHint, Icon }) => (
        <button
          key={tool}
          type="button"
          className={`rail-btn${props.tool === tool ? ' active' : ''}`}
          aria-label={`${label} (${keyHint})`}
          aria-pressed={props.tool === tool}
          title={`${label} (${keyHint})`}
          onClick={() => props.onTool(tool)}
        >
          <Icon />
        </button>
      ))}

      <div className="rail-sep" />

      <div className="rail-slot">
        <button
          type="button"
          className={`rail-btn${flyout === 'color' ? ' active' : ''}`}
          aria-label="Ink color"
          aria-expanded={flyout === 'color'}
          title="Ink color"
          onClick={() => toggleFlyout('color')}
        >
          <span className="swatch current" style={{ background: props.color }} />
        </button>
        {flyout === 'color' && (
          <div className="flyout" role="menu" aria-label="Colors">
            {INK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch-btn${props.color === c ? ' active' : ''}`}
                aria-label={`Color ${c}`}
                onClick={() => {
                  props.onColor(c);
                  setFlyout(null);
                }}
              >
                <span className="swatch" style={{ background: c }} />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rail-slot">
        <button
          type="button"
          className={`rail-btn${flyout === 'width' ? ' active' : ''}`}
          aria-label="Stroke width"
          aria-expanded={flyout === 'width'}
          title="Stroke width"
          onClick={() => toggleFlyout('width')}
        >
          <span
            className="width-dot"
            style={{ width: props.width * 1.4 + 4, height: props.width * 1.4 + 4 }}
          />
        </button>
        {flyout === 'width' && (
          <div className="flyout" role="menu" aria-label="Stroke widths">
            {INK_WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                className={`width-btn${props.width === w ? ' active' : ''}`}
                aria-label={`Width ${w}`}
                onClick={() => {
                  props.onWidth(w);
                  setFlyout(null);
                }}
              >
                <span className="width-dot" style={{ width: w * 1.4 + 4, height: w * 1.4 + 4 }} />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rail-sep" />

      <button
        type="button"
        className="rail-btn"
        aria-label="Undo (Z)"
        title="Undo (Z)"
        disabled={!props.canUndo}
        onClick={props.onUndo}
      >
        <UndoIcon />
      </button>
      <button
        type="button"
        className="rail-btn"
        aria-label="Redo (Shift+Z)"
        title="Redo (Shift+Z)"
        disabled={!props.canRedo}
        onClick={props.onRedo}
      >
        <RedoIcon />
      </button>
      <button
        type="button"
        className="rail-btn"
        aria-label="Clear page (undoable)"
        title="Clear page (undoable)"
        onClick={props.onClear}
      >
        <TrashIcon />
      </button>

      <div className="rail-sep" />

      <div className="rail-slot">
        <button
          type="button"
          className={`rail-btn${flyout === 'background' ? ' active' : ''}`}
          aria-label="Board background"
          aria-expanded={flyout === 'background'}
          title="Board background"
          onClick={() => toggleFlyout('background')}
        >
          <span className={`bg-thumb bg-thumb-${props.background}`} />
        </button>
        {flyout === 'background' && (
          <div className="flyout" role="menu" aria-label="Backgrounds">
            {BACKGROUND_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className={`bg-btn${props.background === kind ? ' active' : ''}`}
                aria-label={`${BACKGROUNDS[kind].label} background`}
                title={BACKGROUNDS[kind].label}
                onClick={() => {
                  props.onBackground(kind);
                  setFlyout(null);
                }}
              >
                <span className={`bg-thumb bg-thumb-${kind}`} />
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        className="rail-btn rail-collapse"
        aria-label="Hide tools"
        title="Hide tools"
        onClick={() => props.onCollapsed(true)}
      >
        <ChevronLeftIcon />
      </button>
    </div>
  );
}
