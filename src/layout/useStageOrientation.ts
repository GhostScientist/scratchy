import { useEffect, useState } from 'react';
import type { StageOrientation } from '../types';

/** Debounce for orientation flips: iOS fires the media query once, cleanly,
 *  but Android can flap mid rotate-animation. */
const ORIENTATION_SETTLE_MS = 150;

function currentOrientation(): StageOrientation {
  if (typeof window === 'undefined' || !window.matchMedia) return 'landscape';
  return window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape';
}

/**
 * The viewport's orientation, driven by the CSS orientation media query.
 *
 * Deliberately NOT derived from the stage-fit ResizeObserver: the on-screen
 * keyboard shrinks the layout viewport's height and would flip a portrait
 * phone to "landscape" mid text-edit, while the orientation MQ stays put.
 * A tall narrow desktop window does report portrait — which is desired: the
 * stage window should match the shape of the space it lives in.
 */
export function useStageOrientation(): StageOrientation {
  const [orientation, setOrientation] = useState<StageOrientation>(currentOrientation);

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(orientation: portrait)');
    let timer = 0;
    const onChange = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setOrientation(mq.matches ? 'portrait' : 'landscape');
      }, ORIENTATION_SETTLE_MS);
    };
    mq.addEventListener('change', onChange);
    return () => {
      window.clearTimeout(timer);
      mq.removeEventListener('change', onChange);
    };
  }, []);

  return orientation;
}

/**
 * Live devicePixelRatio, re-armed one-shot per value: browser zoom changes
 * and moves between monitors re-fire; the backing scale recomputes from it.
 */
export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() =>
    typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
  );

  useEffect(() => {
    if (!window.matchMedia) return;
    let mq: MediaQueryList | null = null;
    const arm = () => {
      const value = window.devicePixelRatio || 1;
      mq = window.matchMedia(`(resolution: ${value}dppx)`);
      mq.addEventListener('change', onChange, { once: true });
    };
    const onChange = () => {
      setDpr(window.devicePixelRatio || 1);
      arm();
    };
    arm();
    return () => mq?.removeEventListener('change', onChange);
  }, []);

  return dpr;
}
