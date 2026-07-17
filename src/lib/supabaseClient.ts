import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

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
