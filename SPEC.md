# Tablet-First Whiteboard Teaching Studio
## Product and Engineering Specification
**Version:** 0.1  
**Status:** Build-ready draft  
**Working description:** A local-first browser studio for recording handwritten educational lessons with optional webcam video and microphone audio.

---

## 1. Product vision

Create a tablet-first web application that lets an educator:

1. Open a clean lesson canvas.
2. Write naturally with Apple Pencil or another pressure-sensitive stylus.
3. Place an optional live webcam view over the lesson.
4. Record the composed lesson, including handwriting, camera, and microphone, entirely inside the browser.
5. Preview and download the result without uploading private media to a server.

The product should feel like a purpose-built teaching instrument, not a generic collaborative whiteboard with recording bolted onto it.

### Product promise

> Open the app, pick up a Pencil, teach, and leave with a video.

---

## 2. Goals

### Primary goals

- Excellent low-latency handwriting on iPad with Apple Pencil.
- Strong support for Android tablets, Surface devices, mouse, and trackpad.
- Local browser recording of:
  - Whiteboard content
  - Live webcam
  - Microphone audio
  - Optional cursor, spotlight, and overlays
- Direct video preview and download.
- No account, backend, or upload required for the core workflow.
- Recoverable projects and recording sessions after ordinary interruptions.
- Clear behavior when a browser, codec, storage system, or device capability is unavailable.

### Secondary goals

- Installable Progressive Web App.
- Multiple pages or slides within one lesson.
- Portrait, landscape, square, and vertical-video recording stages.
- Reusable lesson projects containing editable vector ink.
- Camera layouts designed for educational content.
- Keyboard shortcuts when a tablet keyboard is attached.

### Non-goals for the MVP

- Real-time collaboration.
- Livestreaming.
- Cloud synchronization.
- Server-side transcoding.
- Automatic transcription.
- AI-generated notes, chapters, quizzes, or diagrams.
- Full vector-design-tool features.
- Advanced video editing.
- Guaranteed identical export codecs across browsers.
- Proprietary Apple Pencil gestures as required controls.

---

## 3. Target users

### Primary user

An educator, tutor, engineer, researcher, or creator who wants to explain a concept by writing on a tablet while optionally appearing on camera.

### Primary environments

- iPad in landscape orientation with Apple Pencil.
- Android tablet with an active stylus.
- Microsoft Surface or pen-enabled Windows device.
- Desktop or laptop with webcam, microphone, mouse, or drawing tablet.

### Representative use cases

- Explain a mathematical derivation.
- Annotate a diagram while speaking.
- Record a software architecture lesson.
- Work through an interview problem.
- Create a short social-video explanation in a vertical layout.
- Record a voice-only whiteboard lesson without camera video.
- Introduce a lesson on camera, hide the camera during detailed writing, and restore it for the conclusion.

---

## 4. Experience principles

1. **Ink first.** Drawing latency and stroke quality outrank decorative interface features.
2. **Tablet native.** Controls must accommodate Pencil, fingers, palms, and limited screen space.
3. **Private by default.** Media remains on the device unless the user deliberately exports or shares it.
4. **Recoverable by design.** The app should persist editable lesson data and recording chunks incrementally.
5. **Honest capability detection.** The app must test browser support and never promise an unavailable format.
6. **A predictable frame.** The recorded result must always match a visible fixed stage.
7. **Quiet controls.** The interface should disappear while teaching and return instantly when needed.

---

## 5. Core user journey

### 5.1 Start

The user opens the app and sees:

- New lesson
- Recent local lessons
- Recording format preset
- Camera and microphone readiness
- Storage availability warning, when relevant

A new lesson defaults to:

- 16:9 landscape
- 1280 × 720 recording output
- White background
- Dark monoline teaching pen
- Camera off until explicitly enabled
- Microphone selected but not active until permission is granted
- Finger drawing off
- Two-finger pan and zoom on

### 5.2 Prepare

The user can:

- Select a camera and microphone.
- Enable or disable the camera bubble.
- Choose a camera shape and position.
- Select board background and recording dimensions.
- Test the microphone level.
- Mirror the local camera preview.
- Choose whether the final recording is mirrored.
- Select left-handed or right-handed toolbar placement.

