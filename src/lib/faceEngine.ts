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

// inputSize bumped 320 -> 416 (accuracy round): tinyFaceDetector runs at a
// fixed square input resolution, downscaling the real frame to fit — 320 was
// soft enough to lose detail on a face that's smaller in frame (further from
// the camera, or a wider kiosk shot), which costs the *recognition* net
// descriptor quality even when the box itself was still found. 416 keeps
// more of that detail at a still-modest per-frame cost (single detector
// pass, not the full pipeline, and this only runs once per SCAN_INTERVAL_MS
// tick, not every rendered frame).
const DETECTOR_OPTIONS = new faceapi.TinyFaceDetectorOptions({
  inputSize: 416,
  scoreThreshold: 0.5,
})

export async function detectFaceWithDescriptor(
  input: HTMLVideoElement | HTMLImageElement
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

export interface DetectedFaceLandmarksOnly {
  box: { x: number; y: number; width: number; height: number }
  landmarks: faceapi.FaceLandmarks68
}

// Same detection as detectFaceWithDescriptor but skips the recognition net
// (withFaceDescriptor()), which is by far the most expensive stage of the
// pipeline. Callers that only need presence/landmarks per tick — e.g. the
// blink-liveness gate below, which must sample fast enough to catch a blink
// that's over in a couple hundred ms — should use this instead so the RAF
// loop isn't bottlenecked computing a 128-d descriptor it throws away every
// frame. The descriptor is only ever needed once, at actual capture time.
export async function detectFaceLandmarksOnly(
  input: HTMLVideoElement | HTMLImageElement
): Promise<DetectedFaceLandmarksOnly | null> {
  const result = await faceapi.detectSingleFace(input, DETECTOR_OPTIONS).withFaceLandmarks()

  if (!result) return null

  return {
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

// How long a detected blink keeps a tracked face "live" for. Wide enough to
// bridge a couple of scan ticks around the blink itself, short enough that
// holding up a static photo can't coast on a single lucky detection. Shared
// by FaceScanner.tsx's per-tick check-in gate and FaceCaptureDialog.tsx's
// registration capture gate.
export const LIVENESS_VALID_MS = 4000

export interface LivenessState {
  eyesClosed: boolean
  blinkAt: number | null
}

// Tracks eye-aspect-ratio across ticks and requires one real blink (closed
// -> open transition) before a match counts as "live" — a static photo or
// frozen video frame held up to the camera can never produce that
// transition. Pure function so it's testable without a DOM/video element.
export function nextLivenessState(state: LivenessState, ear: number, now: number): LivenessState {
  if (ear < EAR_BLINK_THRESHOLD) return { ...state, eyesClosed: true }
  if (state.eyesClosed) return { eyesClosed: false, blinkAt: now }
  return state
}

export function isLive(blinkAt: number | null, now: number): boolean {
  return blinkAt !== null && now - blinkAt < LIVENESS_VALID_MS
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
// ~0.6 typically indicate the same person. Loosened from a stricter 0.55
// (accuracy round) — 0.55 was cutting off real matches under everyday
// lighting/angle variance (false negatives: "doesn't recognize me"), and the
// new MATCH_MARGIN check below now carries the false-positive-prevention
// job this threshold used to shoulder alone, so it can afford to sit closer
// to face-api.js's own calibrated value.
export const MATCH_THRESHOLD = 0.58

// Minimum distance the best-matching candidate must lead the *second*-best
// candidate by, on top of clearing MATCH_THRESHOLD, before a match counts as
// confident (see resolveTick in useFaceCamera.ts). With a roster in the
// hundreds, "closest candidate beats the threshold" alone isn't enough —
// two different people's descriptors can land close enough together that
// the wrong one wins a photo-finish. Requiring real daylight between 1st
// and 2nd place turns that photo-finish into "no confident match" instead
// of a coin-flip pick. A lone registered candidate (no second-best to
// compare against) always clears this trivially.
export const MATCH_MARGIN = 0.08

export function distanceToConfidence(distance: number): number {
  const clamped = Math.max(0, Math.min(1, 1 - distance / MATCH_THRESHOLD / 1.4))
  return clamped
}

/** Elementwise mean of several same-length descriptors into one centroid
 * vector — used to average multiple enrollment shots (different angles/
 * expressions) into a single more-robust reference descriptor, without
 * changing the stored shape (still one 128-d `number[]` per member, so no
 * database schema change is needed to get the accuracy benefit of
 * multi-shot enrollment). */
export function averageDescriptors(descriptors: number[][]): number[] {
  const length = descriptors[0].length
  const sum = new Array(length).fill(0)
  for (const descriptor of descriptors) {
    for (let i = 0; i < length; i++) sum[i] += descriptor[i]
  }
  return sum.map((total) => total / descriptors.length)
}

// --- Match-streak hold (see CONTEXT.md "Tick policy") ---------------------
//
// Originally lived only in MeetingScanner.tsx (its per-meeting check-in was
// the first thing to need it); moved here once FaceScanner.tsx's daily
// kiosk check-in needed the exact same behavior (accuracy round). Unlike
// the mirror-frame capture helper the two scanners each keep their own copy
// of (see captureCleanMirroredFrame in MeetingScanner.tsx) — there, no
// shared module existed yet and the two implementations differ slightly in
// context — this logic is pure, DOM-free, and faceEngine.ts already was the
// established shared home for match-related logic both components already
// imported from, so extracting it here cost nothing extra.
//
// Shared by both scan surfaces (FaceScanner.tsx's daily kiosk check-in and
// MeetingScanner.tsx's per-meeting check-in): the SAME candidate must keep
// matching for CONFIRM_HOLD_MS before a check-in is actually recorded,
// rather than firing on the very first matching tick. Protects against a
// single noisy frame (motion blur, someone briefly walking past, the
// detector's own frame-to-frame jitter flipping between two visually
// similar registered faces) triggering a check-in immediately — switching
// to no-match, a different person, or losing the face entirely resets the
// streak, so only sustained agreement counts. ~1.5s of holding steady in
// front of the camera, same idea as a tap-and-hold button.
export const CONFIRM_HOLD_MS = 1500

export interface MatchStreak {
  memberId: string | null
  since: number
}

export function nextMatchStreak(streak: MatchStreak, matchedMemberId: string | null, now: number): MatchStreak {
  if (matchedMemberId === null) return { memberId: null, since: 0 }
  if (streak.memberId !== matchedMemberId) return { memberId: matchedMemberId, since: now }
  return streak
}

export function streakHeldMs(streak: MatchStreak, now: number): number {
  return streak.memberId ? now - streak.since : 0
}

// --- Clean (no-overlay) face snapshots -------------------------------------
//
// captureCleanMirroredFrame lives here so both MeetingScanner.tsx (via
// captureFaceSnapshot, for the meeting check-in photo) and
// FaceCaptureDialog.tsx's own registration capture (which wants the whole
// mirrored frame, not a face-box crop, so it doesn't use captureFaceSnapshot
// itself) can share the exact same capture.

// Draws a fresh mirrored frame straight from the live <video> element —
// deliberately NOT any on-screen <canvas>, which (on the two scan surfaces)
// also has the live match-box + name label painted onto it every tick (see
// useCameraStream's paint loop) — so a captured photo is a clean shot with
// no scan-box/label baked into the saved pixels. Mirrored to match the
// selfie-view preview the user actually saw live.
export function captureCleanMirroredFrame(video: HTMLVideoElement): HTMLCanvasElement | null {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return null
  const frame = document.createElement('canvas')
  frame.width = vw
  frame.height = vh
  const ctx = frame.getContext('2d')
  if (!ctx) return null
  ctx.translate(vw, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(video, 0, 0, vw, vh)
  return frame
}

// Crops a small face thumbnail out of a clean mirrored frame the moment a
// check-in is confirmed, so a "recent check-ins" list can show what was
// actually scanned instead of just a name. `box` is in the *unmirrored*
// video coordinates the detector returns, but the frame itself is mirrored
// (see captureCleanMirroredFrame above), so the crop's x has to be mirrored
// to match. Returns null if the box ends up outside the frame's bounds
// (shouldn't normally happen, but a stale box from a just-lost face could
// briefly disagree with the video's current size).
export function captureFaceSnapshot(
  video: HTMLVideoElement,
  box: { x: number; y: number; width: number; height: number }
): string | null {
  const frame = captureCleanMirroredFrame(video)
  if (!frame) return null
  const padX = box.width * 0.35
  const padY = box.height * 0.35
  const mirroredX = frame.width - box.x - box.width
  const sx = Math.max(0, mirroredX - padX)
  const sy = Math.max(0, box.y - padY)
  const sw = Math.min(frame.width - sx, box.width + padX * 2)
  const sh = Math.min(frame.height - sy, box.height + padY * 2)
  if (sw <= 0 || sh <= 0) return null

  const size = 220
  const out = document.createElement('canvas')
  out.width = size
  out.height = size
  const ctx = out.getContext('2d')
  if (!ctx) return null
  // Cover-fit the crop into a fixed square thumbnail (source aspect ratio
  // isn't exactly square once padding is added, so scale to fill and center).
  const scale = Math.max(size / sw, size / sh)
  const dw = sw * scale
  const dh = sh * scale
  ctx.drawImage(frame, sx, sy, sw, sh, (size - dw) / 2, (size - dh) / 2, dw, dh)
  return out.toDataURL('image/jpeg', 0.82)
}
