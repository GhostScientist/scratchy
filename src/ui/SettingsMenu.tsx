import { useEffect, useRef, useState } from 'react';
import { GearIcon } from './icons';
import type { Handedness } from '../settings/settings';

interface SettingsMenuProps {
  handedness: Handedness;
  onHandedness(handedness: Handedness): void;
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
        </div>
      )}
    </div>
  );
}
