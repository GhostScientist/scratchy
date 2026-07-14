import type { SVGProps } from 'react';

function Svg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export function PenIcon() {
  return (
    <Svg>
      <path d="M4 20l1.2-4.2L16.4 4.6a2.1 2.1 0 0 1 3 3L8.2 18.8 4 20z" />
      <path d="M14.5 6.5l3 3" />
    </Svg>
  );
}

export function HighlighterIcon() {
  return (
    <Svg>
      <path d="M9 15l-4.5 4.5" />
      <path d="M8.5 9.5L14 4l6 6-5.5 5.5a2 2 0 0 1-2.8 0L8.5 12.3a2 2 0 0 1 0-2.8z" />
      <path d="M4 20h5" />
    </Svg>
  );
}

export function EraserIcon() {
  return (
    <Svg>
      <path d="M6.5 19.5h13" />
      <path d="M9.3 19.3L4.6 14.6a2 2 0 0 1 0-2.8L12.4 4a2 2 0 0 1 2.8 0l4.3 4.3a2 2 0 0 1 0 2.8l-8.2 8.2z" />
      <path d="M8.5 8l7 7" />
    </Svg>
  );
}

export function HandIcon() {
  return (
    <Svg>
      <path d="M8.5 11.5V5.8a1.4 1.4 0 0 1 2.8 0v4.7" />
      <path d="M11.3 10.5V4.4a1.4 1.4 0 0 1 2.8 0v6.1" />
      <path d="M14.1 10.5V5.6a1.4 1.4 0 0 1 2.8 0v7.9" />
      <path d="M8.5 11.5l-1.6-1.6a1.5 1.5 0 0 0-2.2 2l3.8 5.6A5.6 5.6 0 0 0 13.2 20h.2a5.6 5.6 0 0 0 5.5-5.6v-.9" />
    </Svg>
  );
}

export function LaserIcon() {
  return (
    <Svg>
      <circle cx="8" cy="16" r="3" />
      <path d="M10.5 13.5L20 4" strokeDasharray="3 2.5" />
      <path d="M4 10.5l1.6 1.2M8 6.5l.5 2M13.5 5l-1.2 1.6" />
    </Svg>
  );
}

export function UndoIcon() {
  return (
    <Svg>
      <path d="M8.5 5.5L4 10l4.5 4.5" />
      <path d="M4 10h9a6 6 0 0 1 6 6v2" />
    </Svg>
  );
}

export function RedoIcon() {
  return (
    <Svg>
      <path d="M15.5 5.5L20 10l-4.5 4.5" />
      <path d="M20 10h-9a6 6 0 0 0-6 6v2" />
    </Svg>
  );
}

export function TrashIcon() {
  return (
    <Svg>
      <path d="M4.5 6.5h15" />
      <path d="M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6" />
      <path d="M6.5 6.5l1 13a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5l1-13" />
      <path d="M10 10.5v6M14 10.5v6" />
    </Svg>
  );
}

export function CameraIcon() {
  return (
    <Svg>
      <rect x="3" y="6.5" width="13" height="11" rx="2.5" />
      <path d="M16 10.5l5-2.5v8l-5-2.5" />
    </Svg>
  );
}

export function CameraOffIcon() {
  return (
    <Svg>
      <rect x="3" y="6.5" width="13" height="11" rx="2.5" />
      <path d="M16 10.5l5-2.5v8l-5-2.5" />
      <path d="M3 3l18 18" />
    </Svg>
  );
}

export function MicIcon() {
  return (
    <Svg>
      <rect x="9.5" y="3" width="5" height="11" rx="2.5" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
    </Svg>
  );
}

export function MicOffIcon() {
  return (
    <Svg>
      <rect x="9.5" y="3" width="5" height="11" rx="2.5" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
      <path d="M4 4l16 16" />
    </Svg>
  );
}

export function ChevronLeftIcon() {
  return (
    <Svg>
      <path d="M14.5 5.5L8 12l6.5 6.5" />
    </Svg>
  );
}

export function ShapeCircleIcon() {
  return (
    <Svg width="16" height="16">
      <circle cx="12" cy="12" r="8" />
    </Svg>
  );
}

export function ShapeRoundedIcon() {
  return (
    <Svg width="16" height="16">
      <rect x="3" y="6" width="18" height="12" rx="4" />
    </Svg>
  );
}

export function ShapeRectIcon() {
  return (
    <Svg width="16" height="16">
      <rect x="3" y="6" width="18" height="12" rx="0.5" />
    </Svg>
  );
}

export function MirrorIcon() {
  return (
    <Svg width="16" height="16">
      <path d="M12 3v18" strokeDasharray="2.5 2.5" />
      <path d="M8.5 8L4 12l4.5 4" />
      <path d="M15.5 8L20 12l-4.5 4" />
    </Svg>
  );
}

export function FitIcon() {
  return (
    <Svg width="16" height="16">
      <path d="M9 4H5.5A1.5 1.5 0 0 0 4 5.5V9" />
      <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9" />
      <path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
      <path d="M15 20h3.5a1.5 1.5 0 0 0 1.5-1.5V15" />
      <rect x="9" y="9.5" width="6" height="5" rx="1" />
    </Svg>
  );
}

export function CloseIcon() {
  return (
    <Svg width="16" height="16">
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

export function BoardsIcon() {
  return (
    <Svg>
      <rect x="3.5" y="3.5" width="13" height="13" rx="2" />
      <path d="M7.5 20.5h10a3 3 0 0 0 3-3v-10" />
    </Svg>
  );
}

export function PlusIcon() {
  return (
    <Svg width="16" height="16">
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function LibraryIcon() {
  return (
    <Svg>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M3 9h18M8 4.5V9M16 4.5V9" />
      <path d="M10.5 12.5l4 2.5-4 2.5z" />
    </Svg>
  );
}

export function DownloadIcon() {
  return (
    <Svg>
      <path d="M12 4v11" />
      <path d="M7 10.5l5 5 5-5" />
      <path d="M4.5 19.5h15" />
    </Svg>
  );
}
