import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { RecorderPhase } from '../recording/useRecorder';
import {
  CameraIcon,
  CameraOffIcon,
  LibraryIcon,
  MicIcon,
  MicOffIcon,
  PauseIcon,
  PlayIcon,
  UploadIcon,
  NotesIcon,
  FitIcon,
} from './icons';

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

interface TopBarProps {
  title: string;
  onTitle(title: string): void;
  /** Boards flyout, present when multi-board storage is available. */
  boardsSlot?: ReactNode;
  /** PNG export flyout. */
  exportSlot?: ReactNode;
  /** Device settings flyout (handedness, recording preset). */
  settingsSlot?: ReactNode;
  /** Opens the saved-takes drawer; absent when takes can't persist. */
  onLibrary?: () => void;
  /** Import images/PDFs; absent when assets can't persist (no IndexedDB). */
  onImportFiles?: (files: File[]) => void;
  micEnabled: boolean;
  micMuted: boolean;
  onMic(): void;
  micLocked: boolean;
  cameraEnabled: boolean;
  cameraVisible: boolean;
  onCamera(): void;
  phase: RecorderPhase;
  elapsedMs: number;
  /** True while the one-time capability probe runs before recording. */
  probing?: boolean;
  /** Absent (undefined) when pause is unsupported/unreliable on this device. */
  onPause?: () => void;
  onResume?: () => void;
  onRecord(): void;
  onCancelCountdown(): void;
  onStop(): void;
  notesOpen: boolean;
  onNotes(): void;
  focused: boolean;
  onFocus(): void;
}

