import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StageCanvas } from './ink/StageCanvas';
import type { InkEngine, SelectionInfo, TextEditRequest } from './ink/InkEngine';
import { TextEditorOverlay } from './ui/TextEditorOverlay';
import { SelectionActions } from './ui/SelectionActions';
import { PageStrip } from './ui/PageStrip';
import type { Viewport } from './ink/Viewport';
import { importImageFiles } from './import/images';
import { importPdf, MAX_PDF_PAGES } from './import/pdf';
import { CameraOverlay } from './media/CameraOverlay';
import { useCamera } from './media/useCamera';
import { useCutout } from './media/useCutout';
import type { CutoutFallbackReason } from './media/useCutout';
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
import type { BoardMeta, SavedBoard, StoredTake } from './persistence/boards';
import { BoardsMenu } from './ui/BoardsMenu';
import { TakesDrawer } from './ui/TakesDrawer';
import { ExportMenu } from './ui/ExportMenu';
import { SettingsMenu } from './ui/SettingsMenu';
import { loadSettings, saveSettings } from './settings/settings';
import type { AppSettings } from './settings/settings';
import { OnboardingModal } from './onboarding/OnboardingModal';
import {
  ONBOARDING_VERSION,
  markOnboardingSeen,
  seenOnboardingVersion,
} from './onboarding/onboardingStorage';
import { ensureDeviceProfile } from './capability/probe';
import { loadDeviceProfile } from './capability/profile';
import type { DeviceProfile } from './capability/profile';
import { presetById, outputCrop } from './recording/presets';
import { recoverSessions, assembleSession, deleteSessionById } from './recording/RecordingStore';
import type { RecoverableSession } from './recording/RecordingStore';
import { RecoveryCard } from './ui/RecoveryCard';
import type { Take } from './types';
import { exportViewPng, exportBoardPng, downloadBlob } from './export/png';
import { clamp } from './lib/geometry';
import {
  STAGE_WIDTH,
  STAGE_HEIGHT,
  DEFAULT_CAMERA_LAYOUT,
  DEFAULT_VIEWPORT,
  blankPage,
  cameraAspectFor,
  nextId,
} from './types';
import type {
  BackgroundKind,
  BoardPage,
  CameraLayout,
  CameraShape,
  ShapeKind,
  Tool,
} from './types';

interface Toast {
  id: number;
  text: string;
}

