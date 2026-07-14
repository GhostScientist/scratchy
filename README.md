# Scratchy Studio

A tablet-first, local-first whiteboard teaching studio (MVP of `SPEC.md`): write on a
lesson canvas, place a live webcam bubble over it, record the composed stage with
microphone audio entirely in the browser, then preview and download the video.
Nothing is ever uploaded.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

`npm run build` type-checks and produces a production bundle in `dist/`.

## What's in the MVP

- **Ink** — pen / highlighter / eraser, 6 colors, 4 widths, undo/redo/clear,
  pressure-aware smooth strokes (perfect-freehand), palm rejection (touch never
  draws; stylus and mouse do), keyboard shortcuts `P` `H` `E` `Z` `Shift+Z` `C` `M`.
- **Stage** — fixed 1280×720 recording frame scaled to fit, white / dark / grid /
  dotted backgrounds, red outline while recording.
- **Camera** — enabled only on tap, draggable/resizable overlay clamped to the
  stage, circle / rounded / rectangle shapes, mirror toggle, hide/show without
  stopping a recording.
- **Microphone** — enabled only on tap, live level meter in the top bar,
  mute/unmute during recording, voice-only recording works.
- **Recording** — dedicated composition canvas redrawn every frame
  (background → ink → active stroke → camera), `canvas.captureStream(30)` +
  mic track → `MediaRecorder` with runtime MIME negotiation (mp4/h264 first,
  webm fallback — never assumed), 3-second cancellable countdown, timer,
  deliberate two-step stop.
- **Export** — preview modal, rename, download with a filename matching the
  actual container, size/duration/codec shown, delete take.
- **Persistence** — the editable vector lesson (strokes, tool prefs, camera
  layout, title) autosaves to localStorage and survives reloads. Takes are kept
  separate from the lesson.

## Architecture (src/)

| Area | Files | Notes |
|---|---|---|
| Ink core | `ink/InkEngine.ts` | Imperative pointer handling + committed-ink cache; React never sees per-point events |
| Stage | `ink/StageCanvas.tsx` | bg / ink / active canvas layers at a fixed 2× backing store |
| Media | `media/useCamera.ts`, `useMicrophone.ts`, `CameraOverlay.tsx` | tracks stopped the moment they're disabled |
| Recording | `recording/Compositor.ts`, `useRecorder.ts`, `mime.ts`, `PreviewModal.tsx` | compositor canvas is the authoritative recorded frame |
| Persistence | `persistence/autosave.ts` | debounced, schema-versioned |
| UI | `ui/Toolbar.tsx`, `TopBar.tsx`, `Countdown.tsx` | ≥44px touch targets, no hover-required actions |

## Not yet built (per spec, post-MVP here)

Multiple pages, pause/resume, OPFS/IndexedDB chunk persistence with crash
recovery, capability probe + device profile, PWA/offline, two-finger pan-zoom,
recording presets (1080p/vertical), left-handed toolbar placement.

## Verification

An end-to-end Playwright script (draw → camera + mic → record → stop → probe the
exported file → reload) was run against headless Chromium with fake media
devices: 14/14 checks passed; ffprobe confirmed the export contains a 1280×720
video stream plus an audio stream. Real-device (iPad/Pencil) verification per
spec §10 still pending.
