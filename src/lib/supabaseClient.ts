import { createClient } from '@supabase/supabase-js'

// Takes only the first non-empty line of the value, with control
// characters stripped and whitespace trimmed.
//
// This matters because of a real production bug found on the Vercel
// deployment: `VITE_SUPABASE_ANON_KEY` there was NOT a single clean key —
// fetching the deployed JS bundle and inspecting the literal string showed
// it was actually 3 lines (208 chars + 416 chars + an empty trailing line)
// joined by real embedded newline characters, i.e. more than one value got
// pasted into that one env var field on Vercel (the 208-char first line is
// the genuine, correctly-shaped anon key — confirmed working via direct
// REST calls; whatever is on line 2 is extra pasted content that doesn't
// belong there, possibly the service_role key or a duplicate/partial paste).
//
// The multi-line string still *looked* fine in passing checks
// (isSupabaseConfigured, a naive length/regex check) but every Supabase
// request builds an `Authorization: Bearer <key>` header from it, and the
// Fetch API's `Headers.set()` throws `TypeError: Failed to execute 'set'
// on 'Headers': Invalid value` for a header value containing an embedded
// newline like this — confirmed directly in a real browser (Chrome)
// console by reconstructing the exact multi-line string byte-for-byte from
// the deployed bundle and calling `Headers.set()` with it. That throw
// happens synchronously, before the request is ever dispatched, so from
// the outside it looks exactly like "nothing is happening at all" (zero
// network activity) rather than a normal failed request.
//
// Just stripping the newline characters (an earlier version of this fix)
// isn't enough — it would concatenate the 208-char key and the 416-char
// garbage into one long invalid string instead. Taking only the first
// line recovers the real key. This is a defensive code-level guard
// regardless of what's stored in Vercel; the env var there should still be
// re-checked and replaced with ONLY the anon/public key value from
// Supabase's API settings page (nothing else, no extra lines).
function sanitizeEnvValue(value: string | undefined): string | undefined {
  if (!value) return value
  const firstLine = value.split(/\r?\n/).find((line) => line.trim().length > 0) ?? ''
  return firstLine.replace(/[\x00-\x1F\x7F]/g, '').trim()
}

const supabaseUrl = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_URL)
const supabaseAnonKey = sanitizeEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY)

// Whether the .env file is present and filled in. Checked explicitly by
// App.tsx before rendering the router, which shows a clear on-screen setup
// message instead. Deliberately NOT throwing here: a throw during module
// evaluation happens before React ever mounts anything, so it would just
// produce a blank white page with the real error visible only in the
// browser console — the worst possible failure mode for a missing .env.
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

// A single shared client for the whole app: data reads/writes (Postgres via
// PostgREST) and the Realtime channel used by useAppData both go through
// this instance. Uses the anon/publishable key, which is designed to be
// safe to ship in client-side JS — access is governed entirely by the
// Row Level Security policies defined on the facein_* tables, not by
// keeping this key secret.
//
// Falls back to harmless placeholder values when unconfigured so
// `createClient` itself never throws either — App.tsx's setup screen is
// what the user actually sees in that case, not a crash.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key'
)
