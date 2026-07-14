import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { RecorderPhase } from '../recording/useRecorder';
import { CameraIcon, CameraOffIcon, LibraryIcon, MicIcon, MicOffIcon } from './icons';

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
  /** Opens the saved-takes drawer; absent when takes can't persist. */
  onLibrary?: () => void;
  micEnabled: boolean;
  micMuted: boolean;
  onMic(): void;
  cameraEnabled: boolean;
  cameraVisible: boolean;
  onCamera(): void;
  phase: RecorderPhase;
  elapsedMs: number;
  onRecord(): void;
  onCancelCountdown(): void;
  onStop(): void;
}

export function TopBar(props: TopBarProps) {
  const [confirmStop, setConfirmStop] = useState(false);
  const { phase } = props;
  const recordingActive = phase === 'recording' || phase === 'stopping';

  useEffect(() => {
    if (phase !== 'recording') setConfirmStop(false);
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
        Scratchy
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
            <button type="button" className="record-btn" onClick={props.onRecord}>
              <span className="rec-dot" aria-hidden="true" />
              Record
            </button>
          )}
          {phase === 'countdown' && (
            <button type="button" className="record-btn counting" onClick={props.onCancelCountdown}>
              Starting… tap to cancel
            </button>
          )}
          {recordingActive && (
            <>
              <span className="rec-live" aria-hidden="true" />
              <span className="timer" role="timer" aria-label="Recording time">
                {formatDuration(props.elapsedMs)}
              </span>
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
              {confirmStop && phase === 'recording' && (
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
