import type { Take } from '../types';
import { DELIVERY_VERSION, deliveryAudioOptions } from './remux';

export interface TakeEdits {
  start: number;
  end: number;
  muted: boolean;
}

/** Decode only when trimming needs it; never replace the original take. */
export async function editTake(
  take: Take,
  edits: TakeEdits,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
): Promise<Omit<Take, 'url'>> {
  if (!Number.isFinite(edits.start) || !Number.isFinite(edits.end) ||
    edits.start < 0 || edits.end <= edits.start) {
    throw new Error('Choose a valid start and end time.');
  }
  const {
    ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input,
    Mp4OutputFormat, Output, WebMOutputFormat, EncodedPacketSink,
    EncodedVideoPacketSource, EncodedAudioPacketSource,
    VideoSampleSink, VideoSampleSource, getFirstEncodableVideoCodec, QUALITY_HIGH,
  } = await import('mediabunny');
  signal.throwIfAborted();
  const input = new Input({ source: new BlobSource(take.blob), formats: ALL_FORMATS });
  let conversion: import('mediabunny').Conversion | undefined;
  let activeOutput: import('mediabunny').Output | undefined;
  let stallTimer = 0;
  let reportedProgress = 0;
  let rejectFailure: (error: unknown) => void = () => {};
  const failure = new Promise<never>((_, reject) => { rejectFailure = reject; });
  const cancelWork = () => {
    if (activeOutput && activeOutput.state !== 'finalized' && activeOutput.state !== 'canceled') {
      void activeOutput.cancel().catch(rejectFailure);
    }
    if (conversion && conversion.state !== 'done' && conversion.state !== 'canceled') {
      void conversion.cancel().catch(rejectFailure);
    }
  };
  const cancel = () => { rejectFailure(signal.reason); cancelWork(); };
  const progress = (value: number) => {
    reportedProgress = Math.max(reportedProgress, Math.min(value, 1));
    onProgress(reportedProgress * 0.95);
    window.clearTimeout(stallTimer);
    stallTimer = window.setTimeout(() => {
      rejectFailure(new Error('The browser encoder stopped responding. Your original is safe. Retry, or download the original.'));
      cancelWork();
    }, 15000);
  };
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video?.codec) throw new Error('This recording has no readable video track.');
    const metadataDuration = await input.getDurationFromMetadata();
    const duration = metadataDuration && Number.isFinite(metadataDuration)
      ? metadataDuration : await input.computeDuration();
    if (edits.start >= duration || edits.end > duration + 0.1) {
      throw new Error('The selected range is outside this recording.');
    }
    const mp4 = video.codec === 'avc' || video.codec === 'hevc';
    const target = new BufferTarget();
    const output = new Output({
      format: mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
      target,
    });
    activeOutput = output;
    const end = Math.min(edits.end, duration);
    const selectedDuration = end - edits.start;
    const unsupported = () => new Error(
      'This browser cannot encode this edit without losing a track. Try a current Chrome or Safari, or download the original.',
    );
    let renderVideo: () => Promise<void>;
    if (edits.start > 0 || end < duration) {
      if (!await video.canDecode()) throw unsupported();
      const codec = await getFirstEncodableVideoCodec(output.format.getSupportedVideoCodecs(), {
        width: await video.getDisplayWidth(), height: await video.getDisplayHeight(),
        bitrate: QUALITY_HIGH,
      });
      signal.throwIfAborted();
      if (!codec) throw unsupported();
      // Quality-mode lookahead can stall WebKit behind the encoder's queue
      // backpressure. Feed bounded samples to a low-latency encoder instead.
      const source = new VideoSampleSource({
        codec, bitrate: QUALITY_HIGH, latencyMode: 'realtime',
      });
      output.addVideoTrack(source);
      renderVideo = async () => {
        for await (const sample of new VideoSampleSink(video).samples(edits.start, end)) {
          try {
            signal.throwIfAborted();
            const timestamp = Math.max(sample.timestamp - edits.start, 0);
            const sampleEnd = Math.min(sample.timestamp + sample.duration, end) - edits.start;
            sample.setTimestamp(timestamp);
            sample.setDuration(Math.max(0, sampleEnd - timestamp));
            await source.add(sample);
            progress(Math.min((timestamp + sample.duration) / selectedDuration, 1));
          } finally {
            sample.close();
          }
        }
        source.close();
      };
    } else {
      const source = new EncodedVideoPacketSource(video.codec);
      const config = await video.getDecoderConfig();
      output.addVideoTrack(source);
      renderVideo = async () => {
        for await (const packet of new EncodedPacketSink(video).packets()) {
          signal.throwIfAborted();
          await source.add(packet, { decoderConfig: config ?? undefined });
          progress(Math.min((packet.timestamp + packet.duration) / selectedDuration, 1));
        }
        source.close();
      };
    }
    if (!edits.muted && await input.getPrimaryAudioTrack()) {
      conversion = await Conversion.init({
        input, output, tracks: 'primary', composable: true,
        video: { discard: true },
        audio: {
          ...await deliveryAudioOptions(input, mp4),
          forceTranscode: edits.start > 0 || end < duration,
        },
        trim: { start: edits.start, end }, showWarnings: false,
      });
      if (!conversion.isValid || conversion.discardedTracks.some(
        (track) => track.reason !== 'discarded_by_user',
      )) throw unsupported();
      conversion.onProgress = progress;
    }
    signal.throwIfAborted();
    signal.addEventListener('abort', cancel, { once: true });
    progress(0);
    await Promise.race([
      (async () => {
        await output.start();
        await Promise.all([renderVideo(), conversion?.execute()]);
        await output.finalize();
      })(),
      failure,
    ]);
    window.clearTimeout(stallTimer);
    signal.throwIfAborted();
    if (!target.buffer?.byteLength) throw new Error('The edited export produced no video data.');
    const mimeType = mp4 ? 'video/mp4' : 'video/webm';
    const encoded = new Blob([target.buffer], { type: mimeType });
    // Encoders flush complete audio packets (AAC can add ~80ms of padding).
    // Clip their container durations, plus the final video frame, so players
    // and the library agree with the selected end instead of playing a tail.
    const rendered = new Input({ source: new BlobSource(encoded), formats: ALL_FORMATS });
    const finalTarget = new BufferTarget();
    const finalOutput = new Output({
      format: mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
      target: finalTarget,
    });
    activeOutput = finalOutput;
    try {
      const renderedVideo = await rendered.getPrimaryVideoTrack();
      if (!renderedVideo?.codec) throw new Error('The edited export has no video track.');
      const videoSource = new EncodedVideoPacketSource(renderedVideo.codec);
      finalOutput.addVideoTrack(videoSource);
      const renderedAudio = await rendered.getPrimaryAudioTrack();
      const audioSource = renderedAudio?.codec ? new EncodedAudioPacketSource(renderedAudio.codec) : null;
      if (audioSource) finalOutput.addAudioTrack(audioSource);
      const videoConfig = await renderedVideo.getDecoderConfig();
      const audioConfig = await renderedAudio?.getDecoderConfig();
      const copy = async (
        track: import('mediabunny').InputTrack,
        write: (packet: import('mediabunny').EncodedPacket) => Promise<void>,
      ) => {
        let last: import('mediabunny').EncodedPacket | undefined;
        for await (const packet of new EncodedPacketSink(track).packets()) {
          signal.throwIfAborted();
          if (packet.timestamp >= selectedDuration) break;
          if (last) await write(last.clone({
            duration: Math.min(last.duration, selectedDuration - last.timestamp),
          }));
          last = packet;
        }
        if (last) await write(last.clone({
          duration: track.type === 'video'
            ? selectedDuration - last.timestamp
            : Math.min(last.duration, selectedDuration - last.timestamp),
        }));
      };
      await finalOutput.start();
      await Promise.all([
        copy(renderedVideo, (packet) => videoSource.add(packet, { decoderConfig: videoConfig ?? undefined }))
          .then(() => videoSource.close()),
        renderedAudio && audioSource
          ? copy(renderedAudio, (packet) => audioSource.add(packet, { decoderConfig: audioConfig ?? undefined }))
            .then(() => audioSource.close())
          : Promise.resolve(),
      ]);
      await finalOutput.finalize();
      signal.throwIfAborted();
      if (!finalTarget.buffer?.byteLength) throw new Error('Could not finalize the edited video.');
    } finally {
      rendered.dispose();
      if (finalOutput.state !== 'finalized' && finalOutput.state !== 'canceled') await finalOutput.cancel();
    }
    const finalBuffer = finalTarget.buffer;
    if (!finalBuffer) throw new Error('Could not read the edited video.');
    onProgress(1);
    return {
      blob: new Blob([finalBuffer], { type: mimeType }),
      mimeType,
      extension: mp4 ? '.mp4' : '.webm',
      durationMs: selectedDuration * 1000,
      createdAt: take.createdAt,
      seekable: true,
      deliveryVersion: DELIVERY_VERSION,
    };
  } finally {
    window.clearTimeout(stallTimer);
    signal.removeEventListener('abort', cancel);
    try {
      if (conversion && conversion.state !== 'done' && conversion.state !== 'canceled') {
        await conversion.cancel();
      }
      if (activeOutput && activeOutput.state !== 'finalized' && activeOutput.state !== 'canceled') {
        await activeOutput.cancel();
      }
    } finally {
      input.dispose();
    }
  }
}
