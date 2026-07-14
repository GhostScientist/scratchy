import { useState } from 'react';
import type { ReactNode } from 'react';

interface SlideMediaProps {
  /** Optional demo clip; the animated fallback shows until it can play. */
  video?: string;
  fallback: ReactNode;
  label: string;
}

/**
 * Slide artwork with graceful degradation: the animated fallback is always
 * mounted underneath, and the video (when present) crossfades in over it once
 * it can actually play. A missing or broken file simply never covers the
 * fallback — no spinner, no broken-video flash, and it works offline.
 *
 * Demo clips live at public/onboarding/<id>.mp4 (H.264, 1280×720, loopable);
 * dropping a file in upgrades the slide with no code change.
 */
export function SlideMedia(props: SlideMediaProps) {
  const [ready, setReady] = useState(false);
  // Autoplaying video is skipped entirely under reduced motion; the fallback
  // art's CSS animations are frozen by the global reduced-motion rule.
  const [reducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  return (
    <div className="onboard-media" role="img" aria-label={props.label}>
      <div className="onboard-fallback" aria-hidden="true">
        {props.fallback}
      </div>
      {props.video && !reducedMotion && (
        <video
          key={props.video}
          className={`onboard-video${ready ? ' ready' : ''}`}
          src={props.video}
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
          onCanPlay={() => setReady(true)}
        />
      )}
    </div>
  );
}
