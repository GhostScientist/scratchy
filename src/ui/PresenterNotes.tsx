import { useEffect, useRef, useState } from 'react';
import type { RecorderPhase } from '../recording/useRecorder';
import { CloseIcon, GearIcon } from './icons';

interface PresenterNotesProps {
  value: string;
  onChange(value: string): void;
  onClose(): void;
  phase: RecorderPhase;
}

export function PresenterNotes({ value, onChange, onClose, phase }: PresenterNotesProps) {
  const [reading, setReading] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const [speed, setSpeed] = useState(24);
  const [fontSize, setFontSize] = useState(24);
  const [optionsOpen, setOptionsOpen] = useState(() => !matchMedia('(max-width: 700px)').matches);
  const textRef = useRef<HTMLDivElement>(null);
  const running = scrolling && (phase === 'idle' || phase === 'recording');

  useEffect(() => {
    if (!running || !reading) return;
    const el = textRef.current;
    if (!el) return;
    let raf = 0;
    let last = performance.now();
    // Fractional accumulation matters on high-refresh screens: scrollTop
    // can round away each frame's sub-pixel increment.
    let position = el.scrollTop;
    const frame = (now: number) => {
      position += Math.min(now - last, 100) * speed / 1000;
      last = now;
      el.scrollTop = position;
      if (el.scrollTop >= el.scrollHeight - el.clientHeight) {
        setScrolling(false);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [reading, running, speed]);

  return (
    <aside className="presenter-notes" aria-label="Presenter notes">
      <header className="notes-head">
        <div><h2>Presenter notes</h2><p>Private · never in your video or PNG</p></div>
        <button type="button" className="pill" aria-label="Close presenter notes" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <div className="notes-controls">
        <button type="button" className="btn ghost" aria-label={reading ? 'Edit notes' : 'Read notes'} onClick={() => {
          setReading(!reading);
          setScrolling(false);
        }}>{reading ? 'Edit' : 'Read notes'}</button>
        {reading && <>
          <button type="button" className="btn ghost" aria-pressed={scrolling}
            onClick={() => setScrolling(!scrolling)}>
            {scrolling ? 'Pause scroll' : 'Auto-scroll'}
          </button>
          <button type="button" className="btn ghost" aria-label="Rewind notes" onClick={() => {
            if (textRef.current) textRef.current.scrollTop = 0;
            setScrolling(false);
          }}>Rewind</button>
          <button type="button" className="pill" aria-label="Notes display settings"
            aria-expanded={optionsOpen} onClick={() => setOptionsOpen(!optionsOpen)}>
            <GearIcon />
          </button>
        </>}
      </div>
      {reading ? (
        <>
          {optionsOpen && <div className="notes-options">
            <label>Text size
              <input aria-label="Notes text size" type="range" min="18" max="40" value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))} />
            </label>
            <label>Scroll speed
              <input aria-label="Notes scroll speed" type="range" min="8" max="64" value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))} />
            </label>
          </div>}
          <div ref={textRef} className="notes-reader" tabIndex={0} style={{ fontSize }}
            onWheel={() => setScrolling(false)} onPointerDown={() => setScrolling(false)}
            onKeyDown={(e) => {
              if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) {
                setScrolling(false);
              }
            }}>
            {value || 'Add a script or a few talking points in Edit notes.'}
          </div>
          {scrolling && !running && (
            <p className="notes-status">
              {phase === 'countdown' ? 'Scroll starts after the countdown.'
                : phase === 'paused' ? 'Scroll paused with your recording.'
                  : 'Scroll paused while preparing or reviewing the take.'}
            </p>
          )}
        </>
      ) : (
        <textarea className="notes-editor" aria-label="Notes script" value={value} maxLength={50000}
          placeholder="Your script, talking points, or reminders. Saved with this board."
          onChange={(e) => onChange(e.target.value)} />
      )}
    </aside>
  );
}
