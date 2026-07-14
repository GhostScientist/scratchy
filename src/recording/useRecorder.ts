import { useCallback, useEffect, useRef, useState } from 'react';
import { Compositor } from './Compositor';
import type { CompositorSources } from './Compositor';
import { negotiateFormat, extensionFor } from './mime';
import type { NegotiatedFormat } from './mime';
import type { RecordingPreset } from './presets';
import { createRecordingStore } from './RecordingStore';
import type { RecordingManifest, RecordingStore } from './RecordingStore';
import { nextId } from '../types';
import type { Take } from '../types';

export type RecorderPhase = 'idle' | 'countdown' | 'recording' | 'paused' | 'stopping' | 'complete';

export interface RecorderApi {
  phase: RecorderPhase;
  countdownValue: number;
  /** Active recording time — paused stretches are excluded. */
  elapsedMs: number;
  take: Take | null;
  error: string | null;
  start(): void;
  cancelCountdown(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  /** Revoke the take's object URL and return to idle. */
  closeTake(): void;
  dismissError(): void;
}

const COUNTDOWN_SECONDS = 3;

export function useRecorder(
  sources: CompositorSources,
  getMicStream: () => MediaStream | null,
  getPreset: () => RecordingPreset,
  getSessionMeta: () => { boardId: string | null; title: string },
  onWarning?: (message: string) => void,
): RecorderApi {
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [countdownValue, setCountdownValue] = useState(COUNTDOWN_SECONDS);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const getMicRef = useRef(getMicStream);
  getMicRef.current = getMicStream;
  const getPresetRef = useRef(getPreset);
  getPresetRef.current = getPreset;
  const presetRef = useRef<RecordingPreset | null>(null);

  const getSessionMetaRef = useRef(getSessionMeta);
  getSessionMetaRef.current = getSessionMeta;
  const warnRef = useRef(onWarning);
  warnRef.current = onWarning;

  const compositorRef = useRef<Compositor | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const formatRef = useRef<NegotiatedFormat | null>(null);
  // Incremental chunk persistence (SPEC §6.6): every non-empty chunk lands in
  // the RecordingStore as it arrives; the manifest heartbeat follows each
  // write. The chain serializes appends so a slow write can never reorder.
  const storeRef = useRef<RecordingStore | null>(null);
  const appendChainRef = useRef<Promise<void>>(Promise.resolve());
  const sessionIdRef = useRef<string | null>(null);
  const manifestRef = useRef<RecordingManifest | null>(null);
  const chunkIndexRef = useRef(0);
  /** Session backing the completed take — deleted when the take closes. */
  const completedSessionRef = useRef<string | null>(null);
  // Active-time accounting: completed active milliseconds plus the start of
  // the currently open segment. Pause closes a segment, resume opens one —
  // so elapsed time never includes paused stretches and can't drift.
  const activeMsRef = useRef(0);
  const segmentStartRef = useRef(0);
  const segmentOpenRef = useRef(false);
  const stoppedElapsedRef = useRef(0);
  const timerRef = useRef(0);
  const countdownTimerRef = useRef(0);
  const failedRef = useRef(false);
  const finalizedRef = useRef(false);
  const watchdogRef = useRef(0);
  const takeRef = useRef<Take | null>(null);
  takeRef.current = take;

  const currentActiveMs = useCallback(
    () =>
      activeMsRef.current +
      (segmentOpenRef.current ? performance.now() - segmentStartRef.current : 0),
    [],
  );

  /** Persist a manifest state change (chained behind pending chunk writes). */
  const touchManifest = useCallback(
    (state: RecordingManifest['state']) => {
      const manifest = manifestRef.current;
      const store = storeRef.current;
      if (!manifest || !store) return;
      manifest.state = state;
      manifest.activeMs = currentActiveMs();
      manifest.updatedAt = Date.now();
      const snapshot = { ...manifest };
      appendChainRef.current = appendChainRef.current.then(() => store.updateManifest(snapshot));
    },
    [currentActiveMs],
  );

  const teardownCapture = useCallback(() => {
    window.clearInterval(timerRef.current);
    window.clearTimeout(watchdogRef.current);
    compositorRef.current?.stop();
    // The recorder stream owns its tracks (mic tracks are clones), so end
    // them all — ending every track is what makes the encoder flush.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
    }
    recorderRef.current = null;
  }, []);

