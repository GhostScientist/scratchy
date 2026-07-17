import { useEffect, useRef, useState } from 'react';
import { GearIcon } from './icons';
import { PRESETS } from '../recording/presets';
import type { Handedness } from '../settings/settings';

interface SettingsMenuProps {
  handedness: Handedness;
  onHandedness(handedness: Handedness): void;
  presetId: string;
  /** Frozen during an active recording (SPEC §7.1). */
  presetLocked: boolean;
  /** null until a device check ran; false disables the 1080p-class presets. */
  supports1080p: boolean | null;
  onPreset(id: string): void;
  /** One-line capability summary, null before the first device check. */
  deviceSummary: string | null;
  deviceChecking: boolean;
  onDeviceCheck(): void;
  /** Re-open the first-launch welcome tour. */
  onReplayTour(): void;
}

export function SettingsMenu(props: SettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onOutside, true);
    return () => document.removeEventListener('pointerdown', onOutside, true);
  }, [open]);

  return (
    <div className="settings-menu" ref={rootRef}>
      <button
        type="button"
        className={`pill${open ? ' active' : ''}`}
        aria-label="Settings"
        aria-expanded={open}
        title="Settings"
        onClick={() => setOpen((o) => !o)}
      >
        <GearIcon />
      </button>
      {open && (
        <div className="export-flyout settings-flyout" role="menu" aria-label="Settings">
          <div className="settings-label" id="settings-hand-label">
            Toolbar side
          </div>
          <div className="settings-seg" role="group" aria-labelledby="settings-hand-label">
            <button
              type="button"
              className={props.handedness === 'right' ? 'active' : ''}
              aria-pressed={props.handedness === 'right'}
              aria-label="Right-handed"
              onClick={() => props.onHandedness('right')}
            >
              Right-handed
            </button>
            <button
              type="button"
              className={props.handedness === 'left' ? 'active' : ''}
              aria-pressed={props.handedness === 'left'}
              aria-label="Left-handed"
              onClick={() => props.onHandedness('left')}
            >
              Left-handed
            </button>
          </div>
          <div className="settings-label" id="settings-preset-label">
            Recording quality
          </div>
          <div className="settings-seg" role="group" aria-labelledby="settings-preset-label">
            {PRESETS.map((p) => {
              const gatedOff = p.needsPerformance && props.supports1080p === false;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={props.presetId === p.id ? 'active' : ''}
                  aria-pressed={props.presetId === p.id}
                  aria-label={`${p.label} preset`}
                  title={gatedOff ? `${p.description} (needs a faster device)` : p.description}
                  disabled={props.presetLocked || gatedOff}
                  onClick={() => props.onPreset(p.id)}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <p className="settings-device">
            {PRESETS.find((p) => p.id === props.presetId)?.description}
            {props.presetLocked ? ' · locked while recording' : ''}
          </p>
          <div className="settings-label">This device</div>
          <p className="settings-device">
            {props.deviceSummary ?? 'Not checked yet. It runs before your first recording.'}
          </p>
          <button
            type="button"
            disabled={props.deviceChecking}
            onClick={props.onDeviceCheck}
          >
            {props.deviceChecking ? 'Checking…' : 'Run device check'}
          </button>
          <div className="settings-label">Scribble Party</div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              props.onReplayTour();
            }}
          >
            Replay welcome tour
          </button>
        </div>
      )}
    </div>
  );
}
