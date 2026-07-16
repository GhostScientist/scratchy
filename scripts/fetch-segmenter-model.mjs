// Downloads the MediaPipe selfie-segmentation model used by the camera
// "cutout" shape. The model is committed to the repo (src/assets/) so builds
// are reproducible and the app stays fully offline — this script only needs
// to run when upgrading the model version.
//
// Model: MediaPipe Selfie Segmenter (float16), Apache-2.0.
// https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
const DEST = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../src/assets/selfie_segmenter.tflite',
);

const force = process.argv.includes('--force');
if (!force) {
  try {
    await access(DEST);
    console.log(`Model already present at ${DEST} (use --force to re-download).`);
    process.exit(0);
  } catch {
    // Missing — fall through to download.
  }
}

console.log(`Downloading ${MODEL_URL} ...`);
const res = await fetch(MODEL_URL);
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status}`);
  process.exit(1);
}
const bytes = new Uint8Array(await res.arrayBuffer());
await mkdir(dirname(DEST), { recursive: true });
await writeFile(DEST, bytes);
console.log(`Saved ${bytes.length.toLocaleString()} bytes to ${DEST}`);
