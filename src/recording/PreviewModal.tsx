import { useEffect, useRef, useState } from 'react';
import type { Take } from '../types';
import { formatDuration } from '../ui/TopBar';
import { DownloadIcon, UndoIcon, RedoIcon } from '../ui/icons';
import { downloadBlob } from '../export/png';
import { editTake } from './editTake';
import type { TakeEdits } from './editTake';

interface PreviewModalProps {
  take: Take;
  title: string;
  onTitle(title: string): void;
  onClose(): void;
  onDelete(): void;
  onSaveToLibrary?: (take: Take) => Promise<boolean>;
  copy?: boolean;
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'lesson';
}

function stamp(createdAt: number): string {
  const d = new Date(createdAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

const sameEdits = (a: TakeEdits, b: TakeEdits) =>
  a.start === b.start && a.end === b.end && a.muted === b.muted;

export function PreviewModal(props: PreviewModalProps) {
  const { take } = props;
  const [duration, setDuration] = useState(take.durationMs / 1000);
  const [ready, setReady] = useState(false);
  const [history, setHistory] = useState<{
    past: TakeEdits[]; present: TakeEdits; future: TakeEdits[];
  }>({ past: [], present: { start: 0, end: duration, muted: false }, future: [] });
  const { present: edits } = history;
  const [playhead, setPlayhead] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'failed'>('idle');
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<'rendering' | 'saving'>('rendering');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [deliveredKey, setDeliveredKey] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<{ key: string; take: Take } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const groupedRef = useRef(false);
  const groupChangedRef = useRef(false);
  const renderedRef = useRef<{ key: string; take: Take } | null>(null);
  const editKey = JSON.stringify(edits);
  const dirty = ready && (edits.start > 0 || edits.end < duration || edits.muted);
  const closeRef = useRef(() => { });
  closeRef.current = () => {
    if (busyRef.current) return;
    if (dirty && deliveredKey !== editKey && !confirmLeave) setConfirmLeave(true);
    else props.onClose();
  };

  useEffect(() => {
    const previous = document.activeElement;
    modalRef.current?.querySelector<HTMLElement>('h2')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
      if (e.key !== 'Tab') return;
      const focusable = Array.from(modalRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), video, [tabindex="0"]',
      ) ?? []);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement as HTMLElement))) {
        e.preventDefault(); last?.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !focusable.includes(document.activeElement as HTMLElement))) {
        e.preventDefault(); first?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      abortRef.current?.abort();
      if (renderedRef.current) URL.revokeObjectURL(renderedRef.current.take.url);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    if (!confirmDelete) return;
    const t = window.setTimeout(() => setConfirmDelete(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirmDelete]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let frame = 0;
    const enforceEnd = () => {
      if (!video.paused && video.currentTime >= edits.end) {
        video.pause();
        video.currentTime = edits.end;
        setPlayhead(edits.end);
      }
    };
    const tick = () => {
      enforceEnd();
      if (!video.paused) frame = requestAnimationFrame(tick);
    };
    const watch = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };
    video.addEventListener('play', watch);
    video.addEventListener('timeupdate', enforceEnd);
    if (!video.paused) watch();
    return () => {
      cancelAnimationFrame(frame);
      video.removeEventListener('play', watch);
      video.removeEventListener('timeupdate', enforceEnd);
    };
  }, [edits.end]);

  const change = (patch: Partial<TakeEdits>) => {
    if (sameEdits({ ...edits, ...patch }, edits)) return;
    const coalesce = groupedRef.current && groupChangedRef.current;
    if (groupedRef.current) groupChangedRef.current = true;
    setHistory((current) => {
      const next = { ...current.present, ...patch };
      if (sameEdits(next, current.present)) return current;
      return {
        past: coalesce
          ? current.past : [...current.past, current.present].slice(-100),
        present: next, future: [],
      };
    });
    setSaveState('idle');
    setConfirmLeave(false);
    setError(null);
  };
  const beginGroup = () => { groupedRef.current = true; groupChangedRef.current = false; };
  const endGroup = () => { groupedRef.current = false; groupChangedRef.current = false; };
  const undo = () => {
    endGroup();
    setHistory((current) => {
      const previous = current.past.at(-1);
      return previous ? {
        past: current.past.slice(0, -1), present: previous,
        future: [current.present, ...current.future],
      } : current;
    });
    setSaveState('idle');
    setConfirmLeave(false);
    setError(null);
  };
  const redo = () => {
    endGroup();
    setHistory((current) => {
      const next = current.future[0];
      return next ? {
        past: [...current.past, current.present], present: next, future: current.future.slice(1),
      } : current;
    });
    setSaveState('idle');
    setConfirmLeave(false);
    setError(null);
  };
  const filename = (extension: string) =>
    `${slugify(props.title)}${dirty ? ' edited' : ''} ${stamp(take.createdAt)}${extension}`;
  const getDeliverable = async (): Promise<Take> => {
    if (!dirty) return take;
    if (renderedRef.current?.key === editKey) return renderedRef.current.take;
    const controller = new AbortController();
    abortRef.current = controller;
    const result = await editTake(take, edits, controller.signal, (value) => {
      setProgress((previous) => Math.round(previous * 100) === Math.round(value * 100) ? previous : value);
    });
    if (renderedRef.current) URL.revokeObjectURL(renderedRef.current.take.url);
    const delivered = { ...result, url: URL.createObjectURL(result.blob) };
    renderedRef.current = { key: editKey, take: delivered };
    setPrepared(renderedRef.current);
    return delivered;
  };
  const deliver = async (toLibrary: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setProgress(0); setError(null);
    setJob(dirty ? 'rendering' : 'saving');
    videoRef.current?.pause();
    try {
      const result = await getDeliverable();
      if (toLibrary) {
        abortRef.current = null;
        setJob('saving');
        if (!await props.onSaveToLibrary?.(result)) throw new Error('Could not save this take. Device storage may be full.');
        setSaveState('saved');
      } else {
        downloadBlob(result.blob, filename(result.extension));
      }
      setDeliveredKey(editKey);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('Export cancelled. Your original recording and edits are still here.');
      } else {
        setError(err instanceof Error ? err.message : 'Export failed. Your original recording is unchanged.');
        if (toLibrary) setSaveState('failed');
      }
    } finally {
      busyRef.current = false;
      abortRef.current = null;
      setBusy(false);
    }
  };
  const minLength = Math.min(0.1, duration);
  const setStart = (value: number) => {
    if (Number.isFinite(value)) change({ start: Math.max(0, Math.min(value, edits.end - minLength)) });
  };
  const setEnd = (value: number) => {
    if (Number.isFinite(value)) change({ end: Math.min(duration, Math.max(value, edits.start + minLength)) });
  };

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="Recording preview">
      <div className="modal video-editor" ref={modalRef} onKeyDown={(e) => {
        if (busy || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
        if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;
        e.preventDefault(); e.stopPropagation();
        if (e.shiftKey) redo(); else undo();
      }}>
        <header className="modal-head">
          <h2 tabIndex={-1}>{props.copy ? 'Edit a saved take' : 'Your take is ready'}</h2>
          <p className="modal-sub">Trim the ends or remove audio. Your original stays unchanged.</p>
        </header>
        <video ref={videoRef} className="modal-video" src={take.url} controls playsInline
          muted={edits.muted} tabIndex={0}
          onLoadedMetadata={(e) => {
            const value = e.currentTarget.duration;
            if (Number.isFinite(value) && value > 0) {
              setDuration(value);
              setHistory({ past: [], present: { start: 0, end: value, muted: false }, future: [] });
              setReady(true);
            } else {
              setError('This recording has no seekable duration. You can still download the original.');
            }
          }}
          onError={() => setError('This browser cannot play this recording. Download the original to keep it.')}
          onPlay={(e) => {
            if (e.currentTarget.currentTime < edits.start || e.currentTarget.currentTime >= edits.end) {
              e.currentTarget.currentTime = edits.start;
            }
          }}
          onTimeUpdate={(e) => {
            setPlayhead(e.currentTarget.currentTime);
          }} />
        <fieldset className="trim-controls" disabled={!ready || busy}>
          <legend>Keep this range</legend>
          <div className="trim-timeline" aria-hidden="true">
            <div style={{ left: `${edits.start / duration * 100}%`, width: `${(edits.end - edits.start) / duration * 100}%` }} />
            <span style={{ left: `${Math.min(playhead / duration, 1) * 100}%` }} />
          </div>
          <div className="trim-fields">
            <label>Start (seconds)
              <input type="number" aria-label="Trim start" min={0} max={edits.end - minLength}
                step="0.1" value={Number(edits.start.toFixed(3))}
                onFocus={beginGroup} onBlur={endGroup}
                onChange={(e) => setStart(e.target.valueAsNumber)} />
              <input type="range" aria-label="Trim start slider" min={0} max={duration}
                step="0.01" value={edits.start} onPointerDown={beginGroup} onPointerUp={endGroup}
                onPointerCancel={endGroup} onKeyDown={beginGroup} onKeyUp={endGroup} onBlur={endGroup}
                onChange={(e) => setStart(Number(e.target.value))} />
            </label>
            <label>End (seconds)
              <input type="number" aria-label="Trim end" min={edits.start + minLength} max={duration}
                step="0.1" value={Number(edits.end.toFixed(3))}
                onFocus={beginGroup} onBlur={endGroup}
                onChange={(e) => setEnd(e.target.valueAsNumber)} />
              <input type="range" aria-label="Trim end slider" min={0} max={duration}
                step="0.01" value={edits.end} onPointerDown={beginGroup} onPointerUp={endGroup}
                onPointerCancel={endGroup} onKeyDown={beginGroup} onKeyUp={endGroup} onBlur={endGroup}
                onChange={(e) => setEnd(Number(e.target.value))} />
            </label>
          </div>
          <p className="trim-summary">{(edits.end - edits.start).toFixed(2)}s selected of {duration.toFixed(2)}s</p>
          <div className="edit-actions">
            <button type="button" className="btn ghost" onClick={() => {
              const video = videoRef.current;
              if (!video) return;
              video.currentTime = edits.start;
              void video.play().catch(() => setError('Playback could not start. Try the video play control.'));
            }}>Play selection</button>
            <button type="button" className="btn ghost" onClick={() => setStart(videoRef.current?.currentTime ?? playhead)}>Start here</button>
            <button type="button" className="btn ghost" onClick={() => setEnd(videoRef.current?.currentTime ?? playhead)}>End here</button>
            <button type="button" className="btn ghost" aria-pressed={edits.muted}
              onClick={() => change({ muted: !edits.muted })}>{edits.muted ? 'Restore audio' : 'Remove audio'}</button>
          </div>
          <div className="edit-actions">
            <button type="button" className="btn ghost" aria-label="Undo video edit"
              disabled={!history.past.length} onClick={undo}><UndoIcon />Undo</button>
            <button type="button" className="btn ghost" aria-label="Redo video edit"
              disabled={!history.future.length} onClick={redo}><RedoIcon />Redo</button>
            <button type="button" className="btn ghost" disabled={!dirty}
              onClick={() => change({ start: 0, end: duration, muted: false })}>Reset edits</button>
          </div>
        </fieldset>
        <input className="modal-title" value={props.title} onChange={(e) => props.onTitle(e.target.value)}
          aria-label="Take title" spellCheck={false} maxLength={80} disabled={busy} />
        <p className="modal-meta">
          {formatDuration(take.durationMs)} · {(take.blob.size / (1024 * 1024)).toFixed(1)} MB original · <code>{take.mimeType.split(';')[0]}</code>
        </p>
        {error && <p className="editor-error" role="alert">{error}</p>}
        {busy && <div className="export-progress" role="status">
          {job === 'saving' ? 'Saving on this device…' : `Preparing video… ${Math.round(progress * 100)}%`}
          {job === 'rendering' && <button type="button" className="btn ghost"
            onClick={() => abortRef.current?.abort()}>Cancel export</button>}
        </div>}
        {confirmLeave && <p className="editor-error" role="alert">These edits have not been exported. Go back to discard them.</p>}
        {dirty && prepared?.key === editKey && !busy && (
          <p className="modal-sub" role="status">Edited video ready. The original is unchanged.</p>
        )}
        <footer className="modal-actions">
          {dirty && prepared?.key === editKey ? (
            <a className="btn primary" href={prepared.take.url} download={filename(prepared.take.extension)}>
              <DownloadIcon />Download edited video
            </a>
          ) : dirty ? (
            <button type="button" className="btn primary" disabled={busy} onClick={() => void deliver(false)}>
              <DownloadIcon />Download edited video
            </button>
          ) : (
            <a className="btn primary" href={take.url} download={filename(take.extension)}><DownloadIcon />Download</a>
          )}
          {dirty && <a className="btn ghost" href={take.url}
            download={`${slugify(props.title)} original ${stamp(take.createdAt)}${take.extension}`}>
            Download original
          </a>}
          {props.onSaveToLibrary && <button type="button" className="btn ghost"
            disabled={busy || saveState === 'saved'} onClick={() => void deliver(true)}>
            {saveState === 'saved' ? 'Saved to library ✓' : saveState === 'failed' ? 'Save failed. Retry?' : props.copy ? 'Save copy to library' : 'Save to library'}
          </button>}
          <button type="button" disabled={busy} className={`btn ${confirmDelete ? 'danger' : 'ghost'}`}
            onClick={() => { if (confirmDelete) props.onDelete(); else setConfirmDelete(true); }}>
            {confirmDelete ? 'Really delete?' : props.copy ? 'Discard copy' : 'Delete take'}
          </button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => closeRef.current()}>
            {confirmLeave ? 'Discard edits and go back' : 'Back to board'}
          </button>
        </footer>
      </div>
    </div>
  );
}