### 5.3 Teach

The user writes with a Pencil or stylus.

- Stylus input draws.
- Touch input does not draw by default.
- Two fingers pan and zoom.
- A palm contacting the screen during an active pen stroke is ignored.
- The toolbar can collapse to a small handle.
- Undo, redo, color, pen, eraser, and page controls remain reachable.
- Camera visibility can be toggled without stopping the recording.
- The recording frame remains visibly bounded.

### 5.4 Record

The user taps Record.

1. The app validates camera, microphone, recorder, storage, and stage readiness.
2. A three-second countdown appears.
3. Recording begins.
4. The app shows:
   - Recording state
   - Elapsed time
   - Microphone activity
   - Storage or recorder warning
   - Pause and stop controls
5. Media chunks are persisted incrementally.
6. The user can pause, resume, or stop.

### 5.5 Review and export

After stopping:

- The app finalizes the local recording.
- A video preview appears.
- The user can:
  - Play the recording
  - Rename it
  - Download or share the video
  - Return to the editable lesson
  - Start another take
  - Delete the take
- The app clearly displays the actual generated container and codec when known.

---

## 6. Functional requirements

## 6.1 Whiteboard

### Required for MVP

- Fixed visible lesson stage.
- Pen tool.
- Highlighter.
- Eraser.
- Undo and redo.
- Clear current page.
- Configurable pen width.
- Configurable color.
- Pressure sensitivity toggle.
- Multiple background presets:
  - White
  - Dark
  - Grid
  - Dotted
- Multiple lesson pages.
- Page add, duplicate, reorder, and delete.
- Zoom and pan.
- Fit stage to screen.
- Editable vector stroke storage.
- Autosave after each completed stroke or operation.
- Export current page as PNG.

### Post-MVP

- Text tool.
- Shape tool.
- Image insertion.
- Lasso selection.
- Stroke transformation.
- Equation recognition.
- Diagram connectors.
- Layers.
- Templates.
- Presenter notes outside the recorded stage.

---

## 6.2 Stylus and touch

### Input model

Use Pointer Events as the primary input abstraction.

Each captured stroke point should support:

```ts
type StrokePoint = {
  x: number;          // Logical stage coordinate
  y: number;          // Logical stage coordinate
  pressure: number;   // Normalized, with a fallback
  tiltX?: number;
  tiltY?: number;
  twist?: number;
  timestamp: number;
};
```

### Required behavior

- Recognize `pen`, `touch`, and `mouse` pointer types.
- Use coalesced pointer samples when available.
- Capture the active pointer until stroke completion.
- Ignore new touch contacts while a pen stroke is active.
- Disable browser panning, text selection, callouts, and overscroll on the drawing surface.
- Keep normal touch behavior on dialogs, forms, and non-canvas interface elements.
- Expose a Finger Drawing setting:
  - Off by default on touch-capable devices
  - On when explicitly enabled
- Support two-finger pan and pinch zoom when no pen stroke is active.
- Provide left-handed and right-handed toolbar placement.
- Fall back cleanly when pressure or tilt values are unavailable.

### Stroke rendering

- Normalize points to the logical lesson-stage coordinate system.
- Apply light smoothing that preserves corners and handwriting character.
- Provide a monoline brush with pressure disabled.
- Keep pressure response subtle for the default teaching pen.
- Render the active stroke immediately without waiting for React state updates.
- Commit completed strokes to the document model.

### Latency target

- Target perceived input-to-ink latency below 30 ms on supported modern tablets.
- Do not block the drawing path with network requests, React reconciliation, serialization, or media encoding work.

---

## 6.3 Camera

### Required for MVP

- Request camera permission only after an explicit user action.
- Enumerate camera devices after permission is granted.
- Show a movable and resizable camera overlay.
- Camera shapes:
  - Circle
  - Rounded rectangle
  - Rectangle
- Camera visibility toggle during recording.
- Preview mirroring toggle.
- Final-output mirroring toggle.
- Maintain camera aspect ratio during resizing.
- Keep camera placement within the recorded stage.
- Persist camera layout per lesson.

### Post-MVP

