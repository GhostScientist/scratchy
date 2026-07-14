import { useEffect, useRef, useState } from 'react';
import type { BoardMeta } from '../persistence/boards';
import { BoardsIcon, PlusIcon, TrashIcon } from './icons';

interface BoardsMenuProps {
  boards: BoardMeta[];
  activeBoardId: string | null;
  /** Board switching is blocked while a recording is live. */
  disabled: boolean;
  onSwitch(id: string): void;
  onCreate(): void;
  onDelete(id: string): void;
}

function when(updatedAt: number): string {
  const d = new Date(updatedAt);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function BoardsMenu(props: BoardsMenuProps) {
  const [open, setOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmId(null);
      }
    };
    document.addEventListener('pointerdown', onOutside, true);
    return () => document.removeEventListener('pointerdown', onOutside, true);
  }, [open]);

  return (
    <div className="boards-menu" ref={rootRef}>
      <button
        type="button"
        className={`pill${open ? ' active' : ''}`}
        aria-label="Boards"
        aria-expanded={open}
        title="Boards"
        disabled={props.disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <BoardsIcon />
      </button>
      {open && (
        <div className="boards-flyout" role="menu" aria-label="Boards">
          {props.boards.map((board) => (
            <div
              key={board.id}
              className={`board-row${board.id === props.activeBoardId ? ' active' : ''}`}
            >
              <button
                type="button"
                className="board-open"
                onClick={() => {
                  setOpen(false);
                  props.onSwitch(board.id);
                }}
              >
                <span className="board-title">{board.title || 'Untitled lesson'}</span>
                <span className="board-meta">
                  {when(board.updatedAt)} · {board.strokeCount} strokes
                </span>
              </button>
              <button
                type="button"
                className={`board-delete${confirmId === board.id ? ' confirm' : ''}`}
                aria-label={
                  confirmId === board.id
                    ? `Really delete ${board.title}?`
                    : `Delete ${board.title}`
                }
                title={confirmId === board.id ? 'Really delete?' : 'Delete board'}
                onClick={() => {
                  if (confirmId === board.id) {
                    setConfirmId(null);
                    props.onDelete(board.id);
                  } else {
                    setConfirmId(board.id);
                  }
                }}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="board-new"
            onClick={() => {
              setOpen(false);
              props.onCreate();
            }}
          >
            <PlusIcon />
            New board
          </button>
        </div>
      )}
    </div>
  );
}
