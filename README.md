# Scratchy Studio

A tablet-first, local-first whiteboard teaching studio (see `SPEC.md`): write on an
infinite lesson canvas, place a live webcam bubble over it, record the composed stage
with microphone audio entirely in the browser, then preview and download the video.
Nothing is ever uploaded.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

`npm run build` type-checks and produces a production bundle in `dist/`.
`npm run test:e2e` runs the Playwright end-to-end suite against the dev server.

## What's built

- **Infinite canvas** — the 1280×720 stage is a window onto an unbounded world.
  Two-finger drag pans and pinch zooms (0.1×–8×) on touch; mouse users get
  wheel zoom anchored at the cursor, space-drag, middle-drag, and a hand tool
  (`V`). Strokes live in world coordinates and stay vector-crisp at any zoom;
  grid/dot backgrounds scroll with the world and adapt their density when
  zoomed far out.
- **Navigation aids** — corner minimap (whole-board overview + viewport
  rectangle, tap to jump), zoom controls with live readout, zoom-to-fit
  (`1`), reset to 100% (`0`).
- **Ink** — pen / highlighter / whole-stroke eraser, 6 colors, 4 widths,
  undo/redo/clear, pressure-aware smooth strokes (perfect-freehand), palm
  rejection (a second finger right after touch-down converts to pan; a pen
  stroke ignores all touches). Shortcuts: `P` `H` `E` `L` `V` `Z` `Shift+Z`.
- **Laser pointer** (`L`) — ephemeral fading trail for pointing while
  recording; never enters the document, undo history, or autosave.
- **Camera** — enabled only on tap, draggable/resizable overlay clamped to the
  stage (screen-anchored: it stays put while you pan the board), circle /
  rounded / rectangle shapes, mirror toggle, hide/show while recording.
- **Microphone** — enabled only on tap, live level meter, mute/unmute during
  recording, voice-only recording works.
- **Recording follows your view** — the compositor renders the current
  viewport every frame (background → ink → active stroke → laser → camera),
  so panning and zooming mid-recording tours the board on camera.
  `canvas.captureStream(30)` + mic track → `MediaRecorder` with runtime MIME
  negotiation (mp4/h264 first, webm fallback), 3-second cancellable countdown,
  timer, deliberate two-step stop.
- **Boards** — multiple named boards stored in IndexedDB with a switcher in
  the top bar; each board keeps its own ink, viewport, background, and camera
  layout. The pre-existing localStorage lesson imports automatically; if
  IndexedDB is unavailable the app falls back to localStorage autosave.
- **Takes library** — "Save to library" persists recordings (Blobs in
  IndexedDB) per board; the drawer plays, downloads, and deletes takes and
  shows a device-storage estimate. Unsaved takes remain preview-only.
- **PNG export** — current view at 2× (2560×1440) or the whole board fit to
  its ink (longest edge ≤ 4096px), named after the lesson title.
- **Persistence** — the vector lesson (strokes, viewport, tool prefs, camera
  layout, title) autosaves (debounced 600ms) and survives reloads.

## Architecture (src/)

| Area | Files | Notes |
|---|---|---|
| Ink core | `ink/InkEngine.ts` | Imperative pointer handling, gesture modes (draw/erase/pan/laser), viewport-culled committed-ink cache; React never sees per-point events |
| Viewport | `ink/Viewport.ts` | stage↔world transform, pan/zoom/fit, subscription-based change notification |
| Stage | `ink/StageCanvas.tsx` | bg / ink / active canvas layers at a fixed 2× backing store |
| Rendering | `lib/strokes.ts`, `lib/backgrounds.ts`, `lib/laser.ts` | Path2D + bbox caches per stroke; world-anchored backgrounds; shared by display and compositor |
| Media | `media/useCamera.ts`, `useMicrophone.ts`, `CameraOverlay.tsx` | tracks stopped the moment they're disabled |
| Recording | `recording/Compositor.ts`, `useRecorder.ts`, `mime.ts`, `PreviewModal.tsx` | compositor canvas is the authoritative recorded frame and follows the viewport |
| Persistence | `persistence/db.ts`, `boards.ts`, `autosave.ts` | minimal IDB wrapper; multi-board + takes; localStorage fallback + migration |
| Export | `export/png.ts` | view/board PNG via the same culled world renderer |
| UI | `ui/Toolbar.tsx`, `TopBar.tsx`, `Minimap.tsx`, `ZoomControls.tsx`, `BoardsMenu.tsx`, `TakesDrawer.tsx`, `ExportMenu.tsx` | ≥44px touch targets, no hover-required actions |

## Not yet built (per spec, post-MVP here)

Pause/resume, crash-recovery chunked recording, capability probe + device
profile, PWA/offline, recording presets (1080p/vertical), left-handed toolbar
placement, shapes/text/lasso selection tools.

## Verification

`npm run test:e2e` — 19 Playwright tests cover zoom anchoring, world-coordinate
invariance under pans, hand/space/pinch gestures, viewport persistence,
v1→IndexedDB migration, board isolation across reloads, the takes library, the
laser pointer, navigation aids, and PNG export dimensions. An earlier
end-to-end recording script (draw → camera + mic → record → stop → probe the
exported file → reload) passed 14/14 checks against headless Chromium with
fake media devices; ffprobe confirmed a 1280×720 video stream plus audio.
Real-device (iPad/Pencil) verification per spec §10 still pending.
