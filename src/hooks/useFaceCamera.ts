import { useEffect, useRef } from 'react'
import { useCameraStream, type CameraOverlay, type UseCameraStreamOptions } from './useCameraStream'
import { detectFaceWithDescriptor, descriptorDistance, MATCH_THRESHOLD, MATCH_MARGIN, type DetectedFace } from '@/lib/faceEngine'

// Face-recognition module (see CONTEXT.md "Face camera"): layers a
// throttled detection tick + candidate-matching on top of useCameraStream.
// What a match *means* — hold-to-confirm streak, or nothing at all — is
// deliberately NOT in here; that's the caller's `onTick`
// "tick policy" (see CONTEXT.md), since it genuinely differs per screen.

const SCAN_INTERVAL_MS = 500

export interface FaceCandidate {
  faceDescriptor: number[] | Float32Array | null
}

export interface TickResult<C extends FaceCandidate> {
  face: DetectedFace
  bestMatch: { candidate: C; distance: number } | null
  isMatch: boolean
}

export interface UseFaceCameraOptions<C extends FaceCandidate> extends UseCameraStreamOptions {
  candidates: C[]
  onTick: (result: TickResult<C> | null) => CameraOverlay | null
}

export function useFaceCamera<C extends FaceCandidate>({
  candidates,
  onTick,
  ...cameraOptions
}: UseFaceCameraOptions<C>) {
  const camera = useCameraStream(cameraOptions)
  const timerRef = useRef<number | null>(null)

  // The interval's closure is created once per mount of this effect (only
  // torn down/rebuilt when cameraState flips ready<->not-ready) — refs keep
  // it reading the latest candidates/onTick without needing to restart the
  // interval on every re-render (candidates in particular changes often,
  // driven by realtime roster updates).
  const candidatesRef = useRef(candidates)
  candidatesRef.current = candidates
  const onTickRef = useRef(onTick)
  onTickRef.current = onTick

  useEffect(() => {
    if (camera.cameraState !== 'ready') return

    timerRef.current = window.setInterval(async () => {
      const video = camera.videoRef.current
      if (!video || video.readyState < 2) return

      let face: DetectedFace | null
      try {
        face = await detectFaceWithDescriptor(video)
      } catch {
        return
      }

      camera.paint(onTickRef.current(resolveTick(face, candidatesRef.current)))
    }, SCAN_INTERVAL_MS)

    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.cameraState])

  return camera
}

/** Pure tick-resolution step, split out of the interval callback above so it's testable without a DOM/video element. */
export function resolveTick<C extends FaceCandidate>(
  face: DetectedFace | null,
  candidates: C[]
): TickResult<C> | null {
  if (!face) return null
  let bestMatch: { candidate: C; distance: number } | null = null
  // Tracked alongside bestMatch (not computed via a second pass) so this
  // stays O(n) over the candidate list — MATCH_MARGIN below needs the gap
  // between 1st and 2nd place, not just the winner.
  let secondBestDistance = Infinity
  for (const candidate of candidates) {
    if (!candidate.faceDescriptor) continue
    const distance = descriptorDistance(face.descriptor, candidate.faceDescriptor)
    if (!bestMatch || distance < bestMatch.distance) {
      if (bestMatch) secondBestDistance = bestMatch.distance
      bestMatch = { candidate, distance }
    } else if (distance < secondBestDistance) {
      secondBestDistance = distance
    }
  }
  // Confident only when the winner both clears MATCH_THRESHOLD on its own
  // AND leads the runner-up by MATCH_MARGIN — see faceEngine.ts for why a
  // large roster needs that second condition. A lone candidate (no
  // runner-up to compare against) always clears the margin trivially.
  const isMatch = Boolean(
    bestMatch && bestMatch.distance < MATCH_THRESHOLD && secondBestDistance - bestMatch.distance >= MATCH_MARGIN
  )
  return { face, bestMatch, isMatch }
}
