/**
 * Incremental recording persistence (SPEC §6.6). Chunks are written to
 * IndexedDB as MediaRecorder delivers them, alongside a manifest that is
 * touched on every append — so an ordinary reload or crash leaves a
 * recoverable session behind. Clean stops delete their session, which makes
 * "any session present at startup" the recovery signal.
 *
 * IndexedDB is the only persistent adapter for now (the SPEC prefers OPFS
 * but flags its iPad stability as an open question, and the existing
 * Safari-hardened IDB wrapper already stores Blobs natively at the 1 chunk/s
 * rate this produces). The interface leaves room for an OPFS adapter later;
 * a memory adapter keeps recording working when IndexedDB is unavailable.
 */

import {
  idbAvailable,
  idbGet,
  idbGetAll,
  idbGetAllRange,
  idbPut,
  idbDelete,
  idbDeleteRange,
  STORE_REC_SESSIONS,
  STORE_REC_CHUNKS,
} from '../persistence/db';

export interface RecordingManifest {
  sessionId: string;
  boardId: string | null;
  title: string;
  mimeType: string;
  extension: string;
  presetId: string;
  startedAt: number;
  /** Heartbeat — bumped on every chunk append and state change. */
  updatedAt: number;
  state: 'recording' | 'paused' | 'stopping';
  chunkCount: number;
  /** Active (unpaused) duration so far. */
  activeMs: number;
}

export interface RecoverableSession {
  manifest: RecordingManifest;
  sizeBytes: number;
}

export interface RecordingStore {
  /** false → chunks live in memory only and nothing survives a reload. */
  readonly persistent: boolean;
  createSession(manifest: RecordingManifest): Promise<void>;
  appendChunk(sessionId: string, index: number, blob: Blob): Promise<void>;
  updateManifest(manifest: RecordingManifest): Promise<void>;
  /** Assemble the session's chunks, in order, into one playable Blob. */
  finalizeSession(sessionId: string, mimeType: string): Promise<Blob>;
  deleteSession(sessionId: string): Promise<void>;
}

interface ChunkRow {
  sessionId: string;
  index: number;
  blob: Blob;
}

/** All keys of one session: [id] < [id, 0] < … < [id, []] in IDB key order. */
function sessionRange(sessionId: string): IDBKeyRange {
  return IDBKeyRange.bound([sessionId], [sessionId, []]);
}

class IdbRecordingStore implements RecordingStore {
  readonly persistent = true;
  /** Chunks that failed to persist — kept in memory so the take survives. */
  private overflow = new Map<string, ChunkRow[]>();
  private broken = new Set<string>();

  constructor(private onPersistFailure?: () => void) {}

  async createSession(manifest: RecordingManifest): Promise<void> {
    try {
      await idbPut(STORE_REC_SESSIONS, manifest);
    } catch {
      this.markBroken(manifest.sessionId);
    }
  }

  async appendChunk(sessionId: string, index: number, blob: Blob): Promise<void> {
    const row: ChunkRow = { sessionId, index, blob };
    if (this.broken.has(sessionId)) {
      this.overflow.get(sessionId)!.push(row);
      return;
    }
    try {
      await idbPut(STORE_REC_CHUNKS, row);
    } catch {
      // SPEC §13: keep recording when persistence fails — accumulate in
      // memory for the rest of the take and warn once.
      this.markBroken(sessionId);
      this.overflow.get(sessionId)!.push(row);
    }
  }

  async updateManifest(manifest: RecordingManifest): Promise<void> {
    if (this.broken.has(manifest.sessionId)) return;
    try {
      await idbPut(STORE_REC_SESSIONS, manifest);
    } catch {
      this.markBroken(manifest.sessionId);
    }
  }

