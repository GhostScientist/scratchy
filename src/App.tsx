import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StageCanvas } from './ink/StageCanvas';
import type { InkEngine } from './ink/InkEngine';
import type { Viewport } from './ink/Viewport';
import { CameraOverlay } from './media/CameraOverlay';
import { useCamera } from './media/useCamera';
import { useMicrophone } from './media/useMicrophone';
import { useRecorder } from './recording/useRecorder';
import type { RecorderPhase } from './recording/useRecorder';
import type { CompositorSources } from './recording/Compositor';
import { PreviewModal } from './recording/PreviewModal';
import { Toolbar } from './ui/Toolbar';
import { TopBar } from './ui/TopBar';
import { Countdown } from './ui/Countdown';
import { Minimap } from './ui/Minimap';
import { ZoomControls, zoomToFit } from './ui/ZoomControls';
import { loadLesson, saveLesson, compactStrokes } from './persistence/autosave';
import type { SavedLesson } from './persistence/autosave';
import {
  initBoards,
  saveBoard,
  loadBoard,
  listBoards,
  createBoard,
  deleteBoard,
  setActiveBoard,
  saveTake,
  listTakes,
  deleteTake,
} from './persistence/boards';
import type { BoardMeta, StoredTake } from './persistence/boards';
import { BoardsMenu } from './ui/BoardsMenu';
import { TakesDrawer } from './ui/TakesDrawer';
import { ExportMenu } from './ui/ExportMenu';
import { SettingsMenu } from './ui/SettingsMenu';
import { loadSettings, saveSettings } from './settings/settings';
import type { AppSettings } from './settings/settings';
import { ensureDeviceProfile } from './capability/probe';
import { loadDeviceProfile } from './capability/profile';
import type { DeviceProfile } from './capability/profile';
import { presetById, outputCrop } from './recording/presets';
import { exportViewPng, exportBoardPng, downloadBlob } from './export/png';
import { clamp } from './lib/geometry';
import {
  STAGE_WIDTH,
  STAGE_HEIGHT,
  DEFAULT_CAMERA_LAYOUT,
  DEFAULT_VIEWPORT,
  cameraAspectFor,
  nextId,
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
  // Engine+viewport once the stage mounts, for the navigation-aid components.
  const [nav, setNav] = useState<{ engine: InkEngine; viewport: Viewport } | null>(null);
  const [inkRevision, setInkRevision] = useState(0);
  // Multi-board state; activeBoardId stays null when IndexedDB is unavailable
  // and the app runs on the single-lesson localStorage fallback.
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [takesOpen, setTakesOpen] = useState(false);
  const [takes, setTakes] = useState<StoredTake[]>([]);
  const [storageEstimate, setStorageEstimate] = useState<{ usage: number; quota: number } | null>(
    null,
  );
  // Device-global preferences (handedness, recording preset) — localStorage,
  // independent of the per-board lesson autosave.
  const [settings, setSettings] = useState<AppSettings>(loadSettings);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  // Capability profile (SPEC §9) — probed lazily before the first recording.
  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile | null>(loadDeviceProfile);
  const [probing, setProbing] = useState(false);

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
  // 'idb' once initBoards succeeds; 'local' is the single-lesson fallback.
  const storageModeRef = useRef<'local' | 'idb'>('local');
  const storageReadyRef = useRef(false);
  const boardIdRef = useRef<string | null>(null);
  // Serializes IDB writes so a slow save can never land after a newer one.
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  const snapshotLesson = useCallback(
    (): Omit<SavedLesson, 'version'> => ({
      ...lessonRef.current,
      cameraLayout: cameraLayoutRef.current,
      viewport: viewportRef.current?.get() ?? { ...DEFAULT_VIEWPORT },
      strokes: compactStrokes(engineRef.current?.getStrokes() ?? []),
      updatedAt: Date.now(),
    }),
    [],
  );

  const warnSaveFailed = useCallback(() => {
    if (quotaWarned.current) return;
    quotaWarned.current = true;
    pushToast('Autosave paused — device storage may be full.');
  }, [pushToast]);

  /** Persist the current lesson under boardId (captured by the caller when
   *  the save was scheduled, so a board switch can't cross-save). */
  const persistNow = useCallback(
    (boardId: string | null): Promise<void> => {
      if (!storageReadyRef.current || !engineRef.current) return Promise.resolve();
      const lesson = snapshotLesson();
      if (storageModeRef.current === 'idb') {
        if (!boardId) return Promise.resolve();
        saveChainRef.current = saveChainRef.current.then(async () => {
          const ok = await saveBoard({ ...lesson, version: 3, id: boardId });
          if (!ok) warnSaveFailed();
        });
        setBoards((prev) => {
          const meta: BoardMeta = {
            id: boardId,
            title: lesson.title,
            updatedAt: lesson.updatedAt,
            strokeCount: lesson.strokes.length,
          };
          return [meta, ...prev.filter((m) => m.id !== boardId)].sort(
            (a, b) => b.updatedAt - a.updatedAt,
          );
        });
        return saveChainRef.current;
      }
      if (!saveLesson({ version: 2, ...lesson })) warnSaveFailed();
      return Promise.resolve();
    },
    [snapshotLesson, warnSaveFailed],
  );

  const scheduleSave = useCallback(() => {
    const boardId = boardIdRef.current;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void persistNow(boardId);
    }, 600);
  }, [persistNow]);

  useEffect(() => {
    scheduleSave();
  }, [title, background, tool, color, width, cameraLayout, scheduleSave]);

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  // ---- ink engine ------------------------------------------------------------

  const applyLesson = useCallback(
    (saved: Omit<SavedLesson, 'version'>, engine: InkEngine, viewport: Viewport) => {
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
      setInkRevision((r) => r + 1);
    },
    [],
  );

  const handleEngineReady = useCallback(
    (engine: InkEngine, viewport: Viewport) => {
      engineRef.current = engine;
      viewportRef.current = viewport;
      void (async () => {
        const init = await initBoards();
        if (init) {
          storageModeRef.current = 'idb';
          boardIdRef.current = init.board.id;
          setActiveBoardId(init.board.id);
          setBoards(init.boards);
          applyLesson(init.board, engine, viewport);
        } else {
          // IndexedDB unavailable — single-lesson localStorage, as before.
          const saved = loadLesson();
          if (saved) applyLesson(saved, engine, viewport);
        }
        storageReadyRef.current = true;
        // Where you are on the board is part of the lesson — persist
        // pans/zooms through the same debounced autosave.
        viewport.onChange(() => scheduleSave());
        scheduleSave();
        setNav({ engine, viewport });
      })();
    },
    [applyLesson, scheduleSave],
  );

  const handleHistoryChange = useCallback((undo: boolean, redo: boolean) => {
    setHistory({ undo, redo });
  }, []);

  const handleCommit = useCallback(() => {
    setHasInk(engineRef.current?.hasStrokes() ?? false);
    setInkRevision((r) => r + 1);
    scheduleSave();
  }, [scheduleSave]);

  // ---- boards ----------------------------------------------------------------

  const openBoard = useCallback(
    async (id: string, { saveCurrent }: { saveCurrent: boolean }) => {
      const engine = engineRef.current;
      const viewport = viewportRef.current;
      if (!engine || !viewport) return;
      window.clearTimeout(saveTimer.current);
      if (saveCurrent) await persistNow(boardIdRef.current);
      const board = await loadBoard(id);
      if (!board) {
        pushToast('Could not open that board.');
        return;
      }
      boardIdRef.current = board.id;
      setActiveBoardId(board.id);
      applyLesson(board, engine, viewport);
      void setActiveBoard(board.id);
      setBoards(await listBoards());
    },
    [applyLesson, persistNow, pushToast],
  );

  const handleSwitchBoard = useCallback(
    (id: string) => {
      if (id === boardIdRef.current) return;
      void openBoard(id, { saveCurrent: true });
    },
    [openBoard],
  );

  const handleCreateBoard = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    await persistNow(boardIdRef.current);
    const board = await createBoard();
    if (!board) {
      pushToast('Could not create a board.');
      return;
    }
    await openBoard(board.id, { saveCurrent: false });
  }, [openBoard, persistNow, pushToast]);

  const handleDeleteBoard = useCallback(
    async (id: string) => {
      const wasActive = id === boardIdRef.current;
      if (wasActive) {
        // Never re-save a board that is being deleted: kill the pending
        // debounce and detach the id so later flushes become no-ops.
        window.clearTimeout(saveTimer.current);
        boardIdRef.current = null;
      }
      await deleteBoard(id);
      if (!wasActive) {
        setBoards(await listBoards());
        return;
      }
      const remaining = await listBoards();
      if (remaining.length > 0) {
        await openBoard(remaining[0].id, { saveCurrent: false });
      } else {
        await handleCreateBoard();
      }
      pushToast('Board deleted.');
    },
    [handleCreateBoard, openBoard, pushToast],
  );

  // ---- PNG export ----------------------------------------------------------------

  const handleExport = useCallback(
    async (kind: 'view' | 'board') => {
      const engine = engineRef.current;
      const viewport = viewportRef.current;
      if (!engine || !viewport) return;
      const bg = stateRef.current.background;
      const blob =
        kind === 'view' ? await exportViewPng(engine, viewport, bg) : await exportBoardPng(engine, bg);
      if (!blob) {
        pushToast(
          kind === 'board' ? 'Nothing to export — the board is empty.' : 'Export failed.',
        );
        return;
      }
      const slug =
        lessonRef.current.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '') || 'lesson';
      downloadBlob(blob, `${slug}${kind === 'board' ? ' board' : ''}.png`);
    },
    [pushToast],
  );

  // ---- takes library -----------------------------------------------------------

  const refreshTakes = useCallback(async () => {
    const id = boardIdRef.current;
    if (!id) return;
    setTakes(await listTakes(id));
    try {
      const est = await navigator.storage?.estimate?.();
      if (est) setStorageEstimate({ usage: est.usage ?? 0, quota: est.quota ?? 0 });
    } catch {
      // Estimate is a nicety only.
    }
  }, []);

  const handleOpenTakes = useCallback(() => {
    setTakesOpen(true);
    void refreshTakes();
  }, [refreshTakes]);

  const handleDeleteTake = useCallback(
    async (id: string) => {
      await deleteTake(id);
      void refreshTakes();
    },
    [refreshTakes],
  );

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
      getLaserTrail: () => engineRef.current?.getLaserTrail() ?? [],
      getVideo: () =>
        stateRef.current.cameraEnabled && stateRef.current.cameraVisible
          ? videoElRef.current
          : null,
      getCameraLayout: () => cameraLayoutRef.current,
    }),
    [],
  );

  const preset = presetById(settings.presetId);
  const presetRef = useRef(preset);
  presetRef.current = preset;
  const getPreset = useCallback(() => presetRef.current, []);

  const getMicStream = useCallback(() => micStreamRef.current, []);
  const recorder = useRecorder(sources, getMicStream, getPreset);

  const recorderTake = recorder.take;
  const handleSaveTake = useCallback(async (): Promise<boolean> => {
    const boardId = boardIdRef.current;
    if (!recorderTake || !boardId) return false;
    return saveTake({
      id: nextId('t'),
      boardId,
      title: lessonRef.current.title,
      blob: recorderTake.blob,
      mimeType: recorderTake.mimeType,
      extension: recorderTake.extension,
      durationMs: recorderTake.durationMs,
      createdAt: recorderTake.createdAt,
    });
  }, [recorderTake]);

  const recordingActive =
    recorder.phase === 'countdown' ||
    recorder.phase === 'recording' ||
    recorder.phase === 'paused' ||
    recorder.phase === 'stopping';

  // DEV hook so e2e tests can poll the recorder without driving the UI.
  const recorderApiRef = useRef(recorder);
  recorderApiRef.current = recorder;
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__scratchyRecorder = {
      getPhase: () => recorderApiRef.current.phase,
      getElapsedMs: () => recorderApiRef.current.elapsedMs,
    };
  }, []);

  const tabHintShown = useRef(false);
  const handleRecord = () => {
    if (recorder.phase !== 'idle' || probing) return;
    void (async () => {
      // Gate recording behind the capability probe — cached after the first
      // pass, so this is instant on every later take.
      setProbing(true);
      const result = await ensureDeviceProfile();
      setProbing(false);
      if (!result.ok) {
        pushToast(result.reason);
        return;
      }
      setDeviceProfile(result.profile);
      // A gated preset can outlive a re-probe that says no — drop back.
      if (presetRef.current.needsPerformance && !result.profile.supports1080p) {
        presetRef.current = presetById('compat');
        updateSettings({ presetId: 'compat' });
        pushToast('Dropped to 720p — this device failed the 1080p performance check.');
      }
      if (!mic.enabled) {
        pushToast('Recording without microphone — tap the mic to add your voice.');
      }
      if (!tabHintShown.current) {
        tabHintShown.current = true;
        pushToast('Keep this tab visible while recording.');
      }
      setCollapsed(true);
      recorder.start();
    })();
  };

  const handleDeviceCheck = useCallback(() => {
    void (async () => {
      setProbing(true);
      const result = await ensureDeviceProfile(true);
      setProbing(false);
      if (result.ok) {
        setDeviceProfile(result.profile);
        pushToast(
          result.profile.warnings.length > 0
            ? result.profile.warnings[0]
            : 'Device check passed — this browser records fine.',
        );
      } else {
        pushToast(result.reason);
      }
    })();
  }, [pushToast]);

  const handlePreset = useCallback(
    (id: string) => {
      const next = presetById(id);
      if (!next.needsPerformance) {
        updateSettings({ presetId: next.id });
        return;
      }
      // 1080p-class presets are gated on the performance probe (SPEC §6.5).
      void (async () => {
        let profile = deviceProfile;
        if (!profile) {
          setProbing(true);
          const result = await ensureDeviceProfile();
          setProbing(false);
          if (!result.ok) {
            pushToast(result.reason);
            return;
          }
          profile = result.profile;
          setDeviceProfile(profile);
        }
        if (profile.supports1080p) {
          updateSettings({ presetId: next.id });
        } else {
          pushToast('This device failed the 1080p performance check — staying at 720p.');
        }
      })();
    },
    [deviceProfile, pushToast, updateSettings],
  );

  const deviceSummary = deviceProfile
    ? `Records ${deviceProfile.mimeType.split(';')[0].split('/')[1]?.toUpperCase() ?? 'video'} · ${
        deviceProfile.supports1080p ? 'up to 1080p' : '720p (compatibility)'
      }${deviceProfile.pauseReliable ? '' : ' · pause unavailable'}`
    : null;
  // Until a probe says otherwise, offer pause (SPEC §6.5: hide when unreliable).
  const pauseReliable = deviceProfile?.pauseReliable ?? true;

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

  const keyActionsRef = useRef({
    camera: handleCameraButton,
    mic: handleMicButton,
    recorderPhase: recorder.phase as RecorderPhase,
    pauseResume: () => {},
  });
  keyActionsRef.current = {
    camera: handleCameraButton,
    mic: handleMicButton,
    recorderPhase: recorder.phase,
    pauseResume: () => {
      if (recorder.phase === 'recording') recorder.pause();
      else if (recorder.phase === 'paused') recorder.resume();
    },
  };

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
        e.preventDefault();
        const phase = keyActionsRef.current.recorderPhase;
        if (phase === 'recording' || phase === 'paused') {
          // SPEC §12: Space pauses/resumes while recording.
          if (!e.repeat) keyActionsRef.current.pauseResume();
        } else if (!e.repeat) {
          // Held spacebar pans with any pointer, like design tools.
          engineRef.current?.setSpacePan(true);
        }
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
        case 'l':
          setTool('laser');
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
        case '1': {
          const engine = engineRef.current;
          const viewport = viewportRef.current;
          if (engine && viewport) zoomToFit(engine, viewport);
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
    recorder.phase === 'recording' || recorder.phase === 'paused' || recorder.phase === 'stopping'
      ? 'is-recording'
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={`app${settings.handedness === 'left' ? ' hand-left' : ''}`}>
      <TopBar
        title={title}
        onTitle={setTitle}
        boardsSlot={
          activeBoardId && (
            <BoardsMenu
              boards={boards}
              activeBoardId={activeBoardId}
              disabled={recordingActive}
              onSwitch={handleSwitchBoard}
              onCreate={() => void handleCreateBoard()}
              onDelete={(id) => void handleDeleteBoard(id)}
            />
          )
        }
        exportSlot={
          <ExportMenu
            onExportView={() => void handleExport('view')}
            onExportBoard={() => void handleExport('board')}
          />
        }
        settingsSlot={
          <SettingsMenu
            handedness={settings.handedness}
            onHandedness={(handedness) => updateSettings({ handedness })}
            presetId={preset.id}
            presetLocked={recordingActive}
            supports1080p={deviceProfile ? deviceProfile.supports1080p : null}
            onPreset={handlePreset}
            deviceSummary={deviceSummary}
            deviceChecking={probing}
            onDeviceCheck={handleDeviceCheck}
          />
        }
        onLibrary={activeBoardId ? handleOpenTakes : undefined}
        micEnabled={mic.enabled}
        micMuted={mic.muted}
        onMic={handleMicButton}
        cameraEnabled={camera.enabled}
        cameraVisible={cameraVisible}
        onCamera={handleCameraButton}
        phase={recorder.phase}
        elapsedMs={recorder.elapsedMs}
        probing={probing}
        onPause={pauseReliable ? recorder.pause : undefined}
        onResume={pauseReliable ? recorder.resume : undefined}
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
            {preset.id === 'vertical' && (
              // SPEC §4.6 "a predictable frame": mark the recorded 9:16 crop.
              <div className="frame-guide" aria-hidden="true">
                <div className="frame-guide-window" style={{ width: outputCrop(preset).w }} />
              </div>
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

        {nav && (
          <div className="nav-aids">
            <Minimap
              engine={nav.engine}
              viewport={nav.viewport}
              background={background}
              revision={inkRevision}
            />
            <ZoomControls
              engine={nav.engine}
              viewport={nav.viewport}
              onEmptyFit={() => pushToast('Nothing to fit — the board is empty.')}
            />
          </div>
        )}

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
          onSaveToLibrary={activeBoardId ? handleSaveTake : undefined}
        />
      )}

      {takesOpen && (
        <TakesDrawer
          takes={takes}
          estimate={storageEstimate}
          onClose={() => setTakesOpen(false)}
          onDelete={(id) => void handleDeleteTake(id)}
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