- Background blur.
- Background removal.
- Branded frame.
- Full-height presenter layout.
- Intro and outro layout presets.
- Automatic camera framing.

---

## 6.4 Microphone and audio

### Required for MVP

- Request microphone permission only after an explicit user action.
- Enumerate available audio inputs after permission is granted.
- Display a live microphone meter.
- Support microphone mute and unmute during recording.
- Detect a missing or ended microphone track.
- Record voice with the composed video.
- Allow a camera-off, microphone-on lesson.

### Audio architecture

- Use the selected microphone track as the recording audio source.
- Use a Web Audio analyser in parallel for metering.
- Do not require Web Audio processing in the recording path for MVP.
- Abstract audio mixing so sound effects or music can be introduced later.

### Post-MVP

- Gain control.
- Noise suppression controls.
- Multiple audio sources.
- Imported music.
- Intro and outro sounds.
- Automatic silence trimming.

---

## 6.5 Recording

### Composition model

All visible recorded elements must be drawn into a dedicated composition canvas:

- Board background
- Completed strokes
- Active stroke
- Imported lesson graphics, when supported
- Webcam video
- Cursor or laser pointer, when enabled
- Recording-safe branding
- Optional page transition

The composition canvas is the authoritative visual source for the output video.

### Required pipeline

```text
Camera MediaStream
        ↓
Hidden or off-screen video element
        ↓
Composition canvas ← Whiteboard renderer and overlays
        ↓
Canvas MediaStream video track
        +
Microphone MediaStream audio track
        ↓
MediaRecorder
        ↓
Incremental media chunks
        ↓
Local persistence
        ↓
Preview and export
```

### Recorder state machine

```ts
type RecorderState =
  | "idle"
  | "requesting-permissions"
  | "ready"
  | "countdown"
  | "recording"
  | "paused"
  | "stopping"
  | "finalizing"
  | "complete"
  | "error";
```

### Format negotiation

The app must call `MediaRecorder.isTypeSupported()` against an ordered list of candidate media types.

Rules:

- Do not assume MP4 support.
- Do not assume WebM support.
- Select the first supported candidate that passes a short recording probe.
- Record the selected media type in session metadata.
- Display the actual output type to the user.
- Provide a useful error when the browser cannot create a supported recording.
- Keep format selection behind a `RecorderAdapter` interface for future WebCodecs support.

### Recording presets

#### Compatibility
- 1280 × 720
- 24 or 30 fps
- Conservative video bitrate
- Default on devices that fail a performance probe

#### Quality
- 1920 × 1080
- 30 fps
- Higher video bitrate
- Enabled only after capability checks

#### Vertical
- 1080 × 1920 or a lower compatible equivalent
- 30 fps

### Chunking

- Request recorder data in regular chunks.
- Persist each non-empty chunk as it arrives.
- Do not keep an entire long recording only in memory.
- Track elapsed time independently from chunk timing.
- Save a manifest containing chunk order, media type, timestamps, and recording state.
- Attempt recovery after an ordinary reload or crash.

### Pause and resume

- Pause and resume should preserve one logical take.
- UI timing must exclude paused duration from active duration.
- Verify browser behavior on each supported tablet class.
- If pause is unreliable on a platform, hide the control and offer stop plus new take instead.

---

## 6.6 Projects and local persistence

### Project data

```ts
type LessonProject = {
  id: string;
  schemaVersion: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  stage: StageConfig;
  pages: LessonPage[];
  camera: CameraLayout;
  drawingPreferences: DrawingPreferences;
  lastOpenedPageId: string;
};

type LessonPage = {
  id: string;
  name: string;
  background: BackgroundConfig;
  strokes: Stroke[];
  order: number;
};

type Stroke = {
  id: string;
  tool: "pen" | "highlighter" | "eraser";
  color: string;
  opacity: number;
  baseWidth: number;
  pressureEnabled: boolean;
  points: StrokePoint[];
};
```

### Storage adapter

