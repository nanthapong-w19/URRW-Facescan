// Cross-browser Fullscreen API + Screen Orientation Lock primitives (see
// CONTEXT.md — shared by MeetingScanner's kiosk view and MeetingSummary's
// projector view). Deliberately just primitives, no owned state: the two
// callers keep genuinely different state models (MeetingScanner tracks
// native-vs-CSS-fallback fullscreen separately since only native fullscreen
// should trigger an orientation lock; MeetingSummary collapses both into one
// flag) — this module doesn't take a position on that, only on how to talk
// to the browser API underneath it.

// Desktop Safari/iPadOS still only expose the `webkit`-prefixed variants,
// and older Edge/Firefox used `moz`/`ms` — every function here tries the
// standard API first and falls back through the prefixed ones. iPhone
// Safari (and many in-app browsers, e.g. Line/Facebook's built-in webview)
// don't implement the Fullscreen API on arbitrary elements at all —
// `requestFullscreen` throws there, which callers use as the signal to fall
// back to a CSS-only "maximized view" instead of leaving the button broken.
const FULLSCREEN_CHANGE_EVENTS = [
  'fullscreenchange',
  'webkitfullscreenchange',
  'mozfullscreenchange',
  'MSFullscreenChange',
] as const

export function getFullscreenElement(): Element | null {
  const doc = document as any
  return (
    document.fullscreenElement
    ?? doc.webkitFullscreenElement
    ?? doc.mozFullScreenElement
    ?? doc.msFullscreenElement
    ?? null
  )
}

export async function requestFullscreen(el: HTMLElement) {
  const request =
    el.requestFullscreen
    ?? (el as any).webkitRequestFullscreen
    ?? (el as any).webkitEnterFullscreen // iOS Safari (video-only, but harmless fallback attempt)
    ?? (el as any).mozRequestFullScreen
    ?? (el as any).msRequestFullscreen
  if (!request) throw new Error('Fullscreen API is not supported on this device')
  return request.call(el)
}

export async function exitFullscreen() {
  const exit =
    document.exitFullscreen
    ?? (document as any).webkitExitFullscreen
    ?? (document as any).mozCancelFullScreen
    ?? (document as any).msExitFullscreen
  if (exit) return exit.call(document)
}

/** Subscribes to every vendor-prefixed fullscreenchange event; returns a cleanup function. */
export function onFullscreenChange(handler: () => void): () => void {
  for (const evt of FULLSCREEN_CHANGE_EVENTS) {
    document.addEventListener(evt, handler)
  }
  return () => {
    for (const evt of FULLSCREEN_CHANGE_EVENTS) {
      document.removeEventListener(evt, handler)
    }
  }
}

// Auto-rotate to landscape when entering fullscreen, via the Screen
// Orientation Lock API. Support for this is much patchier than the
// Fullscreen API itself — desktop browsers reject it outright (there's no
// "rotation" to lock on a monitor), and iOS Safari never implements `.lock`
// at all (only `screen.orientation` itself exists there, no lock method) —
// so every call here is best-effort and fails silently rather than
// surfacing an error.
export async function lockLandscape() {
  try {
    const orientation = (screen as any).orientation
    if (orientation?.lock) {
      await orientation.lock('landscape')
    }
  } catch {
    // Most browsers only allow locking orientation while the document is
    // genuinely fullscreen (some reject it in a CSS-only fallback), and
    // plenty don't support it at all — none of that should block or error
    // out the fullscreen toggle itself.
  }
}

export function unlockOrientation() {
  try {
    ;(screen as any).orientation?.unlock?.()
  } catch {
    // ignore — nothing to clean up if it was never locked/supported
  }
}
