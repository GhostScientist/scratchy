import { useCallback, useEffect, useRef, useState } from 'react';
import { negotiateFormat } from '../recording/mime';

export function screenRecordingUnavailable(): string | null {
  if (!window.isSecureContext) return 'Screen recording needs HTTPS or localhost.';
  if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
    return 'Screen recording is unavailable in this browser. Try desktop Chrome, Edge, Firefox, or Safari.';
  }
  if (typeof HTMLCanvasElement.prototype.captureStream !== 'function' ||
      typeof MediaRecorder === 'undefined' || !negotiateFormat()) {
    return 'This browser cannot record screen video. Try a current desktop browser.';
  }
  return null;
}

function captureError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'AbortError') {
    return 'Screen sharing was cancelled or blocked. Choose a screen to try again.';
  }
  if (name === 'NotReadableError') {
    return 'The screen could not be captured. Check your operating system screen-recording permission, then try again.';
  }
  if (name === 'InvalidStateError') return 'Choose a screen directly from the Share screen button.';
  return `Could not share the screen: ${error instanceof Error ? error.message : String(error)}.`;
}

export function useScreenCapture(onEnded: () => void) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestRef = useRef(0);
  const busyRef = useRef(false);
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;

  const release = useCallback(() => {
    requestRef.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  const share = useCallback(async (audio: boolean) => {
    if (busyRef.current) return;
    const unavailable = screenRecordingUnavailable();
    if (unavailable) { setError(unavailable); return; }
    const request = ++requestRef.current;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      // Invoke before any await: getDisplayMedia requires a fresh user gesture.
      const next = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 30 } },
        audio,
      });
      if (request !== requestRef.current) {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      const video = next.getVideoTracks()[0];
      if (!video || video.readyState !== 'live') {
        next.getTracks().forEach((track) => track.stop());
        throw new Error('The selected source has no live video track');
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = next;
      video.addEventListener('ended', () => {
        if (streamRef.current !== next) return;
        // Stop/finalize first so the compositor cannot record an empty source.
        endedRef.current();
        next.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setStream(null);
      }, { once: true });
      setStream(next);
    } catch (err) {
      if (request === requestRef.current) setError(captureError(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => () => {
    requestRef.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  return { stream, busy, error, share, release, clearError: useCallback(() => setError(null), []) };
}
