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

`npm run build` type-checks and produces a production bundle (with the offline
service worker) in `dist/`. `npm run test:e2e` runs the Playwright end-to-end
suite against the dev server; `npm run test:pwa` builds and verifies the
installable/offline behavior against `vite preview`.

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
- **Shapes, text, and lasso selection** — rectangle/ellipse/line/arrow outlines
  (`R`, with a kind flyout), a text tool (`T`) that edits in a DOM overlay and
  renders on canvas, and a lasso select tool (`S`): circle elements to select
  them, drag to move, `Delete` to remove — all undoable and recorded/exported
  like ink. The document model is a discriminated union (`stroke | shape |
  text`); boards migrate from the strokes-only format automatically.
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
- **Pause and resume** — pause mid-take (`Space` while recording, or the top-bar
  control); the timer and take duration count active time only, and a clear
  "Paused" label shows state. Hidden automatically on browsers where the
  capability probe finds pause unreliable.
- **Recording presets** — 720p compatibility (default), 1080p Quality, and
  vertical 1080×1920 for social video. The interactive stage stays 16:9; the
  vertical preset records the centered 9:16 crop of your view, marked by a
  dimmed frame guide. 1080p-class presets are gated behind the device
  performance probe and locked while recording.
- **Capability probe + device profile** — before the first recording, the app
  checks secure context, canvas capture, MediaRecorder, storage, and runs a
  ~1s off-screen smoke recording (including pause/resume and playback of the
  result) plus a 1080p performance probe. The result is cached as a device
  profile (re-checked after browser updates or 30 days), failures produce
  specific guidance, and the settings menu shows the negotiated format with a
  manual "Run device check".
- **Crash-recovery chunked recording** — every MediaRecorder chunk is
  persisted to IndexedDB as it arrives with a per-session manifest heartbeat,
  so recordings never live only in memory. A reload or crash mid-take offers a
  recovery card on the next launch: the captured video reassembles into a
  normal playable, saveable take. Failed chunk writes fall back to memory with
  a warning; low storage headroom warns before recording starts.
- **Boards** — multiple named boards stored in IndexedDB with a switcher in
  the top bar; each board keeps its own ink, viewport, background, and camera
  layout. The pre-existing localStorage lesson imports automatically; if
  IndexedDB is unavailable the app falls back to localStorage autosave.
- **Takes library** — "Save to library" persists recordings (Blobs in
  IndexedDB) per board; the drawer plays, downloads, and deletes takes and
  shows a device-storage estimate. Unsaved takes remain preview-only.
- **PNG export** — current view at 2× (2560×1440) or the whole board fit to
  its ink (longest edge ≤ 4096px), named after the lesson title.
- **Installable PWA** — web app manifest + Workbox service worker precache the
  app shell, so the studio installs to the home screen and opens fully
  offline (production builds only; boards and takes were always local).
- **Left-handed mode** — a settings toggle mirrors the tool rail, its flyouts,
  and the navigation aids to the right side of the stage. Device-global
  preferences (handedness, preset) live in localStorage and apply at first
  paint.
- **Persistence** — the vector lesson (elements, viewport, tool prefs, camera
  layout, title) autosaves (debounced 600ms) and survives reloads.
- **Image import & markup** — import images (top-bar button, drag-drop, or
  paste) as canvas elements: move/resize (aspect-true corner handles) with the
  select tool, lock/unlock via a floating chip so a backdrop can't be dragged
  or erased while you annotate over it. Pixels live in an IndexedDB `assets`
  store; elements only carry a reference.
- **Pages (slide deck)** — each board holds an ordered list of pages with
  their own content and viewport: add/duplicate/reorder/delete from the bottom
  thumbnail strip, flip with PageUp/PageDown (also mid-recording — the
  recording keeps rolling across flips).
- **PDF import** — importing a PDF renders one slide per page (pdf.js, lazy
  loaded, bundled worker so it works offline) and appends them as pages with
  locked backdrops, each opening zoomed to fit.

## Architecture (src/)

