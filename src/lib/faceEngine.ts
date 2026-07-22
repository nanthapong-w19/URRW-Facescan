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
  landmarks: faceapi.FaceLandmarks68
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
    landmarks: result.landmarks,
  }
}

// --- Liveness (blink) detection -------------------------------------------
//
// This is a lightweight, in-browser anti-spoofing check: it does NOT try to
// replace a real active-liveness SDK (which would inspect texture, depth, IR
// reflections, etc). It only proves the tracked face has an eye that opens
// and closes over time, which a static printed photo or a frozen video frame
// held up to the webcam cannot do. That's enough to raise the bar for casual
// spoofing on a trusted-network kiosk without adding any paid dependency.

function pointDistance(a: faceapi.Point, b: faceapi.Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// Eye Aspect Ratio (Soukupová & Čech, 2016). face-api.js's getLeftEye()/
// getRightEye() each return 6 points in the same [corner, top, top, corner,
// bottom, bottom] order the formula expects. Open eyes sit well above the
// threshold below; closed eyes collapse the vertical distances toward 0.
function eyeAspectRatio(eye: faceapi.Point[]): number {
  if (eye.length < 6) return 1
  const vertical1 = pointDistance(eye[1], eye[5])
  const vertical2 = pointDistance(eye[2], eye[4])
  const horizontal = pointDistance(eye[0], eye[3])
  if (horizontal === 0) return 1
  return (vertical1 + vertical2) / (2 * horizontal)
}

export function averageEyeAspectRatio(landmarks: faceapi.FaceLandmarks68): number {
  const left = eyeAspectRatio(landmarks.getLeftEye())
  const right = eyeAspectRatio(landmarks.getRightEye())
  return (left + right) / 2
}

// Tuned against typical webcam distance/angle in the kiosk flow — open eyes
// land around 0.25-0.35, a genuine blink dips well under 0.2.
export const EAR_BLINK_THRESHOLD = 0.2

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