```ts
interface ProjectStore {
  listProjects(): Promise<ProjectSummary[]>;
  loadProject(id: string): Promise<LessonProject>;
  saveProject(project: LessonProject): Promise<void>;
  deleteProject(id: string): Promise<void>;
}

interface RecordingStore {
  createSession(meta: RecordingManifest): Promise<void>;
  appendChunk(sessionId: string, index: number, blob: Blob): Promise<void>;
  finalizeSession(sessionId: string): Promise<Blob>;
  recoverSessions(): Promise<RecoverableSession[]>;
  deleteSession(sessionId: string): Promise<void>;
}
```

### Storage strategy

1. Prefer the Origin Private File System for recording chunks when usable.
2. Fall back to IndexedDB.
3. Use memory-only storage only for short compatibility-mode recordings.
4. Call `navigator.storage.estimate()` before recording.
5. Warn when estimated free storage is insufficient.
6. Request persistent storage when supported and appropriate.
7. Explain that clearing site data deletes local projects and unfinished recordings.
8. Offer explicit project export and import in a later release.

---

## 6.7 Export

### Required for MVP

- Assemble the recorded chunks into a playable local Blob.
- Preview the Blob in the app.
- Download or invoke the platform share flow where supported.
- Use a file extension consistent with the actual output media type.
- Include lesson title and timestamp in the default filename.
- Revoke object URLs after they are no longer needed.
- Preserve the editable lesson separately from the video take.

### Post-MVP

- Deterministic MP4 export.
- WebCodecs encoder pipeline.
- Server-assisted optional transcoding.
- Trimming.
- Thumbnail selection.
- Chapter markers.
- Caption sidecar export.

---

## 7. Interface specification

## 7.1 Studio layout

Landscape tablet default:

```text
┌──────────────────────────────────────────────────────────┐
│ Project title                      Mic   Camera   Record  │
├──────┬───────────────────────────────────────────────────┤
│ Pen  │                                                   │
│ Mark │              Recorded lesson stage                │
│ Erase│                                                   │
│ Color│                                      ┌─────────┐  │
│ Width│                                      │ Camera  │  │
│ Undo │                                      └─────────┘  │
│ Page │                                                   │
├──────┴───────────────────────────────────────────────────┤
│ Page strip / collapsed controls / recording timer        │
└──────────────────────────────────────────────────────────┘
```

### Responsive behavior

- On a large tablet, use a side toolbar and bottom page strip.
- On a small tablet, collapse the page strip into a page button.
- In portrait orientation, recommend switching to a vertical-video preset or rotating the device.
- Do not automatically change the recording aspect ratio when device orientation changes.
- Freeze layout changes during active recording unless the user explicitly confirms.

## 7.2 Toolbar

Required controls:

- Pen
- Highlighter
- Eraser
- Color
- Width
- Undo
- Redo
- Page
- Fit
- Camera
- Microphone
- Record

Toolbar requirements:

- Minimum touch target of approximately 44 CSS pixels.
- Clear active-state feedback.
- Tooltips or labels.
- Collapsible during teaching.
- Configurable left or right placement.
- No essential action dependent on hover.

## 7.3 Recording controls

During recording:

- Timer
- Pause or resume, when supported
- Stop
- Camera visibility
- Microphone mute
- Current page
- Non-intrusive warning area

Avoid:

- Modal dialogs during recording.
- Toolbar animations that obscure the stage.
- Accidental stop from a single imprecise tap.

Stopping should require either:

- A deliberate press-and-hold, or
- A tap followed by a compact confirmation that does not cover the lesson.

---

## 8. Technical architecture

## 8.1 Recommended stack

- React
- TypeScript
- Vite
- Canvas 2D rendering
- Pointer Events
- Media Capture and Streams API
- MediaStream Recording API
- IndexedDB and OPFS storage adapters
- Service Worker for installability and offline application assets
- Vitest for unit tests
- Playwright for browser interaction tests
- Real-device manual and automated smoke testing where possible

### Why a custom canvas renderer

The live stroke path must remain independent from React rendering. A custom renderer provides direct control over:

- Coalesced samples
- Pressure mapping
- Stroke smoothing
- Canvas caching
- Logical stage transforms
- Recording composition
- Performance instrumentation

A scene-graph library may be introduced later for text, shapes, and selection, but it should not own the latency-critical ink path unless profiling proves it suitable.

