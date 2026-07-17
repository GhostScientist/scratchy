import type { ReactNode } from 'react';
import { INK_COLORS } from '../ui/Toolbar';
import {
  BoardsIcon,
  DownloadIcon,
  DuplicateIcon,
  ImageIcon,
  LibraryIcon,
  MirrorIcon,
  ShapePersonIcon,
} from '../ui/icons';

export interface OnboardingSlide {
  id: string;
  title: string;
  body: string;
  /** Demo clip at public/onboarding/<id>.mp4 — see SlideMedia for the contract. */
  video?: string;
  /** Animated art shown until the clip is available (or forever without one). */
  fallback: ReactNode;
  mediaLabel: string;
}

/** Bouncing ink dots + drifting confetti in the app's own palette
 *  (minus the near-black ink, invisible on the dark panel). */
const PARTY_COLORS = INK_COLORS.filter((c) => c !== '#1d1f24');

function WelcomeDemo() {
  return (
    <div className="demo demo-welcome">
      {PARTY_COLORS.map((c, i) => (
        <span
          key={c}
          className="party-dot"
          style={{ background: c, animationDelay: `${i * 120}ms` }}
        />
      ))}
      {PARTY_COLORS.map((c, i) => (
        <span
          key={`c-${c}`}
          className={`confetti${i % 2 ? ' square' : ''}`}
          style={{
            background: c,
            left: `${10 + i * 17}%`,
            top: `${i % 2 ? 16 : 68}%`,
            animationDelay: `${i * 350}ms`,
          }}
        />
      ))}
    </div>
  );
}

/** A stroke that draws itself, looping. */
function CanvasDemo() {
  return (
    <div className="demo demo-canvas">
      <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid meet">
        <path
          className="draw-a"
          d="M28 122 C 66 38, 118 40, 150 96 S 238 152, 292 66"
          fill="none"
          stroke="#3b82f6"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <path
          className="draw-b"
          d="M70 150 C 120 138, 200 138, 252 148"
          fill="none"
          stroke="#f5a524"
          strokeWidth="10"
          strokeLinecap="round"
          opacity="0.55"
        />
      </svg>
    </div>
  );
}

/** A camera bubble drifting across a little board. */
function CameraDemo() {
  return (
    <div className="demo demo-camera">
      <svg className="demo-cam-ink" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid meet">
        <path
          d="M40 60 C 90 20, 150 30, 170 70 S 260 110, 285 58"
          fill="none"
          stroke="#30a46c"
          strokeWidth="6"
          strokeLinecap="round"
        />
      </svg>
      <div className="demo-cam-bubble">
        <ShapePersonIcon />
      </div>
    </div>
  );
}

/** Pulsing REC dot over a filling take bar. */
function RecordDemo() {
  return (
    <div className="demo demo-record">
      <div className="demo-rec-badge">
        <span className="demo-rec-dot" />
        REC
      </div>
      <div className="demo-rec-bar">
        <span />
      </div>
    </div>
  );
}

/** Feature glyph tiles. */
function EverywhereDemo() {
  const tiles: { label: string; icon: ReactNode }[] = [
    { label: 'Boards', icon: <BoardsIcon /> },
    { label: 'Pages', icon: <DuplicateIcon /> },
    { label: 'PDF & images', icon: <ImageIcon /> },
    { label: 'PNG export', icon: <DownloadIcon /> },
    { label: 'Takes library', icon: <LibraryIcon /> },
    { label: 'Left-handed', icon: <MirrorIcon /> },
  ];
  return (
    <div className="demo demo-everywhere">
      {tiles.map((t, i) => (
        <div key={t.label} className="demo-tile" style={{ animationDelay: `${i * 90}ms` }}>
          {t.icon}
          <span>{t.label}</span>
        </div>
      ))}
    </div>
  );
}

export const SLIDES: OnboardingSlide[] = [
  {
    id: 'welcome',
    title: 'Welcome to Scribble Party',
    body: 'A whiteboard studio for teaching. Draw, talk, record, and share. Everything stays on this device and nothing is ever uploaded.',
    fallback: <WelcomeDemo />,
    mediaLabel: 'Colorful ink dots bouncing in celebration',
  },
  {
    id: 'canvas',
    title: 'An endless canvas',
    body: 'Pinch to zoom, drag with two fingers to move around. Pen, highlighter, shapes, and text. Ink is pressure-aware, with palm rejection when you write with a stylus.',
    video: '/onboarding/canvas.mp4',
    fallback: <CanvasDemo />,
    mediaLabel: 'A pen stroke drawing itself across the board',
  },
  {
    id: 'camera',
    title: 'Put yourself in the lesson',
    body: 'Drop a live camera bubble onto the board and drag it wherever it fits. Your background gets cut out automatically.',
    video: '/onboarding/camera.mp4',
    fallback: <CameraDemo />,
    mediaLabel: 'A camera bubble drifting over the board',
  },
  {
    id: 'record',
    title: 'Record and keep every take',
    body: 'Record the whole stage with your voice. If the tab crashes mid-lesson your recording is recovered on the next launch, and takes live in your local library.',
    video: '/onboarding/record.mp4',
    fallback: <RecordDemo />,
    mediaLabel: 'A recording indicator with a progress bar',
  },
  {
    id: 'everywhere',
    title: 'Made for teaching anywhere',
    body: 'Multiple boards, pages, PDF import, PNG export. Works fully offline as an installed app, and flips for left-handed teachers.',
    fallback: <EverywhereDemo />,
    mediaLabel: 'A grid of feature icons',
  },
];
