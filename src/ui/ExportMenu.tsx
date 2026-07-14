import { useEffect, useRef, useState } from 'react';
import { ImageIcon } from './icons';

interface ExportMenuProps {
  onExportView(): void;
  onExportBoard(): void;
}

export function ExportMenu(props: ExportMenuProps) {
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

  const pick = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div className="export-menu" ref={rootRef}>
      <button
        type="button"
        className={`pill${open ? ' active' : ''}`}
        aria-label="Export image"
        aria-expanded={open}
        title="Export image"
        onClick={() => setOpen((o) => !o)}
      >
        <ImageIcon />
      </button>
      {open && (
        <div className="export-flyout" role="menu" aria-label="Export options">
          <button type="button" onClick={() => pick(props.onExportView)}>
            Current view (PNG)
          </button>
          <button type="button" onClick={() => pick(props.onExportBoard)}>
            Whole board (PNG)
          </button>
        </div>
      )}
    </div>
  );
}