---

## 8.2 Canvas layers

Use distinct logical layers:

1. **Background layer**
2. **Committed ink cache**
3. **Active stroke layer**
4. **Selection or gesture layer**
5. **Camera and interface preview layer**
6. **Recording composition canvas**

The displayed interaction canvas and recording composition canvas are related but not identical.

### Interaction canvas

- Sized for the device display and device-pixel ratio.
- Optimized for responsive Pencil feedback.
- May show controls or guides that are excluded from recording.

### Composition canvas

- Fixed at the selected recording resolution.
- Drawn on every output frame.
- Contains only elements intended for the final video.
- Uses logical stage coordinates transformed to output pixels.

---

## 8.3 Render loop

```ts
function renderFrame(now: DOMHighResTimeStamp) {
  renderInteractionSurface(now);

  if (recorderState === "recording" || recorderState === "paused") {
    renderCompositionSurface(now);
  }

  requestAnimationFrame(renderFrame);
}
```

Optimization rules:

- Cache committed strokes.
- Draw only the active stroke dynamically.
- Rebuild caches when a page changes, stroke is undone, or zoom-dependent rendering requires it.
- Avoid allocating large arrays each frame.
- Avoid reading canvas pixels during normal rendering.
- Keep webcam video drawing independent from document mutation.
- Measure dropped frames and long tasks during test builds.

---

## 8.4 Suggested module boundaries

```text
src/
  app/
    App.tsx
    routes.ts
  studio/
    StudioScreen.tsx
    StudioController.ts
    studioState.ts
  drawing/
    PointerInputController.ts
    StrokeBuilder.ts
    StrokeSmoother.ts
    WhiteboardRenderer.ts
    InkCache.ts
    gestures/
  composition/
    CompositionRenderer.ts
    CameraLayer.ts
    OverlayLayer.ts
  media/
    MediaDeviceManager.ts
    CameraController.ts
    MicrophoneController.ts
    AudioMeter.ts
  recording/
    RecorderController.ts
    RecorderAdapter.ts
    MediaRecorderAdapter.ts
    MimeNegotiator.ts
    RecordingManifest.ts
  storage/
    ProjectStore.ts
    RecordingStore.ts
    OpfsRecordingStore.ts
    IndexedDbRecordingStore.ts
  projects/
    ProjectRepository.ts
    projectSchema.ts
    migrations.ts
  ui/
    Toolbar.tsx
    RecordControls.tsx
    DevicePicker.tsx
    ExportDialog.tsx
  diagnostics/
    CapabilityProbe.ts
    PerformanceProbe.ts
    DebugReport.ts
```

---

## 9. Capability and compatibility gates

Before enabling recording, run a capability probe.

### Required checks

- Secure context.
- `navigator.mediaDevices`.
- Camera and microphone permissions or availability.
- Pointer Events.
- Canvas 2D context.
- `canvas.captureStream`.
- `MediaRecorder`.
- At least one successful supported media-type probe.
- Local storage adapter availability.
- Estimated available storage.
- A short capture and recorder smoke test.
- Video playback of the resulting test Blob.

### Device profile

Store a local capability profile containing:

- Browser and platform hints
- Chosen recording media type
- Successful resolutions
- Successful frame rates
- Preferred storage adapter
- Pause and resume reliability
- Last probe date
- Known warning flags

Do not use the device profile as a permanent truth. Re-run relevant checks after browser upgrades or failures.

---

## 10. iPad-specific requirements

iPad is a launch platform, not an afterthought.

### Required

- Test on physical iPad hardware.
- Support Apple Pencil through standard Pointer Events.
- Ignore accidental palm contacts during active pen strokes.
- Prevent drawing-surface scroll, zoom, text selection, and callouts.
- Keep controls usable with touch.
- Do not depend on hover.
- Support landscape orientation without browser chrome covering essential controls.
- Recover from ordinary page reloads.
- Warn that locking the screen, switching apps, or backgrounding the browser may interrupt recording.
- Verify camera, microphone, canvas capture, recording, chunk delivery, playback, and export on current iPadOS Safari.
- Verify installed PWA mode separately from a normal Safari tab.
- Verify Bluetooth microphone and built-in microphone behavior.
- Verify front and rear camera selection when exposed by the browser.
- Verify that long recordings do not remain solely in memory.
- Provide a compatibility recording mode when high-quality capture fails.

