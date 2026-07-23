import { useEffect, useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { getMembers, getCheckins } from '@/lib/store'
import { applyMemberEvent, applyCheckinEvent } from '@/lib/realtimeSync'
import type { RealtimeChange } from '@/lib/realtimeSync'
import { useRealtimeChannel } from '@/hooks/useRealtimeChannel'
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
  }, [refresh])

  // Subscribed to Postgres changes on both tables so every open kiosk/tab
  // reflects new members, edits, and check-ins the moment they happen
  // anywhere else — this is what makes the dashboard's "Live" feed live
  // across devices, not just within one browser tab.
  //
  // Each event patches the one row it describes (via realtimeSync.ts)
  // instead of calling refresh() and refetching everything — a single
  // check-in used to trigger a full members-table refetch (face
  // descriptors, photos, the lot) even though only one checkins row
  // actually changed. `refresh` (refetches both) is passed as the
  // reconnect safety net for both — harmless if both channels happen to
  // reconnect close together.
  useRealtimeChannel({
    table: 'facein_members',
    onEvent: (payload) => {
      setMembers((prev) => applyMemberEvent(prev, payload as unknown as RealtimeChange<MemberRow>))
    },
    onReconnect: refresh,
  })
  useRealtimeChannel({
    table: 'facein_checkins',
    onEvent: (payload) => {
      setCheckins((prev) =>
        applyCheckinEvent(prev, payload as unknown as RealtimeChange<CheckinChangeRow>, membersRef.current)
      )
    },
    onReconnect: refresh,
  })

  return { members, checkins, loading, refresh }
}