export function TopBar(props: TopBarProps) {
  const [confirmStop, setConfirmStop] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const { phase } = props;
  const recordingActive = phase === 'recording' || phase === 'paused' || phase === 'stopping';
  const mediaActive = recordingActive || phase === 'countdown';

  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') setConfirmStop(false);
  }, [phase]);

  useEffect(() => {
    if (!moreOpen) return;
    const onOutside = (e: PointerEvent) => {
      if (!actionsRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onOutside, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  const micLabel = props.micLocked ? 'Microphone must be enabled before recording' : !props.micEnabled
    ? 'Enable microphone (M)'
    : props.micMuted
      ? 'Unmute microphone (M)'
      : mediaActive
        ? 'Mute microphone (M)'
        : 'Turn microphone off (M)';

  const cameraLabel = !props.cameraEnabled
    ? 'Enable camera (C)'
    : mediaActive
      ? props.cameraVisible
        ? 'Hide camera (C)'
        : 'Show camera (C)'
      : 'Turn camera off (C)';

  return (
    <header className={`topbar${recordingActive ? ' is-recording' : ''}`}>
      <div className="brand" aria-hidden="true">
        <span className="brand-dot" />
        <span>Scribble Party</span>
      </div>
      {props.boardsSlot}
      <input
        className="title-input"
        value={props.title}
        onChange={(e) => props.onTitle(e.target.value)}
        aria-label="Lesson title"
        spellCheck={false}
        maxLength={80}
      />

      <div className="top-actions" ref={actionsRef}>
        <button type="button" className="pill more-controls" aria-label="More controls"
          aria-expanded={moreOpen} aria-controls="board-actions"
          onClick={() => setMoreOpen(!moreOpen)}><span aria-hidden="true">•••</span></button>
        <div id="board-actions" className={`board-actions${moreOpen ? ' open' : ''}`}>
          <input className="mobile-title-input" value={props.title}
            onChange={(e) => props.onTitle(e.target.value)} aria-label="Lesson title"
            spellCheck={false} maxLength={80} />
          {props.onImportFiles && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                multiple
                hidden
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  // Allow re-picking the same file later.
                  e.target.value = '';
                  if (files.length > 0) props.onImportFiles?.(files);
                }}
              />
              <button
                type="button"
                className="pill import-pill"
                aria-label="Import image or PDF"
                title="Import image or PDF"
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadIcon />
              </button>
            </>
          )}
          {props.settingsSlot}
          {props.exportSlot}
          {props.onLibrary && (
            <button
              type="button"
              className="pill library-pill"
              aria-label="Saved takes"
              title="Saved takes"
              disabled={mediaActive}
              onClick={props.onLibrary}
            >
              <LibraryIcon />
            </button>
          )}
          <button
            type="button"
            className={`pill${props.micEnabled && !props.micMuted ? ' active' : ''}${props.micMuted ? ' muted' : ''}`}
            aria-label={micLabel}
            title={micLabel}
            onClick={props.onMic}
            disabled={props.micLocked}
          >
            {props.micEnabled && !props.micMuted ? <MicIcon /> : <MicOffIcon />}
            <span className="level" aria-hidden="true">
              <span className="level-fill" />
            </span>
          </button>

          <button
            type="button"
            className={`pill${props.cameraEnabled && props.cameraVisible ? ' active' : ''}`}
            aria-label={cameraLabel}
            title={cameraLabel}
            onClick={props.onCamera}
          >
            {props.cameraEnabled && props.cameraVisible ? <CameraIcon /> : <CameraOffIcon />}
          </button>
        </div>
        <button type="button" className={`pill notes-pill${props.notesOpen ? ' active' : ''}`}
          aria-label="Presenter notes" title="Presenter notes" aria-pressed={props.notesOpen}
          onClick={props.onNotes}><NotesIcon /></button>
        <button type="button" className={`pill focus-pill${props.focused ? ' active' : ''}`}
          aria-label={props.focused ? 'Exit focus mode' : 'Enter focus mode'}
          title={props.focused ? 'Exit focus mode' : 'Enter focus mode'}
          aria-pressed={props.focused} onClick={props.onFocus}><FitIcon /></button>

        <div className={`record-cluster${phase === 'paused' ? ' is-paused' : ''}`}>
          {(phase === 'idle' || phase === 'complete') && (
            <button
              type="button"
              className={`record-btn${props.probing ? ' counting' : ''}`}
              disabled={props.probing}
              onClick={props.onRecord}
            >
              {props.probing ? (
                'Checking device…'
              ) : (
                <>
                  <span className="rec-dot" aria-hidden="true" />
                  Record
                </>
              )}
            </button>
          )}
          {phase === 'countdown' && (
            <button type="button" className="record-btn counting" onClick={props.onCancelCountdown}>
              Starting… tap to cancel
            </button>
          )}
          {recordingActive && (
            <>
              {phase === 'stopping' ? (
                <span className="paused-label" role="status">Preparing…</span>
              ) : phase === 'paused' ? (
                <span className="paused-label" role="status">Paused</span>
              ) : (
                <span className="rec-live" aria-hidden="true" />
              )}
              <span
                className={`timer${phase === 'paused' ? ' paused' : ''}`}
                role="timer"
                aria-label="Recording time"
              >
                {formatDuration(props.elapsedMs)}
              </span>
              {props.onPause && props.onResume && phase !== 'stopping' && (
                <button
                  type="button"
                  className="pause-btn"
                  aria-label={
                    phase === 'paused' ? 'Resume recording (Space)' : 'Pause recording (Space)'
                  }
                  title={phase === 'paused' ? 'Resume recording (Space)' : 'Pause recording (Space)'}
                  onClick={phase === 'paused' ? props.onResume : props.onPause}
                >
                  {phase === 'paused' ? <PlayIcon /> : <PauseIcon />}
                </button>
              )}
              <button
                type="button"
                className="stop-btn"
                aria-label="Stop recording"
                title="Stop recording"
                disabled={phase === 'stopping'}
                onClick={() => setConfirmStop(true)}
              >
                <span className="stop-square" aria-hidden="true" />
              </button>
              {confirmStop && (phase === 'recording' || phase === 'paused') && (
                <div className="stop-confirm" role="alertdialog" aria-label="End recording?">
                  <span>End recording?</span>
                  <button type="button" className="btn danger small" onClick={props.onStop}>
                    End
                  </button>
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => setConfirmStop(false)}
                  >
                    Keep going
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
}
