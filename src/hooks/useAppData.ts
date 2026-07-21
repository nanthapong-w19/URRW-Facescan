import { useEffect, useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { getMembers, getCheckins } from '@/lib/store'
import { applyMemberEvent, applyCheckinEvent } from '@/lib/realtimeSync'
import type { RealtimeChange } from '@/lib/realtimeSync'
import type { Member, CheckinRecord, MemberRow, CheckinChangeRow } from '@/lib/types'

export function useAppData() {
  const [members, setMembers] = useState<Member[]>([])
  const [checkins, setCheckins] = useState<CheckinRecord[]>([])
  const [loading, setLoading] = useState(true)
  const hasShownErrorRef = useRef(false)
  // Realtime checkin events need the current members list to resolve a
  // check-in's name/department (see applyCheckinEvent) without waiting on
  // `members` as an effect dependency — a ref keeps the subscription's
  // callback closures reading live state without re-subscribing on every
  // members update.
  const membersRef = useRef<Member[]>([])
  membersRef.current = members

  const refresh = useCallback(async () => {
    try {
      const [nextMembers, nextCheckins] = await Promise.all([getMembers(), getCheckins()])
      setMembers(nextMembers)
      setCheckins(nextCheckins)
    } catch (err) {
      // Avoid spamming toasts if the DB is unreachable and every realtime
      // event retriggers a failing refetch — show it once per session.
      if (!hasShownErrorRef.current) {
        hasShownErrorRef.current = true
        toast.error(err instanceof Error ? err.message : 'ไม่สามารถโหลดข้อมูลจากฐานข้อมูลได้')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()

    // Subscribe to Postgres changes on both tables so every open kiosk/tab
    // reflects new members, edits, and check-ins the moment they happen
    // anywhere else — this is what makes the dashboard's "Live" feed live
    // across devices, not just within one browser tab.
    //
    // Each event patches the one row it describes (via realtimeSync.ts)
    // instead of calling refresh() and refetching everything — a single
    // check-in used to trigger a full members-table refetch (face
    // descriptors, photos, the lot) even though only one checkins row
    // actually changed.
    let hasConnectedBefore = false
    const channel = supabase
      .channel('facein-live-data')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'facein_members' }, (payload) => {
        setMembers((prev) => applyMemberEvent(prev, payload as unknown as RealtimeChange<MemberRow>))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'facein_checkins' }, (payload) => {
        setCheckins((prev) =>
          applyCheckinEvent(prev, payload as unknown as RealtimeChange<CheckinChangeRow>, membersRef.current)
        )
      })
      .subscribe((status) => {
        // 'SUBSCRIBED' fires on the initial connect AND on every reconnect
        // after a dropped websocket. The initial connect is already covered
        // by the unconditional refresh() above, so this only re-fetches on
        // a genuine reconnect — the safety net that heals any event missed
        // while disconnected, without reintroducing a refetch on every event.
        if (status === 'SUBSCRIBED') {
          if (hasConnectedBefore) refresh()
          hasConnectedBefore = true
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [refresh])

  return { members, checkins, loading, refresh }
}
