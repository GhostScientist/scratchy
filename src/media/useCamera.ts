import { useCallback, useEffect, useRef, useState } from 'react';
import { detectPerfTier } from '../capability/tier';
import { friendlyMediaError } from './mediaErrors';

export interface CameraApi {
  stream: MediaStream | null;
  enabled: boolean;
  busy: boolean;
  error: string | null;
  enable(): Promise<void>;
  disable(): void;
  clearError(): void;
}

/** Camera capture. `enable` must be called from an explicit user action —
 *  the app never requests the camera on load. */
export function useCamera(): CameraApi {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const disable = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  const enable = useCallback(async () => {
    if (streamRef.current) return;
    setBusy(true);
    setError(null);
    try {
      // Low-tier devices capture at 640×360: the bubble maxes out at 640
      // stage px and those devices record 720p (1:1 stage scale), so the
      // smaller stream is sharp at worst-case size while every downstream
      // consumer (DOM preview, cutout composite + inference, compositor
      // blit) processes a quarter of the pixels.
      const ideal =
        detectPerfTier() === 'low' ? { width: 640, height: 360 } : { width: 1280, height: 720 };
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: ideal.width },
          height: { ideal: ideal.height },
          facingMode: 'user',
        },
      });
      streamRef.current = s;
      s.getVideoTracks()[0]?.addEventListener('ended', () => {
        // Camera was unplugged or reclaimed by the OS.
        streamRef.current = null;
        setStream(null);
        setError('The camera stopped unexpectedly. Re-enable it to continue.');
      });
      setStream(s);
    } catch (err) {
      setError(friendlyMediaError(err, 'camera'));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    },
    [],
  );

  return {
    stream,
    enabled: stream !== null,
    busy,
    error,
    enable,
    disable,
    clearError: useCallback(() => setError(null), []),
  };
}
