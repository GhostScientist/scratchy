import { formatDuration } from './TopBar';
import type { RecoverableSession } from '../recording/RecordingStore';

interface RecoveryCardProps {
  sessions: RecoverableSession[];
  onRecover(session: RecoverableSession): void;
  onDiscard(session: RecoverableSession): void;
}

/** Startup surface for recordings interrupted by a crash or reload. */
export function RecoveryCard(props: RecoveryCardProps) {
  return (
    <div className="recovery-card" role="dialog" aria-label="Interrupted recordings">
      <h3>Interrupted recording{props.sessions.length > 1 ? 's' : ''} found</h3>
      <p className="recovery-sub">
        The app closed while recording. The video captured up to that point can be recovered.
      </p>
      {props.sessions.map((session) => (
        <div key={session.manifest.sessionId} className="recovery-row">
          <div className="recovery-info">
            <strong>{session.manifest.title || 'Untitled lesson'}</strong>
            <span>
              {formatDuration(session.manifest.activeMs)} ·{' '}
              {(session.sizeBytes / (1024 * 1024)).toFixed(1)} MB ·{' '}
              {new Date(session.manifest.startedAt).toLocaleString()}
            </span>
          </div>
          <button
            type="button"
            className="btn primary small"
            onClick={() => props.onRecover(session)}
          >
            Recover
          </button>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => props.onDiscard(session)}
          >
            Discard
          </button>
        </div>
      ))}
    </div>
  );
}