### Progressive enhancements

- Pencil hover preview.
- Additional angle or orientation data.
- Predicted pointer samples.
- Proprietary Pencil gestures, only when a standards-based fallback exists.

---

## 11. Privacy and security

### Privacy

- No media upload in the core product.
- No recording analytics containing media content.
- Camera and microphone tracks stop immediately when no longer needed.
- Clearly indicate when camera or microphone is active.
- Store projects and recordings only in the app origin's local storage.
- Explain local-data deletion behavior.
- Provide one-tap deletion of projects and takes.

### Security

- Production must use HTTPS.
- Apply a restrictive Content Security Policy.
- Avoid third-party scripts on the recording route.
- Do not render untrusted cross-origin images into the composition canvas without proper CORS handling.
- Sanitize imported project data.
- Version and validate all persisted schemas.
- Do not silently request camera or microphone access on page load.

---

## 12. Accessibility

- All toolbar actions have accessible names.
- Full keyboard navigation for non-drawing controls.
- High-contrast recording status.
- Do not communicate state through color alone.
- Support reduced-motion preferences.
- Provide keyboard shortcuts:
  - `P`: pen
  - `E`: eraser
  - `H`: highlighter
  - `Z`: undo
  - `Shift+Z`: redo
  - `C`: camera toggle
  - `M`: microphone toggle
  - `Space`: pause or resume when focus is not in a text field
- Provide shortcut discovery.
- Keep focus indicators visible.
- Ensure dialogs do not trap Pencil input unexpectedly.

---

## 13. Performance requirements

### Drawing

- Active strokes should visually follow the stylus without obvious trailing.
- Drawing must remain usable while the camera preview is active.
- Completed strokes should be cached.
- React state must not update for every raw point.
- Autosave work must be deferred or performed incrementally.

### Recording

- Maintain the selected output frame rate under expected use.
- Detect sustained frame drops and display a non-blocking warning.
- Offer downgrade from 1080p to 720p.
- Avoid unnecessary webcam scaling more than once per frame.
- Persist chunks incrementally.
- Continue recording when autosave is delayed.
- Never sacrifice stroke input responsiveness to maintain decorative animations.

### Compatibility target

The MVP is considered viable when a representative current iPad can complete a 20-minute 720p lesson with:

- Continuous Pencil writing
- Front camera overlay
- Microphone audio
- Multiple page changes
- No crash
- A playable downloaded result
- An editable lesson project preserved afterward

---

## 14. Error handling

The app must provide specific recovery guidance for:

- Camera permission denied.
- Microphone permission denied.
- No camera found.
- No microphone found.
- Camera track ended.
- Microphone track ended.
- Recorder initialization failed.
- Unsupported media type.
- Recording chunk failed to persist.
- Local storage quota reached.
- Browser tab backgrounded.
- Device orientation changed.
- Screen locked.
- App reloaded during recording.
- Video finalization failed.
- Export or share failed.

### Error design

Every error should answer:

1. What happened?
2. Is the current lesson data safe?
3. Is any portion of the recording recoverable?
4. What action should the user take next?

---

## 15. Telemetry

Telemetry is optional and must not include media or stroke contents.

Permitted anonymous events:

- Capability probe success or failure.
- Selected recording preset.
- Recorder initialization failure category.
- Recording completed.
- Recording recovery attempted.
- Export failed.
- Performance downgrade triggered.

Local diagnostics should be exportable as a text report containing:

- App version
- Browser hints
- Feature checks
- Chosen MIME type
- Canvas dimensions
- Recording state transitions
- Non-sensitive error names
- Storage estimates
- Performance counters

---

## 16. Testing strategy

## 16.1 Unit tests

- Stroke point normalization.
- Pressure mapping.
- Stroke smoothing.
- Undo and redo reducer.
- Page operations.
- Coordinate transforms.
- MIME-type candidate ordering.
- Recorder state transitions.
- Recording manifest recovery.
- Project schema migrations.
- Filename generation.

