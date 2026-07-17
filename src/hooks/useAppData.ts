import { useEffect, useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { getMembers, getCheckins } from '@/lib/store'
import type { Member, CheckinRecord } from '@/lib/types'

export function useAppData() {
  const [members, setMembers] = useState<Member[]>([])
  const [checkins, setCheckins] = useState<CheckinRecord[]>([])
  const [loading, setLoading] = useState(true)
  const hasShownErrorRef = useRef(false)

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
    const channel = supabase
      .channel('facein-live-data')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'facein_members' }, () => refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'facein_checkins' }, () => refresh())
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [refresh])

  return { members, checkins, loading, refresh }
}
