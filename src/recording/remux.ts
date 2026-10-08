import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  canEncodeAudio,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
} from 'mediabunny';
import type { AudioCodec, ConversionAudioOptions } from 'mediabunny';

export interface DeliverableTake {
  blob: Blob;
  mimeType: string;
  extension: string;
}

/**
 * Bumped whenever remuxForDelivery's output changes in a way that should
 * re-heal takes already stored in the library (see TakesDrawer). Version
 * history: 1 = seekable rewrite only; 2 = audio made player-compatible
 * (Opus-in-MP4 transcoded to AAC) and no track is ever silently dropped.
 */
export const DELIVERY_VERSION = 2;

/** H.264/H.265 belong in MP4; VP8/VP9/AV1 in an MP4 won't play on Apple
 *  devices, so those stay in WebM (their native, well-supported container). */
const MP4_VIDEO_CODECS = new Set(['avc', 'hevc']);

/** Audio codecs that mainstream MP4 players actually decode. Opus in MP4 is
 *  spec-legal — and it's what Chrome records for bare `video/mp4` when it has
 *  no AAC encoder — but QuickTime, Windows Media Player, and most editors
 *  refuse the file or play it silent. */
const MP4_COMPAT_AUDIO = new Set(['aac', 'mp3']);

/** The only audio codecs a WebM may contain. */
const WEBM_AUDIO = new Set(['opus', 'vorbis']);

/** 128 kb/s, matching the bitrate the recorder asks MediaRecorder for. */
const AUDIO_TRANSCODE_BITRATE = 128_000;

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
 * The one exception to "as-is" is an audio track the target container's
 * players can't handle (e.g. Opus in MP4): that track alone is transcoded to
 * the container's native codec when this browser can encode it, so the
 * downloaded file plays — with sound — outside the browser too. Video is
 * never re-encoded.
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

    const audio = await audioOptions(input, toMp4);
    const conversion = await Conversion.init({ input, output, audio, showWarnings: false });
    // A conversion that would drop any track — undecodable video, or audio
    // the container rejects — is worse than the original bytes: bail to the
    // fallback rather than deliver a silent or empty file.
    if (conversion.discardedTracks.length > 0) return null;
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

/** Transcode the audio track to the target container's native codec when its
 *  recorded codec would keep the file from playing there; otherwise pass the
 *  samples through untouched. Undefined when no rewrite is needed or this
 *  browser can't encode the target codec (passthrough is then still the best
 *  available delivery — WebM-incompatible passthrough surfaces as a
 *  discarded track and falls back to the raw bytes). */
async function audioOptions(
  input: Input,
  toMp4: boolean,
): Promise<ConversionAudioOptions | undefined> {
  const audioTrack = await input.getPrimaryAudioTrack();
  const audioCodec = audioTrack?.codec;
  if (!audioCodec) return undefined;
  if (toMp4 ? MP4_COMPAT_AUDIO.has(audioCodec) : WEBM_AUDIO.has(audioCodec)) return undefined;
  const target: AudioCodec = toMp4 ? 'aac' : 'opus';
  if (!(await canEncodeAudio(target, { bitrate: AUDIO_TRANSCODE_BITRATE }))) return undefined;
  return { codec: target, bitrate: AUDIO_TRANSCODE_BITRATE };
}
