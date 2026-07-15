import { useCallback, useEffect, useRef, useState } from 'react';
import { CutoutEngine, setDevBudgetMs, setDevForceFailure } from './cutout';
import type { CutoutState } from './cutout';

export type CutoutFallbackReason = 'unavailable' | 'performance';

export interface CutoutApi {
  state: CutoutState;
  /** Cutout is known not to work here (load failed or too slow) — sticky for
   *  the session so the shape button can be disabled instead of re-failing. */
  blocked: boolean;
  /** The engine's cutout canvas while ready; null otherwise. May be 0×0 for
   *  the first ~70ms until the first mask lands — consumers must size-check
   *  before drawImage. */
  getCanvas(): HTMLCanvasElement | null;
}

interface UseCutoutOptions {
  /** True while the cutout shape is selected on a live, visible camera. */
  active: boolean;
  videoElRef: { current: HTMLVideoElement | null };
  onFallback(reason: CutoutFallbackReason): void;
}

// Session-sticky across engine instances: a device that failed once will
// fail again, so remember instead of re-downloading and re-failing.
let sessionBlocked = false;

/** Owns a CutoutEngine's lifecycle: created when `active` flips true,
 *  disposed when it flips false (shape change, camera off/hidden, unmount). */
export function useCutout({ active, videoElRef, onFallback }: UseCutoutOptions): CutoutApi {
  const [state, setState] = useState<CutoutState>('idle');
  const [blocked, setBlocked] = useState(sessionBlocked);
  const engineRef = useRef<CutoutEngine | null>(null);
  const onFallbackRef = useRef(onFallback);
  onFallbackRef.current = onFallback;

  useEffect(() => {
    if (!active) return;
    // The overlay's <video> ref callback runs before parent effects, so the
    // element is present by the time the shape can be selected.
    const video = videoElRef.current;
    if (!video) return;
    const block = (reason: CutoutFallbackReason) => {
      sessionBlocked = true;
      setBlocked(true);
      onFallbackRef.current(reason);
    };
    const engine = new CutoutEngine({
      onState: (s) => {
        setState(s);
        if (s === 'failed' || s === 'unsupported') block('unavailable');
      },
      onPerformanceFallback: () => block('performance'),
    });
    engineRef.current = engine;
    engine.start(video);
    return () => {
      engineRef.current = null;
      engine.dispose();
      setState('idle');
    };
  }, [active, videoElRef]);

  const getCanvas = useCallback(() => {
    const engine = engineRef.current;
    return engine && engine.getState() === 'ready' ? engine.canvas : null;
  }, []);

  // DEV hook so e2e tests can drive the failure path and defuse the perf
  // watchdog on slow CI runners (pattern: __scratchyRecorder/__scratchyBoards).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__scratchyCutout = {
      getState: () => engineRef.current?.getState() ?? 'idle',
      setBudgetMs: setDevBudgetMs,
      forceFailure: () => setDevForceFailure(true),
    };
  }, []);

  return { state, blocked, getCanvas };
}
