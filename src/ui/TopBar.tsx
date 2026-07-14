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
}

export function TopBar(props: TopBarProps) {
  const [confirmStop, setConfirmStop] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { phase } = props;
  const recordingActive = phase === 'recording' || phase === 'paused' || phase === 'stopping';

  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') setConfirmStop(false);
  }, [phase]);

  const micLabel = !props.micEnabled
    ? 'Enable microphone (M)'
    : props.micMuted
      ? 'Unmute microphone (M)'
      : recordingActive
        ? 'Mute microphone (M)'
        : 'Turn microphone off (M)';

  const cameraLabel = !props.cameraEnabled
    ? 'Enable camera (C)'
    : recordingActive
      ? props.cameraVisible
        ? 'Hide camera (C)'
        : 'Show camera (C)'
      : 'Turn camera off (C)';

  return (
    <header className="topbar">
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

      <div className="top-actions">
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
              className="pill"
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
            className="pill"
            aria-label="Saved takes"
            title="Saved takes"
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

        <div className="record-cluster">
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
              {phase === 'paused' ? (
                <span className="paused-label">Paused</span>
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
