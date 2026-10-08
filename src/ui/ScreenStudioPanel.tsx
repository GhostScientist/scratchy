import { useState } from 'react';
import type { RecorderApi } from '../recording/useRecorder';
import { formatDuration } from './TopBar';

export function ScreenStudioPanel(props: {
  sharing: boolean;
  busy: boolean;
  locked: boolean;
  ready: boolean;
  sourceName: string;
  sharedAudio: boolean;
  requestedAudio: boolean;
  onRequestedAudio(value: boolean): void;
  onShare(): void;
  onRelease(): void;
  floatingSupported: boolean;
  onFloat(): void;
}) {
  return <section className="screen-studio-panel" aria-label="Screen recording setup">
    <div className="screen-source-info">
      <strong>{props.sharing ? props.sourceName : 'Your screen. Your story.'}</strong>
      <span>{props.sharing
        ? `${props.ready ? 'Screen ready' : 'Preparing preview…'} · ${props.sharedAudio ? 'Shared audio included' : 'No shared audio'}`
        : 'Share a tab, window, or display, then add your camera and microphone.'}</span>
    </div>
    <div className="screen-setup-actions">
      <label className="screen-audio-choice"
        title={props.sharing ? 'Stop sharing to change the audio request, then choose a screen again.' : undefined}>
        <input type="checkbox" checked={props.requestedAudio} disabled={props.locked || props.busy || props.sharing}
          onChange={(event) => props.onRequestedAudio(event.target.checked)} />
        Request shared audio
      </label>
      <button type="button" className="btn primary" disabled={props.locked || props.busy} onClick={props.onShare}>
        {props.busy ? 'Choosing screen…' : props.sharing ? 'Change screen' : 'Share screen'}
      </button>
      {props.sharing && <button type="button" className="btn ghost" disabled={props.locked}
        onClick={props.onRelease}>Stop sharing</button>}
      {props.floatingSupported && props.sharing && <button type="button" className="btn ghost"
        onClick={props.onFloat}>Floating controls</button>}
    </div>
    <p className="screen-privacy">
      Choose another tab or window to avoid a hall-of-mirrors effect. Notifications and anything visible
      in your shared source will be recorded. Everything stays on this device.
      {' '}{props.floatingSupported
        ? 'Open floating controls before switching away; keep them outside the area you share.'
        : 'For smooth video, keep this recorder visible beside your shared window. Background or minimized tabs may slow down.'}
      {' '}Shared audio depends on your browser and source; enable it in the browser picker too.
    </p>
    {props.sharing && props.requestedAudio && !props.sharedAudio && <p className="screen-audio-warning" role="status">
      This source did not provide audio. Your enabled microphone will still be recorded.
    </p>}
  </section>;
}

export function FloatingRecorder({ recorder, onRecord, recordDisabled, micEnabled, micMuted,
  onMic, cameraEnabled, cameraVisible, onCamera, pauseReliable }: {
  recorder: RecorderApi;
  onRecord(): void;
  recordDisabled: boolean;
  micEnabled: boolean;
  micMuted: boolean;
  onMic(): void;
  cameraEnabled: boolean;
  cameraVisible: boolean;
  onCamera(): void;
  pauseReliable: boolean;
}) {
  const [confirmStop, setConfirmStop] = useState(false);
  const active = recorder.phase === 'recording' || recorder.phase === 'paused';
  return <div className="floating-recorder">
    <div className="floating-heading"><strong>Scribble Party</strong>
      <span role="status">{recorder.phase === 'paused' ? 'Paused' : recorder.phase === 'recording' ? 'Recording' : 'Screen studio'}</span>
      <span role="timer">{formatDuration(recorder.elapsedMs)}</span>
    </div>
    <div className="floating-preview" ref={(node) => {
      const canvas = recorder.getCanvas();
      if (node && canvas && canvas.parentElement !== node && recorder.phase !== 'idle') node.appendChild(canvas);
    }} />
    <div className="screen-setup-actions">
      <button type="button" className="btn ghost" onClick={onMic}
        disabled={!micEnabled && active}>
        {!micEnabled ? 'Enable mic' : micMuted ? 'Unmute mic' : active ? 'Mute mic' : 'Turn mic off'}
      </button>
      <button type="button" className="btn ghost" onClick={onCamera}>
        {!cameraEnabled ? 'Enable camera' : !active && recorder.phase !== 'countdown'
          ? 'Turn camera off' : cameraVisible ? 'Hide camera' : 'Show camera'}
      </button>
      {recorder.phase === 'idle' && <button type="button" className="btn primary"
        disabled={recordDisabled} onClick={onRecord}>Record screen</button>}
      {recorder.phase === 'countdown' && <button type="button" className="btn ghost"
        onClick={recorder.cancelCountdown}>Cancel countdown ({recorder.countdownValue})</button>}
      {active && pauseReliable && <button type="button" className="btn ghost"
        onClick={recorder.phase === 'paused' ? recorder.resume : recorder.pause}>
        {recorder.phase === 'paused' ? 'Resume' : 'Pause'}
      </button>}
      {active && <button type="button" className="btn danger" onClick={() => setConfirmStop(true)}>Stop recording</button>}
      {recorder.phase === 'stopping' && <span role="status">Preparing your take…</span>}
    </div>
    {confirmStop && active && <div className="floating-confirm" role="alertdialog" aria-label="End recording?">
      <span>End recording?</span>
      <button type="button" className="btn danger" onClick={recorder.stop}>End</button>
      <button type="button" className="btn ghost" onClick={() => setConfirmStop(false)}>Keep going</button>
    </div>}
    <p className="screen-privacy">Closing this panel does not stop your take. Return to the studio or use your browser’s Stop sharing control.</p>
  </div>;
}
