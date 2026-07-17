import * as faceapi from 'face-api.js'

// Model weights are loaded from a public CDN mirror of the face-api.js
// weights folder, since shipping the binary model files inside this
// artifact isn't practical. In a sandboxed preview environment without
// outbound network access, this load will fail — callers should catch
// that and fall back to the manual check-in flow.
const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights'

let modelsLoaded = false
let loadPromise: Promise<void> | null = null

export function areModelsLoaded() {
  return modelsLoaded
}

export async function loadFaceModels(): Promise<void> {
  if (modelsLoaded) return
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ])
    modelsLoaded = true
  })()

  try {
    await loadPromise
  } catch (err) {
    loadPromise = null
    throw err
  }
  return loadPromise
}

export interface DetectedFace {
  descriptor: Float32Array
  box: { x: number; y: number; width: number; height: number }
}

const DETECTOR_OPTIONS = new faceapi.TinyFaceDetectorOptions({
  inputSize: 320,
  scoreThreshold: 0.5,
})

export async function detectFaceWithDescriptor(
  input: HTMLVideoElement
): Promise<DetectedFace | null> {
  const result = await faceapi
    .detectSingleFace(input, DETECTOR_OPTIONS)
    .withFaceLandmarks()
    .withFaceDescriptor()

  if (!result) return null

  return {
    descriptor: result.descriptor,
    box: {
      x: result.detection.box.x,
      y: result.detection.box.y,
      width: result.detection.box.width,
      height: result.detection.box.height,
    },
  }
}

/** Euclidean distance between two face descriptors. Lower = more similar. */
export function descriptorDistance(a: number[] | Float32Array, b: number[] | Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

// face-api.js's own recognition net is calibrated so that distances below
// ~0.6 typically indicate the same person.
export const MATCH_THRESHOLD = 0.55

export function distanceToConfidence(distance: number): number {
  const clamped = Math.max(0, Math.min(1, 1 - distance / MATCH_THRESHOLD / 1.4))
  return clamped
}
