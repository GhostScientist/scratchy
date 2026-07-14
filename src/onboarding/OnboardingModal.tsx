import { useEffect, useRef, useState } from 'react';
import { SLIDES } from './slides';
import { SlideMedia } from './SlideMedia';

interface OnboardingModalProps {
  /** Called on every close path; the parent marks the tour as seen. */
  onClose(): void;
}

export function OnboardingModal(props: OnboardingModalProps) {
  const [index, setIndex] = useState(0);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const slide = SLIDES[index];
  const last = index === SLIDES.length - 1;

  useEffect(() => {
    primaryRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
      else if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, SLIDES.length - 1));
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="Welcome tour">
      <div className="modal onboard">
        <SlideMedia video={slide.video} fallback={slide.fallback} label={slide.mediaLabel} />

        <div className="onboard-body" aria-live="polite">
          <h2>{slide.title}</h2>
          <p>{slide.body}</p>
        </div>

        <footer className="onboard-foot">
          <div className="onboard-dots">
            {SLIDES.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className={`onboard-dot${i === index ? ' active' : ''}`}
                aria-label={`Slide ${i + 1} of ${SLIDES.length}`}
                aria-current={i === index}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
          <div className="onboard-nav">
            {!last && (
              <button type="button" className="btn ghost" onClick={props.onClose}>
                Skip
              </button>
            )}
            {index > 0 && (
              <button type="button" className="btn ghost" onClick={() => setIndex(index - 1)}>
                Back
              </button>
            )}
            <button
              ref={primaryRef}
              type="button"
              className="btn primary"
              onClick={() => (last ? props.onClose() : setIndex(index + 1))}
            >
              {last ? 'Start scribbling' : 'Next'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
