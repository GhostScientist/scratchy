import { useCallback, useEffect, useRef } from 'react';
import { clamp, cameraCornerRadius } from '../lib/geometry';
import {
  STAGE_WIDTH,
  STAGE_HEIGHT,
  CAMERA_MIN_WIDTH,
  CAMERA_MAX_WIDTH,
  cameraAspectFor,
} from '../types';
import type { CameraLayout, CameraShape } from '../types';
import { ShapeCircleIcon, ShapeRoundedIcon, ShapeRectIcon, MirrorIcon, CloseIcon } from '../ui/icons';

interface CameraOverlayProps {
  stream: MediaStream;
  layout: CameraLayout;
  /** Live layout read by the compositor every frame (updated during drags). */
  layoutRef: { current: CameraLayout };
  /** Current stage CSS scale — converts screen px deltas to logical px. */
  scaleRef: { current: number };
  videoElRef: { current: HTMLVideoElement | null };
  recording: boolean;
  onLayoutChange(layout: CameraLayout): void;
  onShape(shape: CameraShape): void;
  onMirror(): void;
  onDisable(): void;
}

interface Gesture {
  kind: 'move' | 'resize';
  pointerId: number;
  startX: number;
  startY: number;
  start: CameraLayout;
}

const SHAPES: { shape: CameraShape; label: string; Icon: typeof ShapeCircleIcon }[] = [
  { shape: 'circle', label: 'Circle camera', Icon: ShapeCircleIcon },
  { shape: 'rounded', label: 'Rounded camera', Icon: ShapeRoundedIcon },
  { shape: 'rect', label: 'Rectangular camera', Icon: ShapeRectIcon },
];

function borderRadiusFor(layout: CameraLayout): string {
  if (layout.shape === 'circle') return '50%';
  if (layout.shape === 'rounded') return `${cameraCornerRadius(layout.width, layout.height)}px`;
  return '0px';
}

export function CameraOverlay(props: CameraOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);

  const videoCallback = useCallback(
    (el: HTMLVideoElement | null) => {
      props.videoElRef.current = el;
      if (el && el.srcObject !== props.stream) {
        el.srcObject = props.stream;
        el.play().catch(() => {});
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.stream],
  );

  useEffect(() => {
    const el = props.videoElRef.current;
    if (el && el.srcObject !== props.stream) {
      el.srcObject = props.stream;
      el.play().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.stream]);

  const applyLayout = (l: CameraLayout) => {
    props.layoutRef.current = l;
    const root = rootRef.current;
    const frame = frameRef.current;
    if (root) {
      root.style.left = `${l.x}px`;
      root.style.top = `${l.y}px`;
      root.style.width = `${l.width}px`;
      root.style.height = `${l.height}px`;
    }
    if (frame) frame.style.borderRadius = borderRadiusFor(l);
  };

  const startGesture = (e: React.PointerEvent, kind: Gesture['kind']) => {
    if (props.recording && kind === 'resize') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    rootRef.current?.setPointerCapture(e.pointerId);
    gestureRef.current = {
      kind,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      start: props.layoutRef.current,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gestureRef.current;
    if (!g || e.pointerId !== g.pointerId) return;
    e.preventDefault();
    const s = props.scaleRef.current || 1;
    const dx = (e.clientX - g.startX) / s;
    const dy = (e.clientY - g.startY) / s;
    if (g.kind === 'move') {
      applyLayout({
        ...g.start,
        x: Math.round(clamp(g.start.x + dx, 0, STAGE_WIDTH - g.start.width)),
        y: Math.round(clamp(g.start.y + dy, 0, STAGE_HEIGHT - g.start.height)),
      });
    } else {
      const aspect = cameraAspectFor(g.start.shape);
      let width = clamp(g.start.width + dx, CAMERA_MIN_WIDTH, CAMERA_MAX_WIDTH);
      width = Math.min(width, STAGE_WIDTH - g.start.x, (STAGE_HEIGHT - g.start.y) / aspect);
      applyLayout({
        ...g.start,
        width: Math.round(width),
        height: Math.round(width * aspect),
      });
    }
  };

  const endGesture = (e: React.PointerEvent) => {
    const g = gestureRef.current;
    if (!g || e.pointerId !== g.pointerId) return;
    gestureRef.current = null;
    props.onLayoutChange(props.layoutRef.current);
  };

  const { layout, recording } = props;
  const controlsBelow = layout.y + layout.height + 60 <= STAGE_HEIGHT;

  return (
    <div
      ref={rootRef}
      className={`camera-overlay${recording ? ' is-recording' : ''}`}
      style={{ left: layout.x, top: layout.y, width: layout.width, height: layout.height }}
      onPointerDown={(e) => startGesture(e, 'move')}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
    >
      <div ref={frameRef} className="cam-frame" style={{ borderRadius: borderRadiusFor(layout) }}>
        <video
          ref={videoCallback}
          autoPlay
          playsInline
          muted
          style={{ transform: layout.mirrored ? 'scaleX(-1)' : undefined }}
        />
      </div>
      {!recording && (
        <>
          <div
            className="cam-handle"
            onPointerDown={(e) => startGesture(e, 'resize')}
            aria-hidden="true"
          />
          <div
            className={`cam-controls ${controlsBelow ? 'below' : 'above'}`}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {SHAPES.map(({ shape, label, Icon }) => (
              <button
                key={shape}
                type="button"
                className={`cam-btn${layout.shape === shape ? ' active' : ''}`}
                aria-label={label}
                title={label}
                onClick={() => props.onShape(shape)}
              >
                <Icon />
              </button>
            ))}
            <span className="cam-sep" />
            <button
              type="button"
              className={`cam-btn${layout.mirrored ? ' active' : ''}`}
              aria-label="Mirror camera"
              title="Mirror camera"
              onClick={props.onMirror}
            >
              <MirrorIcon />
            </button>
            <button
              type="button"
              className="cam-btn"
              aria-label="Turn camera off"
              title="Turn camera off"
              onClick={props.onDisable}
            >
              <CloseIcon />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
