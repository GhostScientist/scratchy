import { nextId, DEFAULT_CAMERA_LAYOUT, DEFAULT_VIEWPORT } from '../types';
import { loadLesson } from './autosave';
import type { SavedLesson } from './autosave';
import {
  idbAvailable,
  idbGet,
  idbGetAll,
  idbPut,
  idbDelete,
  STORE_BOARDS,
  STORE_TAKES,
  STORE_META,
} from './db';

/** A lesson stored in IndexedDB: one of possibly many named boards. */
export interface SavedBoard extends Omit<SavedLesson, 'version'> {
  version: 3;
  id: string;
}

export interface BoardMeta {
  id: string;
  title: string;
  updatedAt: number;
  strokeCount: number;
}

/** A recorded take kept in the library. Blobs store natively in IDB. */
export interface StoredTake {
  id: string;
  boardId: string;
  title: string;
  blob: Blob;
  mimeType: string;
  extension: string;
  durationMs: number;
  createdAt: number;
}

const ACTIVE_KEY = 'activeBoardId';

function blankBoard(): SavedBoard {
  return {
    version: 3,
    id: nextId('b'),
    title: 'Untitled lesson',
    background: 'white',
    tool: 'pen',
    color: '#1d1f24',
    width: 4,
    cameraLayout: { ...DEFAULT_CAMERA_LAYOUT },
    viewport: { ...DEFAULT_VIEWPORT },
    strokes: [],
    updatedAt: Date.now(),
  };
}

function toMeta(board: SavedBoard): BoardMeta {
  return {
    id: board.id,
    title: board.title,
    updatedAt: board.updatedAt,
    strokeCount: board.strokes.length,
  };
}

function sortMeta(metas: BoardMeta[]): BoardMeta[] {
  return metas.sort((a, b) => b.updatedAt - a.updatedAt);
}

let initPromise: Promise<{ board: SavedBoard; boards: BoardMeta[] } | null> | null = null;

/**
 * Open the board store and return the active board plus the board list, or
 * null when IndexedDB is unavailable/broken (caller falls back to the
 * single-lesson localStorage path). On the very first run the existing
 * localStorage lesson is imported as a board; the localStorage copy is only
 * removed once that import write has succeeded.
 *
 * The result is memoized: StrictMode double-mounts (and any other repeat
 * caller) share one initialization instead of racing to create duplicate
 * first boards.
 */
export function initBoards(): Promise<{ board: SavedBoard; boards: BoardMeta[] } | null> {
  if (!initPromise) {
    initPromise = doInitBoards();
    // A failed init may be transient — let the next call retry.
    void initPromise.then((r) => {
      if (r === null) initPromise = null;
    });
  }
  return initPromise;
}

async function doInitBoards(): Promise<{ board: SavedBoard; boards: BoardMeta[] } | null> {
  if (!idbAvailable()) return null;
  try {
    let boards = await idbGetAll<SavedBoard>(STORE_BOARDS);

    if (boards.length === 0) {
      const legacy = loadLesson();
      const first: SavedBoard = legacy
        ? { ...legacy, version: 3, id: nextId('b') }
        : blankBoard();
      await idbPut(STORE_BOARDS, first);
      await idbPut(STORE_META, first.id, ACTIVE_KEY);
      if (legacy) {
        localStorage.removeItem('scratchy.lesson.v2');
        localStorage.removeItem('scratchy.lesson.v1');
      }
      boards = [first];
    }

    const activeId = await idbGet<string>(STORE_META, ACTIVE_KEY);
    const metas = sortMeta(boards.map(toMeta));
    const board = boards.find((b) => b.id === activeId) ?? boards.find((b) => b.id === metas[0].id)!;
    if (board.id !== activeId) await idbPut(STORE_META, board.id, ACTIVE_KEY);
    return { board, boards: metas };
  } catch {
    return null;
  }
}

export async function saveBoard(board: SavedBoard): Promise<boolean> {
  try {
    await idbPut(STORE_BOARDS, board);
    return true;
  } catch {
    return false;
  }
}

export async function loadBoard(id: string): Promise<SavedBoard | null> {
  try {
    return (await idbGet<SavedBoard>(STORE_BOARDS, id)) ?? null;
  } catch {
    return null;
  }
}

export async function listBoards(): Promise<BoardMeta[]> {
  try {
    return sortMeta((await idbGetAll<SavedBoard>(STORE_BOARDS)).map(toMeta));
  } catch {
    return [];
  }
}

export async function createBoard(): Promise<SavedBoard | null> {
  const board = blankBoard();
  if (!(await saveBoard(board))) return null;
  await setActiveBoard(board.id);
  return board;
}

/** Delete a board and every take recorded on it. */
export async function deleteBoard(id: string): Promise<void> {
  try {
    await idbDelete(STORE_BOARDS, id);
    const takes = await idbGetAll<StoredTake>(STORE_TAKES);
    for (const take of takes) {
      if (take.boardId === id) await idbDelete(STORE_TAKES, take.id);
    }
  } catch {
    // Best effort — a failed delete leaves the board listed.
  }
}

export async function setActiveBoard(id: string): Promise<void> {
  try {
    await idbPut(STORE_META, id, ACTIVE_KEY);
  } catch {
    // Non-fatal: the next launch just opens the most recent board.
  }
}

// ---- takes ---------------------------------------------------------------

export async function saveTake(take: StoredTake): Promise<boolean> {
  try {
    await idbPut(STORE_TAKES, take);
    return true;
  } catch {
    return false;
  }
}

export async function listTakes(boardId: string): Promise<StoredTake[]> {
  try {
    const all = await idbGetAll<StoredTake>(STORE_TAKES);
    return all.filter((t) => t.boardId === boardId).sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export async function deleteTake(id: string): Promise<void> {
  try {
    await idbDelete(STORE_TAKES, id);
  } catch {
    // Best effort.
  }
}

// Test hook: lets e2e tests seed boards/takes without driving MediaRecorder.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__scratchyBoards = {
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
  };
}
