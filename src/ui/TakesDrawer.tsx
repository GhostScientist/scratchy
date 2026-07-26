import { useEffect, useState } from 'react';
import type { StoredTake } from '../persistence/boards';
import { saveTake } from '../persistence/boards';
import { remuxForDelivery } from '../recording/remux';
import { formatDuration } from './TopBar';
import { CloseIcon, DownloadIcon, TrashIcon } from './icons';

interface TakesDrawerProps {
  takes: StoredTake[];
  /** navigator.storage.estimate() result, when the browser provides one. */
  estimate: { usage: number; quota: number } | null;
  onClose(): void;
  onDelete(id: string): void;
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function stamp(createdAt: number): string {
  return new Date(createdAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** One take row; the blob only becomes an object URL while expanded. */
function TakeRow({ take, onDelete }: { take: StoredTake; onDelete(): void }) {
  const [open, setOpen] = useState(false);
  const [media, setMedia] = useState<{ url: string; filename: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) {
      setMedia(null);
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    void (async () => {
      let blob = take.blob;
      let extension = take.extension;
      // Takes stored before the seekable-remux fix are raw MediaRecorder
      // streams (no duration, "Live Broadcast" in Apple players). Heal them
      // once on first open — a lossless rewrite — and persist the fix.
      if (!take.seekable) {
        const fixed = await remuxForDelivery(blob);
        if (fixed) {
          blob = fixed.blob;
          extension = fixed.extension;
          void saveTake({
            ...take,
            blob: fixed.blob,
            mimeType: fixed.mimeType,
            extension: fixed.extension,
            seekable: true,
          });
        }
      }
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setMedia({ url, filename: `${take.title || 'take'}${extension}` });
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [open, take]);

  return (
    <div className="take-row">
      <button
        type="button"
        className="take-open"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="take-title">{take.title || 'Untitled take'}</span>
        <span className="take-meta">
          {stamp(take.createdAt)} · {formatDuration(take.durationMs)} · {mb(take.blob.size)} MB
        </span>
      </button>
      {media && (
        <>
          <video className="take-video" src={media.url} controls playsInline />
          <div className="take-actions">
            <a className="btn ghost small" href={media.url} download={media.filename}>
              <DownloadIcon />
              Download
            </a>
            <button
              type="button"
              className={`btn small ${confirmDelete ? 'danger' : 'ghost'}`}
              onClick={() => {
                if (confirmDelete) onDelete();
                else setConfirmDelete(true);
              }}
            >
              <TrashIcon />
              {confirmDelete ? 'Really delete?' : 'Delete'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function TakesDrawer(props: TakesDrawerProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <aside className="takes-drawer" role="dialog" aria-label="Saved takes">
      <header className="takes-head">
        <h2>Takes on this board</h2>
        <button type="button" className="pill" aria-label="Close takes" onClick={props.onClose}>
          <CloseIcon />
        </button>
      </header>
      {props.takes.length === 0 ? (
        <p className="takes-empty">
          Nothing saved yet. After recording, use “Save to library” to keep a take across
          reloads.
        </p>
      ) : (
        <div className="takes-list">
          {props.takes.map((take) => (
            <TakeRow key={take.id} take={take} onDelete={() => props.onDelete(take.id)} />
          ))}
        </div>
      )}
      {props.estimate && props.estimate.quota > 0 && (
        <footer className="takes-storage">
          {mb(props.estimate.usage)} MB of {mb(props.estimate.quota)} MB used on this device
        </footer>
      )}
    </aside>
  );
}
