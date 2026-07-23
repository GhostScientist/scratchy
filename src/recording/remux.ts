import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
} from 'mediabunny';

export interface DeliverableTake {
  blob: Blob;
  mimeType: string;
  extension: string;
}

/** H.264/H.265 belong in MP4; VP8/VP9/AV1 in an MP4 won't play on Apple
 *  devices, so those stay in WebM (their native, well-supported container). */
const MP4_VIDEO_CODECS = new Set(['avc', 'hevc']);

/**
 * Losslessly rewrite a MediaRecorder blob into a seekable file with a correct
 * duration.
 *
 * MediaRecorder is a streaming muxer: its MP4 output is fragmented with zero
 * `mvhd`/`mehd` durations, and its WebM output lacks Duration and Cues.
 * Players treat both as endless live streams — Apple players literally label
 * them "Live Broadcast" — and stricter apps refuse them outright. This pass
 * re-muxes the encoded samples as-is (no re-encode, no quality loss) into a
 * progressive fast-start MP4 (H.264) or a proper seekable WebM (VP8/VP9).
 *
 * Returns null when the blob can't be remuxed — callers keep the original
 * bytes so a remux bug can never lose a recording.
 */
export async function remuxForDelivery(blob: Blob): Promise<DeliverableTake | null> {
  try {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) return null;
    const codec = videoTrack.codec;
    if (!codec) return null;

    const toMp4 = MP4_VIDEO_CODECS.has(codec);
    const output = new Output({
      format: toMp4
        ? new Mp4OutputFormat({ fastStart: 'in-memory' })
        : new WebMOutputFormat(),
      target: new BufferTarget(),
    });

    const conversion = await Conversion.init({ input, output, showWarnings: false });
    // A conversion that would drop the video track (e.g. an undecodable
    // codec) is worse than the original bytes — bail to the fallback.
    if (conversion.discardedTracks.some((t) => t.track.type === 'video')) return null;
    await conversion.execute();

    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer || buffer.byteLength === 0) return null;
    const mimeType = toMp4 ? 'video/mp4' : 'video/webm';
    return {
      blob: new Blob([buffer], { type: mimeType }),
      mimeType,
      extension: toMp4 ? '.mp4' : '.webm',
    };
  } catch {
    return null;
  }
}