export default function App() {
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#1d1f24');
  const [width, setWidth] = useState(4);
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');
  // Open DOM text editor (new text or an existing element being edited).
  const [textEdit, setTextEdit] = useState<TextEditRequest | null>(null);
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
  // Pages of the open board. The array lives in a ref (elements are heavy and
  // change on every autosave sync); pageInfo is the light mirror React
  // renders from — revision bumps whenever the structure changes.
  const pagesRef = useRef<{ pages: BoardPage[]; activeIndex: number }>({
    pages: [blankPage()],
    activeIndex: 0,
  });
  const [pageInfo, setPageInfo] = useState({ count: 1, activeIndex: 0, revision: 0 });
  // Image/PDF import state: the selection overlay and the PDF progress veil.
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [pdfProgress, setPdfProgress] = useState<{ done: number; total: number } | null>(null);
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

  // First-launch welcome tour; replayable from the settings menu.
  const [onboardingOpen, setOnboardingOpen] = useState(
    () => seenOnboardingVersion() < ONBOARDING_VERSION,
  );

  // Capability profile (SPEC §9) — probed lazily before the first recording.
  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile | null>(loadDeviceProfile);
  const [probing, setProbing] = useState(false);
  // Recording sessions left behind by a crash/reload, offered for recovery.
  const [recoverable, setRecoverable] = useState<RecoverableSession[]>([]);
  const [recovered, setRecovered] = useState<{
    take: Take;
    sessionId: string;
    boardId: string | null;
  } | null>(null);

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

  // ---- camera background removal --------------------------------------------

  // The engine (or this device) gave up on segmentation — land back on the
  // rounded frame so the camera keeps working without interruption.
  const handleCutoutFallback = useCallback(
    (reason: CutoutFallbackReason) => {
      setCameraLayout((l) => {
        if (l.shape !== 'cutout') return l;
        const height = Math.round(l.width * cameraAspectFor('rounded'));
        return {
          ...l,
          shape: 'rounded',
          height,
          x: clamp(l.x, 0, STAGE_WIDTH - l.width),
          y: clamp(l.y, 0, STAGE_HEIGHT - height),
        };
      });
      pushToast(
        reason === 'performance'
          ? 'Background removal is too slow on this device — switched back to the rounded camera.'
          : 'Background removal is unavailable in this browser — switched back to the rounded camera.',
      );
    },
    [pushToast],
  );

  const cutout = useCutout({
    active: camera.enabled && cameraVisible && cameraLayout.shape === 'cutout',
    videoElRef,
    onFallback: handleCutoutFallback,
  });
  const getCutoutCanvas = cutout.getCanvas;

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

  /** Write what the engine/viewport hold back into the active page record. */
  const syncActivePage = useCallback(() => {
    const engine = engineRef.current;
    const viewport = viewportRef.current;
    const page = pagesRef.current.pages[pagesRef.current.activeIndex];
    if (!engine || !viewport || !page) return;
    page.elements = compactStrokes(engine.getStrokes());
    page.viewport = viewport.get();
  }, []);

  const snapshotBoard = useCallback(
    (boardId: string): SavedBoard => {
      syncActivePage();
      const { pages, activeIndex } = pagesRef.current;
      return {
        version: 5,
        id: boardId,
        ...lessonRef.current,
        cameraLayout: cameraLayoutRef.current,
        // Shallow copies: the queued save must not see later page edits.
        pages: pages.map((p) => ({ ...p })),
        activePageId: (pages[activeIndex] ?? pages[0]).id,
        updatedAt: Date.now(),
      };
    },
    [syncActivePage],
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
      if (storageModeRef.current === 'idb') {
        if (!boardId) return Promise.resolve();
        const board = snapshotBoard(boardId);
        saveChainRef.current = saveChainRef.current.then(async () => {
          const ok = await saveBoard(board);
          if (!ok) warnSaveFailed();
        });
        setBoards((prev) => {
          const meta: BoardMeta = {
            id: boardId,
            title: board.title,
            updatedAt: board.updatedAt,
            strokeCount: board.pages.reduce((n, p) => n + p.elements.length, 0),
            pageCount: board.pages.length,
          };
          return [meta, ...prev.filter((m) => m.id !== boardId)].sort(
            (a, b) => b.updatedAt - a.updatedAt,
          );
        });
        return saveChainRef.current;
      }
      if (!saveLesson({ version: 2, ...snapshotLesson() })) warnSaveFailed();
      return Promise.resolve();
    },
    [snapshotBoard, snapshotLesson, warnSaveFailed],
  );

  const scheduleSave = useCallback(
    (delayMs = 600) => {
      const boardId = boardIdRef.current;
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void persistNow(boardId);
      }, delayMs);
    },
    [persistNow],
  );

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

  const applyBoard = useCallback(
    (board: SavedBoard, engine: InkEngine, viewport: Viewport) => {
      setTitle(board.title);
      setBackground(board.background);
      setTool(board.tool);
      setColor(board.color);
      setWidth(board.width);
      setCameraLayout(board.cameraLayout);
      cameraLayoutRef.current = board.cameraLayout;
      const pages = board.pages.length > 0 ? board.pages : [blankPage()];
      const found = pages.findIndex((p) => p.id === board.activePageId);
      const activeIndex = found >= 0 ? found : 0;
      pagesRef.current = { pages, activeIndex };
      const page = pages[activeIndex];
      viewport.set(page.viewport);
      engine.loadStrokes(page.elements);
      setHasInk(page.elements.length > 0);
      setInkRevision((r) => r + 1);
      setPageInfo((p) => ({ count: pages.length, activeIndex, revision: p.revision + 1 }));
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
          applyBoard(init.board, engine, viewport);
        } else {
          // IndexedDB unavailable — single-lesson localStorage, as before.
          const saved = loadLesson();
          if (saved) applyLesson(saved, engine, viewport);
        }
        storageReadyRef.current = true;
        // Where you are on the board is part of the lesson — persist
        // pans/zooms through the same debounced autosave, on a slower timer:
        // losing the last pan position to a crash is fine, losing ink is not.
        viewport.onChange(() => scheduleSave(1500));
        scheduleSave();
        setNav({ engine, viewport });
        // Surface recordings interrupted by a crash or reload (SPEC §6.5).
        void recoverSessions().then(setRecoverable);
      })();
    },
    [applyBoard, applyLesson, scheduleSave],
  );

  const handleHistoryChange = useCallback((undo: boolean, redo: boolean) => {
    setHistory({ undo, redo });
  }, []);

  const handleCommit = useCallback(() => {
    setHasInk(engineRef.current?.hasStrokes() ?? false);
    setInkRevision((r) => r + 1);
    scheduleSave();
  }, [scheduleSave]);

  // ---- text tool ----------------------------------------------------------

  // Ref mirror so commit/cancel run their engine side effects exactly once —
  // React StrictMode double-invokes setState updaters, so side effects can't
  // live inside them.
  const textEditRef = useRef<TextEditRequest | null>(null);

  const handleTextEdit = useCallback((request: TextEditRequest) => {
    // A tap while an editor is open only blurs it (the blur commits) —
    // pointerdown reaches the canvas before blur fires, so ignore it here.
    if (textEditRef.current) return;
    // Hide the committed element while the DOM editor covers it.
    if (request.element) engineRef.current?.setHiddenElementId(request.element.id);
    textEditRef.current = request;
    setTextEdit(request);
  }, []);

  const textDefaults = useRef({ color, width });
  textDefaults.current = { color, width };

  const commitText = useCallback((value: string) => {
    const engine = engineRef.current;
    const current = textEditRef.current;
    if (!engine || !current) return;
    textEditRef.current = null;
    engine.setHiddenElementId(null);
    if (current.element) {
      engine.updateTextElement(current.element.id, value);
    } else if (value.trim() !== '') {
      engine.addTextElement({
        kind: 'text',
        id: nextId('tx'),
        x: current.world.x,
        y: current.world.y,
        text: value,
        color: textDefaults.current.color,
        // Width steps (2/4/7/12) map onto readable world-space type sizes.
        fontSize: textDefaults.current.width * 8,
      });
    }
    setTextEdit(null);
  }, []);

  const cancelText = useCallback(() => {
    if (!textEditRef.current) return;
    textEditRef.current = null;
    engineRef.current?.setHiddenElementId(null);
    setTextEdit(null);
  }, []);

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
      applyBoard(board, engine, viewport);
      void setActiveBoard(board.id);
      setBoards(await listBoards());
    },
    [applyBoard, persistNow, pushToast],
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

  // ---- pages -----------------------------------------------------------------

  /** Re-mirror pagesRef into React state; `load` swaps the engine/viewport
   *  onto the (possibly new) active page. */
  const refreshPages = useCallback(
    (activeIndex: number, load: boolean) => {
      const { pages } = pagesRef.current;
      const idx = clamp(activeIndex, 0, pages.length - 1);
      pagesRef.current.activeIndex = idx;
      if (load) {
        const page = pages[idx];
        viewportRef.current?.set(page.viewport);
        engineRef.current?.loadStrokes(page.elements);
        setHasInk(page.elements.length > 0);
        setInkRevision((r) => r + 1);
      }
      setPageInfo((p) => ({ count: pages.length, activeIndex: idx, revision: p.revision + 1 }));
      scheduleSave();
    },
    [scheduleSave],
  );

  const openPage = useCallback(
    (index: number) => {
      const { pages, activeIndex } = pagesRef.current;
      if (index === activeIndex || index < 0 || index >= pages.length) return;
      syncActivePage();
      refreshPages(index, true);
    },
    [refreshPages, syncActivePage],
  );

  const addPage = useCallback(() => {
    syncActivePage();
    const { pages, activeIndex } = pagesRef.current;
    const page = blankPage();
    // A fresh page opens where you were looking — less disorienting than
    // snapping back to the origin.
    page.viewport = viewportRef.current?.get() ?? page.viewport;
    pages.splice(activeIndex + 1, 0, page);
    refreshPages(activeIndex + 1, true);
  }, [refreshPages, syncActivePage]);

  const duplicatePage = useCallback(
    (index: number) => {
      syncActivePage();
      const { pages } = pagesRef.current;
      const src = pages[index];
      if (!src) return;
      const copy: BoardPage = {
        id: nextId('pg'),
        // Fresh element ids (selection/undo track identity); assetIds are
        // shared on purpose — both copies point at the same stored pixels.
        elements: src.elements.map((el) => ({ ...structuredClone(el), id: nextId('el') })),
        viewport: { ...src.viewport },
      };
      pages.splice(index + 1, 0, copy);
      refreshPages(index + 1, true);
    },
    [refreshPages, syncActivePage],
  );

  const deletePage = useCallback(
    (index: number) => {
      const { pages, activeIndex } = pagesRef.current;
      if (index < 0 || index >= pages.length) return;
      if (pages.length === 1) {
        // A board always has a page: deleting the last one blanks it.
        const page = blankPage();
        page.viewport = viewportRef.current?.get() ?? page.viewport;
        pages[0] = page;
        refreshPages(0, true);
        return;
      }
      pages.splice(index, 1);
      if (index === activeIndex) {
        refreshPages(Math.min(index, pages.length - 1), true);
      } else {
        refreshPages(index < activeIndex ? activeIndex - 1 : activeIndex, false);
      }
    },
    [refreshPages],
  );

  const movePage = useCallback(
    (index: number, dir: -1 | 1) => {
      const { pages, activeIndex } = pagesRef.current;
      const target = index + dir;
      if (index < 0 || index >= pages.length || target < 0 || target >= pages.length) return;
      syncActivePage();
      [pages[index], pages[target]] = [pages[target], pages[index]];
      const nextActive =
        activeIndex === index ? target : activeIndex === target ? index : activeIndex;
      refreshPages(nextActive, false);
    },
    [refreshPages, syncActivePage],
  );

  // DEV hook so e2e tests can drive pages without pixel-perfect strip taps.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__scratchyPages = {
      open: openPage,
      add: addPage,
      duplicate: duplicatePage,
      remove: deletePage,
      move: movePage,
      info: () => ({
        count: pagesRef.current.pages.length,
        activeIndex: pagesRef.current.activeIndex,
        ids: pagesRef.current.pages.map((p) => p.id),
      }),
    };
  }, [openPage, addPage, duplicatePage, deletePage, movePage]);

  // ---- selection (lock/unlock overlay) ----------------------------------------

  const handleSelectionChange = useCallback(() => {
    const info = engineRef.current?.getSelectionInfo();
    setSelection(info && info.ids.length > 0 ? info : null);
  }, []);

  // ---- image / PDF import ------------------------------------------------------

  const handleImportPdf = useCallback(
    async (file: File) => {
      setPdfProgress({ done: 0, total: 0 });
      try {
        const result = await importPdf(file, (done, total) => setPdfProgress({ done, total }));
        if (result.totalPages > result.pages.length) {
          pushToast(`Long PDF — imported the first ${MAX_PDF_PAGES} pages.`);
        }
        if (result.pages.length === 0) return;
        syncActivePage();
        const { pages } = pagesRef.current;
        const firstNew = pages.length;
        pages.push(...result.pages);
        refreshPages(firstNew, true);
        // Assets are already committed — put the board record next to them
        // now rather than trusting the debounce.
        await persistNow(boardIdRef.current);
      } catch {
        pushToast('Could not read that PDF.');
      } finally {
        setPdfProgress(null);
      }
    },
    [persistNow, pushToast, refreshPages, syncActivePage],
  );

  const handleImportFiles = useCallback(
    (files: File[]) => {
      const engine = engineRef.current;
      const viewport = viewportRef.current;
      if (!engine || !viewport || files.length === 0) return;
      if (storageModeRef.current !== 'idb') {
        pushToast("Importing files needs browser storage that isn't available here.");
        return;
      }
      const images = files.filter((f) => f.type.startsWith('image/'));
      const pdfs = files.filter(
        (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name),
      );
      if (images.length === 0 && pdfs.length === 0) {
        pushToast('Only images and PDFs can be imported.');
        return;
      }
      if (pdfs.length > 1) pushToast('One PDF at a time — importing the first.');
      if (images.length > 0) {
        void importImageFiles(images, { engine, viewport, toast: pushToast });
      }
      if (pdfs.length > 0) void handleImportPdf(pdfs[0]);
    },
    [handleImportPdf, pushToast],
  );

  // Paste an image (screenshot) straight onto the board.
  const importFilesRef = useRef(handleImportFiles);
  importFilesRef.current = handleImportFiles;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      const files = [...(e.clipboardData?.files ?? [])].filter(
        (f) => f.type.startsWith('image/') || f.type === 'application/pdf',
      );
      if (files.length === 0) return;
      e.preventDefault();
      importFilesRef.current(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

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
      getInkRevision: () => engineRef.current?.getFrameRevision() ?? 0,
      getActiveElement: () => engineRef.current?.getActiveElement() ?? null,
      getViewport: () => viewportRef.current?.get() ?? { ...DEFAULT_VIEWPORT },
      getLaserTrail: () => engineRef.current?.getLaserTrail() ?? [],
      getVideo: () =>
        stateRef.current.cameraEnabled && stateRef.current.cameraVisible
          ? videoElRef.current
          : null,
      getCutoutCanvas: () =>
        stateRef.current.cameraEnabled && stateRef.current.cameraVisible
          ? getCutoutCanvas()
          : null,
      getCameraLayout: () => cameraLayoutRef.current,
    }),
    [getCutoutCanvas],
  );

  const preset = presetById(settings.presetId);
  const presetRef = useRef(preset);
  presetRef.current = preset;
  const getPreset = useCallback(() => presetRef.current, []);

  const getMicStream = useCallback(() => micStreamRef.current, []);
  const getSessionMeta = useCallback(
    () => ({ boardId: boardIdRef.current, title: lessonRef.current.title }),
    [],
  );
  const recorder = useRecorder(sources, getMicStream, getPreset, getSessionMeta, pushToast);

  // ---- crash recovery --------------------------------------------------------

  const handleRecoverSession = useCallback(
    async (session: RecoverableSession) => {
      setRecoverable((list) => list.filter((s) => s !== session));
      const blob = await assembleSession(session.manifest.sessionId);
      if (!blob || blob.size === 0) {
        pushToast('Could not recover that recording.');
        void deleteSessionById(session.manifest.sessionId);
        return;
      }
      setRecovered({
        take: {
          blob,
          url: URL.createObjectURL(blob),
          mimeType: session.manifest.mimeType,
          extension: session.manifest.extension,
          durationMs: session.manifest.activeMs,
          createdAt: session.manifest.startedAt,
        },
        sessionId: session.manifest.sessionId,
        boardId: session.manifest.boardId,
      });
    },
    [pushToast],
  );

  const handleDiscardSession = useCallback(
    (session: RecoverableSession) => {
      setRecoverable((list) => list.filter((s) => s !== session));
      void deleteSessionById(session.manifest.sessionId);
      pushToast('Recording discarded.');
    },
    [pushToast],
  );

  const closeRecovered = useCallback(() => {
    setRecovered((current) => {
      if (current) {
        URL.revokeObjectURL(current.take.url);
        void deleteSessionById(current.sessionId);
      }
      return null;
    });
  }, []);

  const handleSaveRecovered = useCallback(async (): Promise<boolean> => {
    if (!recovered) return false;
    const boardId = recovered.boardId ?? boardIdRef.current;
    if (!boardId) return false;
    return saveTake({
      id: nextId('t'),
      boardId,
      title: lessonRef.current.title,
      blob: recovered.take.blob,
      mimeType: recovered.take.mimeType,
      extension: recovered.take.extension,
      durationMs: recovered.take.durationMs,
      createdAt: recovered.take.createdAt,
    });
  }, [recovered]);

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
      if (!result.profile.smokeOk) {
        // Compatibility mode: the smoke test failed but only missing APIs
        // hard-block — let the real recorder be the judge.
        pushToast(
          result.profile.warnings[0] ??
            'The device check could not verify recording — trying anyway.',
        );
      }
      // A gated preset can outlive a re-probe that says no — drop back.
      if (presetRef.current.needsPerformance && !result.profile.supports1080p) {
        presetRef.current = presetById('compat');
        updateSettings({ presetId: 'compat' });
        pushToast('Dropped to 720p — this device failed the 1080p performance check.');
      }
      // SPEC §6.6: check storage headroom before recording, warn — don't block.
      try {
        const est = await navigator.storage?.estimate?.();
        if (est?.quota && est.quota - (est.usage ?? 0) < 200 * 1024 * 1024) {
          pushToast('Device storage is low — long recordings may not save.');
        }
      } catch {
        // Estimate is a nicety only.
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
    flipPage: (_dir: -1 | 1) => {},
  });
  keyActionsRef.current = {
    camera: handleCameraButton,
    mic: handleMicButton,
    recorderPhase: recorder.phase,
    pauseResume: () => {
      if (recorder.phase === 'recording') recorder.pause();
      else if (recorder.phase === 'paused') recorder.resume();
    },
    flipPage: (dir: -1 | 1) => openPage(pagesRef.current.activeIndex + dir),
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
        case 'r':
          setTool('shape');
          break;
        case 't':
          setTool('text');
          break;
        case 's':
          setTool('select');
          break;
        case 'delete':
        case 'backspace':
          engineRef.current?.deleteSelection();
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
        case 'pageup':
          // Flip slides — deliberately allowed while recording.
          e.preventDefault();
          keyActionsRef.current.flipPage(-1);
          break;
        case 'pagedown':
          e.preventDefault();
          keyActionsRef.current.flipPage(1);
          break;
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
            onReplayTour={() => setOnboardingOpen(true)}
          />
        }
        onLibrary={activeBoardId ? handleOpenTakes : undefined}
        onImportFiles={activeBoardId ? handleImportFiles : undefined}
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

      <main
        className="viewport"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault();
        }}
        onDrop={(e) => {
          const files = [...e.dataTransfer.files];
          if (files.length === 0) return;
          e.preventDefault();
          handleImportFiles(files);
        }}
      >
        <div className="stage-fit" ref={fitRef}>
          <div className={stageClasses} style={{ transform: `scale(${scale})` }}>
            <StageCanvas
              background={background}
              tool={tool}
              color={color}
              width={width}
              shapeKind={shapeKind}
              onReady={handleEngineReady}
              onHistoryChange={handleHistoryChange}
              onCommit={handleCommit}
              onTextEdit={handleTextEdit}
              onSelectionChange={handleSelectionChange}
            />
            {selection && selection.images.length > 0 && selection.bbox && nav &&
              tool === 'select' && (
                <SelectionActions
                  viewport={nav.viewport}
                  bbox={selection.bbox}
                  locked={selection.images.every((im) => im.locked === true)}
                  onToggleLock={() =>
                    engineRef.current?.setLockedSelection(
                      !selection.images.every((im) => im.locked === true),
                    )
                  }
                />
              )}
            {textEdit && nav && (
              <TextEditorOverlay
                key={textEdit.element?.id ?? `${textEdit.world.x},${textEdit.world.y}`}
                request={textEdit}
                viewport={nav.viewport}
                color={color}
                fontSize={width * 8}
                onCommit={commitText}
                onCancel={cancelText}
              />
            )}
            {camera.stream && cameraVisible && (
              <CameraOverlay
                stream={camera.stream}
                layout={cameraLayout}
                layoutRef={cameraLayoutRef}
                scaleRef={scaleRef}
                videoElRef={videoElRef}
                recording={recordingActive}
                cutoutState={cutout.state}
                cutoutBlocked={cutout.blocked}
                getCutoutCanvas={getCutoutCanvas}
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

        {nav && activeBoardId && (
          <PageStrip
            getPages={() => pagesRef.current.pages}
            activeIndex={pageInfo.activeIndex}
            revision={pageInfo.revision}
            inkRevision={inkRevision}
            engine={nav.engine}
            background={background}
            onOpen={openPage}
            onAdd={addPage}
            onDuplicate={duplicatePage}
            onDelete={deletePage}
            onMove={movePage}
          />
        )}

        <Toolbar
          tool={tool}
          color={color}
          width={width}
          background={background}
          shapeKind={shapeKind}
          canUndo={history.undo}
          canRedo={history.redo}
          collapsed={collapsed}
          onTool={setTool}
          onColor={setColor}
          onWidth={setWidth}
          onBackground={setBackground}
          onShapeKind={setShapeKind}
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

      {recoverable.length > 0 && recorder.phase === 'idle' && !recovered && (
        <RecoveryCard
          sessions={recoverable}
          onRecover={(s) => void handleRecoverSession(s)}
          onDiscard={handleDiscardSession}
        />
      )}

      {/* Crash recovery outranks the welcome tour; on a true first launch
          there is never a recoverable session, so the tour shows directly. */}
      {onboardingOpen &&
        recoverable.length === 0 &&
        !recovered &&
        !recorder.take &&
        recorder.phase === 'idle' && (
          <OnboardingModal
            onClose={() => {
              markOnboardingSeen();
              setOnboardingOpen(false);
            }}
          />
        )}

      {recovered && (
        <PreviewModal
          take={recovered.take}
          title={title}
          onTitle={setTitle}
          onClose={closeRecovered}
          onDelete={() => {
            closeRecovered();
            pushToast('Recording discarded.');
          }}
          onSaveToLibrary={activeBoardId || recovered.boardId ? handleSaveRecovered : undefined}
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

      {pdfProgress && (
        <div className="pdf-progress" role="status" aria-live="polite">
          <div className="pdf-progress-card">
            <span className="spinner" aria-hidden="true" />
            {pdfProgress.total > 0
              ? `Importing PDF — page ${pdfProgress.done} / ${pdfProgress.total}`
              : 'Reading PDF…'}
          </div>
        </div>
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
