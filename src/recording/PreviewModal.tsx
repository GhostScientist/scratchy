import { useEffect, useState } from 'react';
import type { Take } from '../types';
import { formatDuration } from '../ui/TopBar';
import { DownloadIcon } from '../ui/icons';

interface PreviewModalProps {
  take: Take;
  title: string;
  onTitle(title: string): void;
  onClose(): void;
  onDelete(): void;
  /** Persist the take to the local library; absent when storage can't. */
  onSaveToLibrary?: () => Promise<boolean>;
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return slug || 'lesson';
}

function stamp(createdAt: number): string {
  const d = new Date(createdAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

export function PreviewModal(props: PreviewModalProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const { take } = props;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!confirmDelete) return;
    const t = window.setTimeout(() => setConfirmDelete(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirmDelete]);

  const filename = `${slugify(props.title)} ${stamp(take.createdAt)}${take.extension}`;
  const sizeMB = (take.blob.size / (1024 * 1024)).toFixed(1);
  const container = take.mimeType.split(';')[0];

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="Recording preview">
      <div className="modal">
        <header className="modal-head">
          <h2>Your take is ready</h2>
          <p className="modal-sub">Saved on this device only. Nothing was uploaded.</p>
        </header>

        {/* key forces a fresh element per take so stale frames never linger */}
        <video key={take.url} className="modal-video" src={take.url} controls playsInline />

        <input
          className="modal-title"
          value={props.title}
          onChange={(e) => props.onTitle(e.target.value)}
          aria-label="Take title"
          spellCheck={false}
          maxLength={80}
        />
        <p className="modal-meta">
          {formatDuration(take.durationMs)} &middot; {sizeMB} MB &middot; recorded as{' '}
          <code>{container}</code>
        </p>

        <footer className="modal-actions">
          <a className="btn primary" href={take.url} download={filename}>
            <DownloadIcon />
            Download
          </a>
          {props.onSaveToLibrary && (
            <button
              type="button"
              className="btn ghost"
              disabled={saveState === 'saving' || saveState === 'saved'}
              onClick={async () => {
                setSaveState('saving');
                setSaveState((await props.onSaveToLibrary!()) ? 'saved' : 'failed');
              }}
            >
              {saveState === 'saved'
                ? 'Saved to library ✓'
                : saveState === 'saving'
                  ? 'Saving…'
                  : saveState === 'failed'
                    ? 'Save failed. Retry?'
                    : 'Save to library'}
            </button>
          )}
          <button
            type="button"
            className={`btn ${confirmDelete ? 'danger' : 'ghost'}`}
            onClick={() => {
              if (confirmDelete) props.onDelete();
              else setConfirmDelete(true);
            }}
          >
            {confirmDelete ? 'Really delete?' : 'Delete take'}
          </button>
          <button type="button" className="btn ghost" onClick={props.onClose}>
            Back to board
          </button>
        </footer>
      </div>
    </div>
  );
}