  const finalize = useCallback(() => {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    const recorder = recorderRef.current;
    const format = formatRef.current;
    teardownCapture();
    const sessionId = sessionIdRef.current;
    const store = storeRef.current;
    sessionIdRef.current = null;
    manifestRef.current = null;
    // On failure the session is kept: its chunks resurface as a recoverable
    // partial take on the next launch.
    if (failedRef.current || !format || !sessionId || !store) return;
    const mimeType = recorder?.mimeType && recorder.mimeType.length > 0 ? recorder.mimeType : format.mimeType;
    void (async () => {
      await appendChainRef.current;
      const blob = await store.finalizeSession(sessionId, mimeType);
      if (blob.size === 0) {
        void store.deleteSession(sessionId);
        setError('The recording produced no data — this browser may not support canvas recording.');
        setPhase('idle');
        return;
      }
      completedSessionRef.current = sessionId;
      const newTake: Take = {
        blob,
        url: URL.createObjectURL(blob),
        mimeType,
        extension: extensionFor(mimeType),
        durationMs: stoppedElapsedRef.current,
        createdAt: Date.now(),
      };
      setTake(newTake);
      setPhase('complete');
    })();
  }, [teardownCapture]);

  const failRecording = useCallback(
    (message: string) => {
      failedRef.current = true;
      teardownCapture();
      setError(message);
      setPhase('idle');
    },
    [teardownCapture],
  );

