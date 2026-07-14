import { useEffect, useState } from 'react';
import type { StoredTake } from '../persistence/boards';
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
  const [url, setUrl] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  const filename = `${take.title || 'take'}${take.extension}`;

  return (
    <div className="take-row">
      <button
        type="button"
        className="take-open"
        aria-expanded={url !== null}
        onClick={() => setUrl((u) => (u ? null : URL.createObjectURL(take.blob)))}
      >
        <span className="take-title">{take.title || 'Untitled take'}</span>
        <span className="take-meta">
          {stamp(take.createdAt)} · {formatDuration(take.durationMs)} · {mb(take.blob.size)} MB
        </span>
      </button>
      {url && (
        <>
          <video className="take-video" src={url} controls playsInline />
          <div className="take-actions">
            <a className="btn ghost small" href={url} download={filename}>
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
