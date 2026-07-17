import { useEffect, useState, useCallback } from 'react'
import { getMembers, getCheckins, subscribe } from '@/lib/store'
import type { Member, CheckinRecord } from '@/lib/types'

export function useAppData() {
  const [members, setMembers] = useState<Member[]>(getMembers())
  const [checkins, setCheckins] = useState<CheckinRecord[]>(getCheckins())

  const refresh = useCallback(() => {
    setMembers(getMembers())
    setCheckins(getCheckins())
  }, [])

  useEffect(() => {
    refresh()
    const unsub = subscribe(refresh)
    // Also refresh when the tab regains focus, in case data changed
    // in another tab (simulated multi-kiosk realtime).
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      unsub()
      window.removeEventListener('focus', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [refresh])

  return { members, checkins, refresh }
}