| Area | Files | Notes |
|---|---|---|
| Ink core | `ink/InkEngine.ts` | Imperative pointer handling, gesture modes (draw/erase/pan/laser/shape/lasso/select-move/select-resize), viewport-culled committed-ink cache, command-stack undo (add/erase/move/setText/resize/setLocked); React never sees per-point events |
| Viewport | `ink/Viewport.ts` | stage↔world transform, pan/zoom/fit, subscription-based change notification |
| Stage | `ink/StageCanvas.tsx` | bg / ink / active canvas layers at a fixed 2× backing store |
| Rendering | `lib/strokes.ts`, `lib/elements.ts`, `lib/lasso.ts`, `lib/backgrounds.ts`, `lib/laser.ts` | Path2D + bbox caches per element; stroke/shape/text dispatch shared by display, compositor, minimap, and PNG export; point-in-polygon lasso |
| Media | `media/useCamera.ts`, `useMicrophone.ts`, `CameraOverlay.tsx` | tracks stopped the moment they're disabled |
| Recording | `recording/Compositor.ts`, `useRecorder.ts`, `presets.ts`, `mime.ts`, `RecordingStore.ts`, `PreviewModal.tsx` | preset-sized compositor canvas driven by an "effective viewport" (stage crop + scale); pause/resume with active-time accounting; chunks persist incrementally with a manifest for crash recovery |
| Capability | `capability/probe.ts`, `profile.ts` | SPEC §9 checks + smoke recording + 1080p performance probe, cached as a localStorage device profile |
| Persistence | `persistence/db.ts`, `boards.ts`, `assets.ts`, `autosave.ts` | minimal IDB wrapper (v3: boards, takes, meta, recSessions, recChunks, assets); multi-board + pages + takes + image assets (orphans swept at init/board-delete); localStorage fallback + v1→v5 migrations |
| Import | `import/images.ts`, `import/pdf.ts`, `lib/imageCache.ts` | image files → assets + elements; PDF → one locked backdrop page per PDF page via lazy-loaded pdf.js (legacy build, bundled worker); LRU ImageBitmap cache keyed by assetId |
| Settings | `settings/settings.ts` | device-global prefs (handedness, preset) in localStorage, applied at first paint |
| Export | `export/png.ts` | view/board PNG via the same culled world renderer |
| UI | `ui/Toolbar.tsx`, `TopBar.tsx`, `SettingsMenu.tsx`, `Minimap.tsx`, `ZoomControls.tsx`, `BoardsMenu.tsx`, `PageStrip.tsx`, `SelectionActions.tsx`, `TakesDrawer.tsx`, `ExportMenu.tsx`, `RecoveryCard.tsx`, `TextEditorOverlay.tsx` | ≥44px touch targets, no hover-required actions |
| PWA | `vite.config.ts` (vite-plugin-pwa), `public/icons/` | autoUpdate service worker, precached shell, installable manifest |

## Not yet built (per spec, post-MVP here)

OPFS recording storage, stroke transformation beyond move (resize/rotate is
images-only), equation recognition, background blur, WebCodecs export, and
the other SPEC §21 future opportunities.

## Verification

`npm run test:e2e` — 48 Playwright tests cover zoom anchoring, world-coordinate
invariance under pans, hand/space/pinch gestures, viewport persistence,
v1→IndexedDB migration, board isolation across reloads, the takes library, the
laser pointer, navigation aids, PNG export dimensions, left-handed layout,
pause/resume timing, the capability probe (including the no-MediaRecorder
path), per-preset output resolutions (720p/1080p/vertical verified via the
preview video's `videoWidth×videoHeight`), incremental chunk persistence and
crash recovery across reloads, the shape/text/lasso tools with the v3→v4
board migration, pages (isolation, navigation, duplicate/reorder/delete,
reload persistence, v4→v5 migration), image import (move/resize/undo,
lock/unlock semantics, asset round-trip), and PDF import (slides with locked
backdrops surviving reload). `npm run test:pwa` — 2 more tests build the app
and verify the manifest and offline shell against `vite preview`.

An earlier end-to-end recording script (draw → camera + mic → record → stop →
probe the exported file → reload) passed 14/14 checks against headless
Chromium with fake media devices; ffprobe confirmed a 1280×720 video stream
plus audio. Real-device (iPad/Pencil) verification per spec §10 still pending
— pause reliability, installed-PWA recording, and Bluetooth audio in
particular.