## 16.2 Integration tests

- Pointer input to committed stroke.
- Touch gestures do not create ink in stylus mode.
- Camera preview renders into composition.
- Microphone track joins recording stream.
- Recorder emits and persists chunks.
- Stop produces a previewable Blob.
- Project reload restores pages and strokes.
- Failed persistence enters a recoverable error state.

## 16.3 Browser automation

Use Playwright where browser APIs can be simulated:

- Project creation.
- Toolbar behavior.
- Page management.
- Undo and redo.
- Responsive layouts.
- Permission-denied paths.
- Mock media stream recording.
- Export UI.

## 16.4 Physical-device matrix

Minimum launch matrix:

- Recent iPad Pro with Apple Pencil.
- Recent iPad Air or standard iPad with Apple Pencil.
- One older supported iPad with constrained memory.
- Samsung Galaxy Tab with S Pen.
- Microsoft Surface with pen.
- macOS Safari.
- Desktop Chrome.
- Desktop Edge.

Test both:

- Browser tab mode.
- Installed PWA mode, where supported.

## 16.5 Long-session tests

For each primary device class:

- 5-minute smoke recording.
- 20-minute standard recording.
- 45-minute stress recording.
- Camera on and off.
- Multiple pages.
- Frequent undo and redo.
- Pause and resume.
- Low storage.
- Background and foreground transition.
- Incoming system interruption.
- Bluetooth audio.
- Orientation change.

---

## 17. Milestones

## Milestone 0: Feasibility spike

Build the smallest real-device test that proves:

- Apple Pencil Pointer Events
- Pressure capture
- Coalesced samples
- Smooth canvas ink
- iPad camera and microphone capture
- Composition-canvas capture
- MediaRecorder output
- Incremental chunk receipt
- Local chunk persistence
- Final playback and export

### Exit criteria

A physical iPad produces a playable recording containing:

- Pencil ink
- Front camera
- Microphone audio

The test result and browser-specific behavior are documented before the full product shell is built.

---

## Milestone 1: Ink engine

Deliver:

- Fixed lesson stage
- Pen, highlighter, and eraser
- Pressure option
- Palm-defense rules
- Pan and zoom
- Undo and redo
- Multiple pages
- Autosaved vector project

### Exit criteria

A user can write naturally for ten minutes on a tablet without accidental finger ink, lost strokes, or visible degradation as stroke count grows.

---

## Milestone 2: Studio media

Deliver:

- Device permission flow
- Camera picker
- Microphone picker
- Camera overlay
- Mic meter
- Mirror controls
- Camera and microphone toggles

### Exit criteria

Camera and microphone setup is understandable without documentation, and the composed preview matches the intended output layout.

---

## Milestone 3: Recording and export

Deliver:

- Capability probe
- Format negotiation
- Countdown
- Record, pause, resume, and stop
- Chunk persistence
- Preview
- Download or share
- Recording manifest

### Exit criteria

All launch device classes produce a playable recording or receive a specific compatibility message before recording starts.

---

## Milestone 4: Recovery and resilience

Deliver:

- Recoverable interrupted sessions
- Low-storage handling
- Track-ended handling
- Orientation and background warnings
- Project migrations
- Local diagnostics export

### Exit criteria

Ordinary browser reloads do not destroy the editable lesson, and recoverable recording chunks are surfaced to the user.

---

## Milestone 5: PWA and launch polish

Deliver:

- Installable PWA
- Offline app shell
- Recent projects
- Onboarding
- Accessibility pass
- Tablet layout polish
- Privacy page
- Compatibility documentation

### Exit criteria

A new user can create, record, export, and reopen a lesson on iPad without developer assistance.

---

## 18. MVP acceptance criteria

The MVP is complete when all of the following are true:

### Whiteboard

- Apple Pencil or another stylus can draw smoothly.
- Finger drawing is off by default on touch devices.
- Two-finger navigation works.
- Pen, highlighter, eraser, colors, widths, undo, redo, and pages work.
- Projects survive reloads.

### Camera and audio

- The user can select and preview camera and microphone devices.
- The camera overlay can be moved, resized, hidden, and restored.
- A microphone activity meter is visible.
- Voice-only recording works.

