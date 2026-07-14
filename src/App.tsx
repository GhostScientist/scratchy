import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StageCanvas } from './ink/StageCanvas';
import type { InkEngine } from './ink/InkEngine';
import type { Viewport } from './ink/Viewport';
import { CameraOverlay } from './media/CameraOverlay';
import { useCamera } from './media/useCamera';
import { useMicrophone } from './media/useMicrophone';
import { useRecorder } from './recording/useRecorder';
import type { CompositorSources } from './recording/Compositor';
import { PreviewModal } from './recording/PreviewModal';
import { Toolbar } from './ui/Toolbar';
import { TopBar } from './ui/TopBar';
import { Countdown } from './ui/Countdown';
import { loadLesson, saveLesson, compactStrokes } from './persistence/autosave';
import { clamp } from './lib/geometry';
import {
  STAGE_WIDTH,
  STAGE_HEIGHT,
  DEFAULT_CAMERA_LAYOUT,
  DEFAULT_VIEWPORT,
  cameraAspectFor,
} from './types';
import type { BackgroundKind, CameraLayout, CameraShape, Tool } from './types';

interface Toast {
  id: number;
  text: string;
}

export default function App() {
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#1d1f24');
  const [width, setWidth] = useState(4);
  const [background, setBackground] = useState<BackgroundKind>('white');
  const [title, setTitle] = useState('Untitled lesson');
  const [collapsed, setCollapsed] = useState(false);
  const [history, setHistory] = useState({ undo: false, redo: false });
  const [hasInk, setHasInk] = useState(false);
  const [cameraLayout, setCameraLayout] = useState<CameraLayout>(DEFAULT_CAMERA_LAYOUT);
  const [cameraVisible, setCameraVisible] = useState(true);
  const [scale, setScale] = useState(1);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const camera = useCamera();
  const mic = useMicrophone();

  const engineRef = useRef<InkEngine | null>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const scaleRef = useRef(1);
  const cameraLayoutRef = useRef<CameraLayout>(DEFAULT_CAMERA_LAYOUT);
  const fitRef = useRef<HTMLDivElement>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  micStreamRef.current = mic.stream;

  // Snapshot of render state for frame-rate consumers (compositor, autosave).
  const stateRef = useRef({ background, cameraEnabled: camera.enabled, cameraVisible });
  stateRef.current = { background, cameraEnabled: camera.enabled, cameraVisible };
  const lessonRef = useRef({ title, background, tool, color, width });
  lessonRef.current = { title, background, tool, color, width };

  useEffect(() => {
    cameraLayoutRef.current = cameraLayout;
  }, [cameraLayout]);

  // ---- toasts --------------------------------------------------------------

  const toastId = useRef(0);
  const pushToast = useCallback((text: string) => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts.filter((t) => t.text !== text), { id, text }]);
    window.setTimeout(() => {
      setToasts((ts) => ts.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  // ---- autosave --------------------------------------------------------------

  const saveTimer = useRef(0);
  const quotaWarned = useRef(false);
  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const engine = engineRef.current;
      if (!engine) return;
      const ok = saveLesson({
        version: 2,
        ...lessonRef.current,
        cameraLayout: cameraLayoutRef.current,
        viewport: viewportRef.current?.get() ?? { ...DEFAULT_VIEWPORT },
        strokes: compactStrokes(engine.getStrokes()),
        updatedAt: Date.now(),
      });
      if (!ok && !quotaWarned.current) {
        quotaWarned.current = true;
        pushToast('Autosave paused — local storage is full.');
      }
    }, 600);
  }, [pushToast]);

  useEffect(() => {
    scheduleSave();
  }, [title, background, tool, color, width, cameraLayout, scheduleSave]);

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  // ---- ink engine ------------------------------------------------------------

  const handleEngineReady = useCallback(
    (engine: InkEngine, viewport: Viewport) => {
      engineRef.current = engine;
      viewportRef.current = viewport;
      const saved = loadLesson();
      if (saved) {
        setTitle(saved.title);
        setBackground(saved.background);
        setTool(saved.tool);
        setColor(saved.color);
        setWidth(saved.width);
        setCameraLayout(saved.cameraLayout);
        cameraLayoutRef.current = saved.cameraLayout;
        viewport.set(saved.viewport);
        engine.loadStrokes(saved.strokes);
        setHasInk(saved.strokes.length > 0);
      }
      // Where you are on the board is part of the lesson — persist pans/zooms
      // through the same debounced autosave.
      viewport.onChange(() => scheduleSave());
    },
    [scheduleSave],
  );

  const handleHistoryChange = useCallback((undo: boolean, redo: boolean) => {
    setHistory({ undo, redo });
  }, []);

  const handleCommit = useCallback(() => {
    setHasInk(engineRef.current?.hasStrokes() ?? false);
    scheduleSave();
  }, [scheduleSave]);

  // ---- stage scaling -----------------------------------------------------------

  useEffect(() => {
    const el = fitRef.current;
    if (!el) return;
    const update = (w: number, h: number) => {
      const s = clamp(Math.min(w / STAGE_WIDTH, h / STAGE_HEIGHT), 0.15, 2.5);
      scaleRef.current = s;
      setScale(s);
    };
    update(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) update(cr.width, cr.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- recording -----------------------------------------------------------

  const sources = useMemo<CompositorSources>(
    () => ({
      getBackground: () => stateRef.current.background,
      getInkCanvas: () => engineRef.current?.getInkCanvas() ?? null,
      getActiveStroke: () => engineRef.current?.getActiveStroke() ?? null,
      getViewport: () => viewportRef.current?.get() ?? { ...DEFAULT_VIEWPORT },
      getVideo: () =>
        stateRef.current.cameraEnabled && stateRef.current.cameraVisible
          ? videoElRef.current
          : null,
      getCameraLayout: () => cameraLayoutRef.current,
    }),
    [],
  );

  const getMicStream = useCallback(() => micStreamRef.current, []);
  const recorder = useRecorder(sources, getMicStream);

  const recordingActive =
    recorder.phase === 'countdown' ||
    recorder.phase === 'recording' ||
    recorder.phase === 'stopping';

  const tabHintShown = useRef(false);
  const handleRecord = () => {
    if (recorder.phase !== 'idle') return;
    if (!mic.enabled) {
      pushToast('Recording without microphone — tap the mic to add your voice.');
    }
    if (!tabHintShown.current) {
      tabHintShown.current = true;
      pushToast('Keep this tab visible while recording.');
    }
    setCollapsed(true);
    recorder.start();
  };

  // ---- camera / mic ----------------------------------------------------------

  const handleCameraButton = () => {
    if (recordingActive) {
      setCameraVisible((v) => !v);
      return;
    }
    if (camera.enabled) {
      camera.disable();
      setCameraVisible(true);
    } else {
      void camera.enable();
    }
  };

  const handleMicButton = () => {
    if (!mic.enabled) {
      void mic.enable();
      return;
    }
    if (recordingActive) {
      mic.toggleMuted();
      return;
    }
    mic.disable();
  };

  const handleShape = (shape: CameraShape) => {
    setCameraLayout((l) => {
      const aspect = cameraAspectFor(shape);
      const next: CameraLayout = { ...l, shape, height: Math.round(l.width * aspect) };
      next.y = clamp(next.y, 0, STAGE_HEIGHT - next.height);
      next.x = clamp(next.x, 0, STAGE_WIDTH - next.width);
      return next;
    });
  };

  useEffect(() => {
    if (camera.error) {
      pushToast(camera.error);
      camera.clearError();
    }
  }, [camera, pushToast]);

  useEffect(() => {
    if (mic.error) {
      pushToast(mic.error);
      mic.clearError();
    }
  }, [mic, pushToast]);

  useEffect(() => {
    if (recorder.error) {
      pushToast(recorder.error);
      recorder.dismissError();
    }
  }, [recorder, pushToast]);

  // ---- keyboard shortcuts ------------------------------------------------------

  const keyActionsRef = useRef({ camera: handleCameraButton, mic: handleMicButton });
  keyActionsRef.current = { camera: handleCameraButton, mic: handleMicButton };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) engineRef.current?.redo();
        else engineRef.current?.undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Space') {
        // Held spacebar pans with any pointer, like design tools.
        e.preventDefault();
        if (!e.repeat) engineRef.current?.setSpacePan(true);
        return;
      }
      switch (key) {
        case 'p':
          setTool('pen');
          break;
        case 'h':
          setTool('highlighter');
          break;
        case 'e':
          setTool('eraser');
          break;
        case 'v':
          setTool('hand');
          break;
        case 'z':
          if (e.shiftKey) engineRef.current?.redo();
          else engineRef.current?.undo();
          break;
        case 'c':
          keyActionsRef.current.camera();
          break;
        case 'm':
          keyActionsRef.current.mic();
          break;
        case '0': {
          // Back to 100% zoom, keeping the stage center fixed.
          const viewport = viewportRef.current;
          if (viewport) {
            viewport.zoomAt(
              { x: STAGE_WIDTH / 2, y: STAGE_HEIGHT / 2 },
              1 / viewport.get().zoom,
            );
          }
          break;
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') engineRef.current?.setSpacePan(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // ---- render -----------------------------------------------------------------

  const stageClasses = [
    'stage',
    `bg-${background}`,
    `tool-${tool}`,
    recorder.phase === 'recording' || recorder.phase === 'stopping' ? 'is-recording' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="app">
      <TopBar
        title={title}
        onTitle={setTitle}
        micEnabled={mic.enabled}
        micMuted={mic.muted}
        onMic={handleMicButton}
        cameraEnabled={camera.enabled}
        cameraVisible={cameraVisible}
        onCamera={handleCameraButton}
        phase={recorder.phase}
        elapsedMs={recorder.elapsedMs}
        onRecord={handleRecord}
        onCancelCountdown={recorder.cancelCountdown}
        onStop={recorder.stop}
      />

      <main className="viewport">
        <div className="stage-fit" ref={fitRef}>
          <div className={stageClasses} style={{ transform: `scale(${scale})` }}>
            <StageCanvas
              background={background}
              tool={tool}
              color={color}
              width={width}
              onReady={handleEngineReady}
              onHistoryChange={handleHistoryChange}
              onCommit={handleCommit}
            />
            {camera.stream && cameraVisible && (
              <CameraOverlay
                stream={camera.stream}
                layout={cameraLayout}
                layoutRef={cameraLayoutRef}
                scaleRef={scaleRef}
                videoElRef={videoElRef}
                recording={recordingActive}
                onLayoutChange={setCameraLayout}
                onShape={handleShape}
                onMirror={() => setCameraLayout((l) => ({ ...l, mirrored: !l.mirrored }))}
                onDisable={() => {
                  camera.disable();
                  setCameraVisible(true);
                }}
              />
            )}
            {!hasInk && recorder.phase === 'idle' && (
              <div className="empty-hint" aria-hidden="true">
                Pick up a pen and teach
              </div>
            )}
            {recorder.phase === 'countdown' && (
              <Countdown value={recorder.countdownValue} onCancel={recorder.cancelCountdown} />
            )}
          </div>
        </div>

        <Toolbar
          tool={tool}
          color={color}
          width={width}
          background={background}
          canUndo={history.undo}
          canRedo={history.redo}
          collapsed={collapsed}
          onTool={setTool}
          onColor={setColor}
          onWidth={setWidth}
          onBackground={setBackground}
          onUndo={() => engineRef.current?.undo()}
          onRedo={() => engineRef.current?.redo()}
          onClear={() => engineRef.current?.clear()}
          onCollapsed={setCollapsed}
        />
      </main>

      {recorder.take && (
        <PreviewModal
          take={recorder.take}
          title={title}
          onTitle={setTitle}
          onClose={recorder.closeTake}
          onDelete={() => {
            recorder.closeTake();
            pushToast('Take deleted.');
          }}
        />
      )}

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
