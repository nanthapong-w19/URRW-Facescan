# Domain glossary — face-checkin-app

Terms specific to this codebase's domain, kept here so they don't drift
across ADRs, code comments, and conversation. See `/codebase-design` for
the general module/interface/seam vocabulary these terms are described in.

## Camera stream

The camera-lifecycle module: permission request, `getUserMedia`, the
`OverconstrainedError` retry-without-constraints fallback, device
enumeration/switching, the `noFrames`/`blackFrames`/`trackMuted`
diagnostics, and the mirrored canvas paint loop. Lives at
`src/hooks/useCameraStream.ts`. Knows nothing about face recognition —
just "there is a camera feed, painted onto a canvas, with an overlay box
the caller can set."

## Face camera

Built on top of **Camera stream**: adds the throttled detection tick and
candidate-matching (best face-descriptor match by distance, against
`faceEngine.MATCH_THRESHOLD`). Lives at `src/hooks/useFaceCamera.ts`.
Hands each tick's result to the caller's **tick policy** and paints
whatever overlay that policy returns.

## Tick policy

The caller-supplied `onTick` callback passed to **Face camera** — a
per-site decision of what a match *means* and what to do about it, kept
outside the module because it genuinely differs per screen:

- **FaceScanner**: liveness/blink-gate before auto-checkin.
- **MeetingScanner** (inside `MeetingDetail.tsx`): hold-to-confirm streak
  before auto-checkin.
- **Login**: passive relabel only — matches are never acted on (deliberate;
  face-scan on the login screen is display-only, not an auth mechanism).

Each is a small function of `(TickResult | null) → OverlayBox | null` plus
whatever side effect it fires (record a checkin, none, etc.) — no camera
or canvas knowledge required, so each is unit-testable on its own.
