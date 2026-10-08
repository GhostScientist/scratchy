export interface RecordingAudio {
  tracks: MediaStreamTrack[];
  setMicMuted(muted: boolean): void;
  close(): void;
}

/** A single encoded audio track preserves both voice and shared sound across
 * players; multiple MediaRecorder audio tracks are not portable. */
export async function mixRecordingAudio(mic: MediaStream | null, shared: MediaStream | null): Promise<RecordingAudio> {
  const voice = mic?.getAudioTracks().filter((track) => track.readyState === 'live') ?? [];
  const screen = shared?.getAudioTracks().filter((track) => track.readyState === 'live') ?? [];
  if (screen.length === 0 || voice.length === 0) {
    const micTracks = voice.map((track) => track.clone());
    const tracks = [...micTracks, ...screen.map((track) => track.clone())];
    return { tracks, setMicMuted: (muted) => micTracks.forEach((track) => { track.enabled = !muted; }),
      close: () => tracks.forEach((track) => track.stop()) };
  }
  const context = new AudioContext();
  const clones: MediaStreamTrack[] = [];
  let resumeTimer = 0;
  try {
    await Promise.race([
      context.resume(),
      new Promise<never>((_, reject) => {
        resumeTimer = window.setTimeout(() => reject(new Error('The browser did not allow the audio mixer to start')), 3000);
      }),
    ]);
    window.clearTimeout(resumeTimer);
    if (context.state !== 'running') throw new Error('The audio mixer could not start');
    const destination = context.createMediaStreamDestination();
    clones.push(...[...voice, ...screen].map((track) => track.clone()));
    const inputs = clones.map((track) =>
      context.createMediaStreamSource(new MediaStream([track])));
    inputs.forEach((input) => input.connect(destination));
    return {
      tracks: destination.stream.getAudioTracks(),
      setMicMuted: (muted) => clones.slice(0, voice.length).forEach((track) => { track.enabled = !muted; }),
      close: () => {
        inputs.forEach((input) => input.disconnect());
        clones.forEach((track) => track.stop());
        destination.stream.getTracks().forEach((track) => track.stop());
        void context.close();
      },
    };
  } catch (error) {
    window.clearTimeout(resumeTimer);
    clones.forEach((track) => track.stop());
    await context.close();
    throw error;
  }
}
