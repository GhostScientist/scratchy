import { useCallback, useEffect, useRef, useState } from 'react';
import { friendlyMediaError } from './mediaErrors';

export interface MicrophoneApi {
  stream: MediaStream | null;
  enabled: boolean;
  muted: boolean;
  error: string | null;
  enable(): Promise<void>;
  disable(): void;
  toggleMuted(): void;
  clearError(): void;
}

/**
 * Microphone capture plus a Web Audio analyser for the level meter. The meter
 * writes `--mic-level` (0..1) on <html> every frame so the UI animates without
 * React re-renders. The analyser is metering-only — the raw mic track is what
 * gets recorded.
 */
export function useMicrophone(): MicrophoneApi {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const meterRef = useRef<{ ctx: AudioContext; raf: number } | null>(null);

  const stopMeter = useCallback(() => {
    if (meterRef.current) {
      cancelAnimationFrame(meterRef.current.raf);
      meterRef.current.ctx.close().catch(() => {});
      meterRef.current = null;
    }
    document.documentElement.style.setProperty('--mic-level', '0');
  }, []);

  const startMeter = useCallback((s: MediaStream) => {
    const AudioCtx = window.AudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(s).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let smoothed = 0;
    const meter = { ctx, raf: 0 };
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sumSq = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sumSq += v * v;
      }
      const level = Math.min(1, Math.sqrt(sumSq / data.length) * 3.5);
      smoothed = level > smoothed ? level : smoothed * 0.88;
      document.documentElement.style.setProperty('--mic-level', smoothed.toFixed(3));
      meter.raf = requestAnimationFrame(tick);
    };
    meter.raf = requestAnimationFrame(tick);
    meterRef.current = meter;
  }, []);

  const disable = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
    setMuted(false);
    stopMeter();
  }, [stopMeter]);

  const enable = useCallback(async () => {
    if (streamRef.current) return;
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = s;
      s.getAudioTracks()[0]?.addEventListener('ended', () => {
        streamRef.current = null;
        setStream(null);
        setMuted(false);
        stopMeter();
        setError('The microphone stopped unexpectedly. Re-enable it to continue.');
      });
      setMuted(false);
      setStream(s);
      startMeter(s);
    } catch (err) {
      setError(friendlyMediaError(err, 'microphone'));
    }
  }, [startMeter, stopMeter]);

  const toggleMuted = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      streamRef.current?.getAudioTracks().forEach((t) => {
        t.enabled = !next;
      });
      return next;
    });
  }, []);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      stopMeter();
    },
    [stopMeter],
  );

  return {
    stream,
    enabled: stream !== null,
    muted,
    error,
    enable,
    disable,
    toggleMuted,
    clearError: useCallback(() => setError(null), []),
  };
}