### Recording

- The app records the fixed lesson stage.
- Ink, camera, and audio are synchronized sufficiently for educational content.
- The app negotiates an actual supported media type.
- Recording data is persisted incrementally.
- The user can stop, preview, and export a playable file.
- The app does not upload media.

### Tablet quality

- The interface is usable in iPad landscape orientation.
- Palm contacts do not normally create ink or move the stage during a pen stroke.
- The app completes the 20-minute representative iPad scenario.
- Unsupported behavior is detected before the user invests in a lesson.

### Reliability

- Permission failure paths are understandable.
- Low-storage conditions produce a warning.
- A reload preserves the editable lesson.
- Recoverable interrupted recording sessions are offered after restart.

---

## 19. Open technical questions

These questions must be resolved during Milestone 0 rather than assumed:

1. Which media container and codecs are produced reliably by current iPadOS Safari for a canvas video track plus microphone audio?
2. Does the selected chunking interval behave reliably during active Pencil input?
3. Is OPFS sufficiently stable for long recording chunks on target iPads, or should IndexedDB be the default there?
4. What maximum resolution and bitrate remain stable on the oldest supported iPad?
5. How do normal Safari-tab and installed-PWA lifecycle behaviors differ during recording?
6. What happens when the user backgrounds Safari, locks the screen, receives a call, or changes audio route?
7. Is pause and resume reliable enough to expose on every target browser?
8. Does final Blob assembly create unacceptable memory pressure for long recordings?
9. Which share and download flow is least confusing on iPad?
10. Which stylus properties are consistently populated across Apple Pencil, S Pen, and Surface Pen?

---

## 20. Recommended first implementation slice

Build one intentionally narrow vertical slice:

1. One 1280 × 720 white page.
2. One pressure-aware black pen.
3. Apple Pencil and mouse input.
4. Front camera in a fixed rounded rectangle.
5. Microphone audio.
6. Composition canvas.
7. Runtime MIME negotiation.
8. Start and stop recording.
9. Incremental chunks.
10. Preview and export.
11. Run it on a physical iPad.

Do not begin with project dashboards, templates, collaboration, AI, or a large design system. The first victory is a single handwritten equation, a face in the corner, clear audio, and a playable file emerging from Safari. Everything else grows from that little rectangle of proof.

---

## 21. Future product opportunities

After the local recording foundation is dependable:

- Lesson templates.
- Diagram and equation tools.
- Import PDF pages for annotation.
- Script or speaker notes outside the recording frame.
- Chapter markers placed while teaching.
- Editable camera-layout keyframes.
- Automatic transcript generated locally or through an opt-in service.
- Searchable lesson archive.
- Automatic clips for vertical social video.
- Clean-board and camera-only scene presets.
- Remote slide control.
- Presentation mode for external displays.
- Optional cloud sync.
- Collaborative classrooms.
- Deterministic professional export through WebCodecs or a server.
- Native iPad wrapper only if web-platform lifecycle limits materially constrain the product.

---

## 22. Architectural decisions summary

| Decision | Choice |
|---|---|
| Product posture | Tablet-first, local-first teaching studio |
| Primary input | Pointer Events |
| Ink representation | Vector strokes |
| Live rendering | Imperative Canvas 2D |
| UI framework | React and TypeScript |
| Recorded visual source | Dedicated composition canvas |
| Camera ingestion | `getUserMedia()` video rendered into canvas |
| Audio ingestion | Selected microphone MediaStream track |
| Recording engine | MediaRecorder adapter for MVP |
| Format selection | Runtime capability negotiation |
| Recording persistence | OPFS preferred, IndexedDB fallback |
| Default output | 720p compatibility preset |
| iPad support | Launch requirement with physical-device gate |
| Backend | Not required for core workflow |
| Privacy | No upload by default |
| Future encoder | WebCodecs behind an adapter |

---

## 23. Definition of success

The product succeeds when an educator can sit with an iPad, open the app, write fluidly with Apple Pencil, speak naturally, optionally appear on camera, stop recording, and immediately hold a playable lesson file without creating an account or sending the raw session anywhere.

That is the north star.