  const beginRecording = useCallback(() => {
    try {
      const compositor = compositorRef.current!;
      const format = formatRef.current!;
      const preset = presetRef.current!;
      const stream = compositor.captureStream(preset.fps);
      const mic = getMicRef.current();
      // Clone mic tracks so teardown can stop them without killing the
      // mic hook's stream for the next take.
      mic?.getAudioTracks().forEach((t) => stream.addTrack(t.clone()));
      streamRef.current = stream;

      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, {
          mimeType: format.mimeType,
          videoBitsPerSecond: preset.videoBitsPerSecond,
          audioBitsPerSecond: 128_000,
        });
      } catch {
        recorder = new MediaRecorder(stream);
      }
      failedRef.current = false;
      finalizedRef.current = false;

      // One recovery session per take: chunks stream into the store and the
      // manifest heartbeat follows, so a crash leaves a recoverable trail.
      const store =
        storeRef.current ??
        (storeRef.current = createRecordingStore(() => {
          warnRef.current?.(
            'Recording chunks stopped persisting — this take continues in memory. Your lesson is safe.',
          );
        }));
      const meta = getSessionMetaRef.current();
      const sessionId = nextId('rec');
      sessionIdRef.current = sessionId;
      chunkIndexRef.current = 0;
      const manifest: RecordingManifest = {
        sessionId,
        boardId: meta.boardId,
        title: meta.title,
        mimeType: format.mimeType,
        extension: format.extension,
        presetId: preset.id,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        state: 'recording',
        chunkCount: 0,
        activeMs: 0,
      };
      manifestRef.current = manifest;
      appendChainRef.current = appendChainRef.current.then(() =>
        store.createSession({ ...manifest }),
      );

      recorder.ondataavailable = (e: BlobEvent) => {
        if (!e.data || e.data.size === 0) return;
        const index = chunkIndexRef.current;
        chunkIndexRef.current += 1;
        appendChainRef.current = appendChainRef.current.then(async () => {
          await store.appendChunk(sessionId, index, e.data);
          const m = manifestRef.current;
          if (m && m.sessionId === sessionId) {
            m.chunkCount = Math.max(m.chunkCount, index + 1);
            m.activeMs = currentActiveMs();
            m.updatedAt = Date.now();
            await store.updateManifest({ ...m });
          }
        });
      };
      recorder.onerror = () => {
        failRecording('Recording failed — the browser reported an encoder error. Your lesson is safe.');
      };
      recorder.onstop = finalize;
      recorderRef.current = recorder;
      recorder.start(1000);
      activeMsRef.current = 0;
      segmentStartRef.current = performance.now();
      segmentOpenRef.current = true;
      setElapsedMs(0);
      timerRef.current = window.setInterval(() => {
        setElapsedMs(activeMsRef.current + (performance.now() - segmentStartRef.current));
      }, 250);
      setPhase('recording');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failRecording(`Could not start recording: ${message}. Your lesson is safe.`);
    }
  }, [currentActiveMs, failRecording, finalize]);

  const start = useCallback(() => {
    setPhase((current) => {
      if (current !== 'idle') return current;
      const format = negotiateFormat();
      if (!format) {
        setError(
          "This browser can't record video (no supported recording format). Try a current version of Chrome, Edge, or Safari.",
        );
        return current;
      }
      formatRef.current = format;
      // Fresh compositor per take — its canvas is sized by the preset,
      // which may have changed since the last recording.
      const preset = getPresetRef.current();
      presetRef.current = preset;
      compositorRef.current?.stop();
      compositorRef.current = new Compositor(sourcesRef.current, preset);
      compositorRef.current.start();
      setCountdownValue(COUNTDOWN_SECONDS);
      let remaining = COUNTDOWN_SECONDS;
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = window.setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          window.clearInterval(countdownTimerRef.current);
          beginRecording();
        } else {
          setCountdownValue(remaining);
        }
      }, 1000);
      return 'countdown';
    });
  }, [beginRecording]);

  const cancelCountdown = useCallback(() => {
    window.clearInterval(countdownTimerRef.current);
    compositorRef.current?.stop();
    setPhase((current) => (current === 'countdown' ? 'idle' : current));
  }, []);

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    try {
      // Flush the pending partial chunk so a paused session is fully
      // persisted up to the pause point.
      recorder.requestData();
    } catch {
      // Nothing to flush.
    }
    try {
      recorder.pause();
    } catch {
      return; // Pause unsupported here — leave the recording running.
    }
    activeMsRef.current += performance.now() - segmentStartRef.current;
    segmentOpenRef.current = false;
    window.clearInterval(timerRef.current);
    setElapsedMs(activeMsRef.current);
    touchManifest('paused');
    setPhase('paused');
  }, [touchManifest]);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'paused') return;
    try {
      recorder.resume();
    } catch {
      return;
    }
    segmentStartRef.current = performance.now();
    segmentOpenRef.current = true;
    timerRef.current = window.setInterval(() => {
      setElapsedMs(activeMsRef.current + (performance.now() - segmentStartRef.current));
    }, 250);
    touchManifest('recording');
    setPhase('recording');
  }, [touchManifest]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    stoppedElapsedRef.current =
      activeMsRef.current +
      (segmentOpenRef.current ? performance.now() - segmentStartRef.current : 0);
    segmentOpenRef.current = false;
    activeMsRef.current = stoppedElapsedRef.current;
    window.clearInterval(timerRef.current);
    touchManifest('stopping');
    setPhase('stopping');
    try {
      // Flush the pending partial chunk before stopping — Safari can fail
      // to deliver a final dataavailable on mixed canvas+mic streams.
      // (Valid from both recording and paused states.)
      recorder.requestData();
    } catch {
      // Nothing to flush; the 1s timeslice chunks are enough.
    }
    try {
      recorder.stop();
    } catch {
      finalize();
      return;
    }
    // Safari sometimes never fires onstop for canvas+mic composite streams;
    // finalize from the accumulated timeslice chunks if it hasn't fired.
    window.clearTimeout(watchdogRef.current);
    watchdogRef.current = window.setTimeout(finalize, 3000);
  }, [finalize, touchManifest]);

  const closeTake = useCallback(() => {
    // The take was delivered (downloaded/saved/deleted by the user) — its
    // recovery session has served its purpose.
    const store = storeRef.current;
    const sessionId = completedSessionRef.current;
    completedSessionRef.current = null;
    if (store && sessionId) void store.deleteSession(sessionId);
    setTake((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    setPhase('idle');
  }, []);

  useEffect(
    () => () => {
      window.clearInterval(countdownTimerRef.current);
      window.clearInterval(timerRef.current);
      window.clearTimeout(watchdogRef.current);
      compositorRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (takeRef.current) URL.revokeObjectURL(takeRef.current.url);
    },
    [],
  );

  return {
    phase,
    countdownValue,
    elapsedMs,
    take,
    error,
    start,
    cancelCountdown,
    pause,
    resume,
    stop,
    closeTake,
    dismissError: useCallback(() => setError(null), []),
  };
}
