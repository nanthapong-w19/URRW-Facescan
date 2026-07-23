import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabaseClient'

// Subscribes to Postgres changes on one table (see CONTEXT.md — this is
// the module three call sites used to hand-roll independently, one of
// which drifted and lost the reconnect safety net below). The event
// payload's row shape is caller-specific, so `onEvent` gets it untyped —
// exactly like the three original call sites, each of which cast it to
// its own RealtimeChange<TRow> via realtimeSync.ts.
export interface UseRealtimeChannelOptions {
  table: string
  filter?: string
  onEvent: (payload: unknown) => void
  // 'SUBSCRIBED' fires on the initial connect AND on every reconnect after
  // a dropped websocket. The initial connect is the caller's own
  // responsibility (an explicit fetch on mount); onReconnect only fires on
  // a genuine reconnect — the safety net that heals any event missed while
  // disconnected, without reintroducing a refetch on every single event.
  onReconnect?: () => void
  // Skips subscribing entirely — for callers whose filter depends on a
  // value that isn't ready yet (e.g. a route param). Without this, a
  // momentarily-undefined filter would otherwise mean subscribing
  // unfiltered to the whole table instead of just not subscribing yet.
  enabled?: boolean
}

export function useRealtimeChannel({ table, filter, onEvent, onReconnect, enabled = true }: UseRealtimeChannelOptions) {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const onReconnectRef = useRef(onReconnect)
  onReconnectRef.current = onReconnect

  useEffect(() => {
    if (!enabled) return
    let hasConnectedBefore = false
    const channelName = filter ? `realtime-${table}:${filter}` : `realtime-${table}`
    const config = filter
      ? { event: '*' as const, schema: 'public', table, filter }
      : { event: '*' as const, schema: 'public', table }
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', config, (payload) => onEventRef.current(payload))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (hasConnectedBefore) onReconnectRef.current?.()
          hasConnectedBefore = true
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, table, filter])
}