  async finalizeSession(sessionId: string, mimeType: string): Promise<Blob> {
    let rows: ChunkRow[] = [];
    try {
      rows = await idbGetAllRange<ChunkRow>(STORE_REC_CHUNKS, sessionRange(sessionId));
    } catch {
      // Persisted chunks unreadable — the overflow may still have everything.
    }
    const extra = this.overflow.get(sessionId) ?? [];
    const all = [...rows, ...extra].sort((a, b) => a.index - b.index);
    return new Blob(
      all.map((r) => r.blob),
      { type: mimeType },
    );
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.overflow.delete(sessionId);
    this.broken.delete(sessionId);
    try {
      await idbDeleteRange(STORE_REC_CHUNKS, sessionRange(sessionId));
      await idbDelete(STORE_REC_SESSIONS, sessionId);
    } catch {
      // Best effort — an orphaned session resurfaces as recoverable and can
      // be discarded there.
    }
  }

  private markBroken(sessionId: string): void {
    if (this.broken.has(sessionId)) return;
    this.broken.add(sessionId);
    if (!this.overflow.has(sessionId)) this.overflow.set(sessionId, []);
    this.onPersistFailure?.();
  }
}

class MemoryRecordingStore implements RecordingStore {
  readonly persistent = false;
  private sessions = new Map<string, ChunkRow[]>();

  async createSession(manifest: RecordingManifest): Promise<void> {
    this.sessions.set(manifest.sessionId, []);
  }

  async appendChunk(sessionId: string, index: number, blob: Blob): Promise<void> {
    let rows = this.sessions.get(sessionId);
    if (!rows) {
      rows = [];
      this.sessions.set(sessionId, rows);
    }
    rows.push({ sessionId, index, blob });
  }

  async updateManifest(): Promise<void> {
    // Nothing to persist.
  }

  async finalizeSession(sessionId: string, mimeType: string): Promise<Blob> {
    const rows = [...(this.sessions.get(sessionId) ?? [])].sort((a, b) => a.index - b.index);
    return new Blob(
      rows.map((r) => r.blob),
      { type: mimeType },
    );
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}

export function createRecordingStore(onPersistFailure?: () => void): RecordingStore {
  return idbAvailable()
    ? new IdbRecordingStore(onPersistFailure)
    : new MemoryRecordingStore();
}

// ---- startup recovery ------------------------------------------------------

/** Sessions left behind by a crash/reload. Empty sessions are swept silently. */
export async function recoverSessions(): Promise<RecoverableSession[]> {
  if (!idbAvailable()) return [];
  try {
    const manifests = await idbGetAll<RecordingManifest>(STORE_REC_SESSIONS);
    const out: RecoverableSession[] = [];
    for (const manifest of manifests) {
      const rows = await idbGetAllRange<ChunkRow>(
        STORE_REC_CHUNKS,
        sessionRange(manifest.sessionId),
      );
      const sizeBytes = rows.reduce((sum, r) => sum + r.blob.size, 0);
      if (sizeBytes === 0) {
        await deleteSessionById(manifest.sessionId);
      } else {
        out.push({ manifest, sizeBytes });
      }
    }
    return out.sort((a, b) => b.manifest.startedAt - a.manifest.startedAt);
  } catch {
    return [];
  }
}

export async function assembleSession(sessionId: string): Promise<Blob | null> {
  try {
    const manifest = await idbGet<RecordingManifest>(STORE_REC_SESSIONS, sessionId);
    const rows = await idbGetAllRange<ChunkRow>(STORE_REC_CHUNKS, sessionRange(sessionId));
    if (rows.length === 0) return null;
    return new Blob(
      rows.map((r) => r.blob),
      { type: manifest?.mimeType ?? '' },
    );
  } catch {
    return null;
  }
}

export async function deleteSessionById(sessionId: string): Promise<void> {
  try {
    await idbDeleteRange(STORE_REC_CHUNKS, sessionRange(sessionId));
    await idbDelete(STORE_REC_SESSIONS, sessionId);
  } catch {
    // Best effort.
  }
}

// Test hook: lets e2e tests inspect sessions/chunks without a debugger.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__scratchyRecStore = {
    recoverSessions,
    assembleSession,
    deleteSessionById,
    listSessions: () => idbGetAll<RecordingManifest>(STORE_REC_SESSIONS),
    countChunks: async (sessionId: string) =>
      (await idbGetAllRange<ChunkRow>(STORE_REC_CHUNKS, sessionRange(sessionId))).length,
  };
}
