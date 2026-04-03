'use server'

import { supabase } from '@/lib/supabase'
import { refresh } from 'next/cache'

export async function deleteArb(arbId: string, _formData?: FormData): Promise<void> {
  const { error } = await supabase
    .from('bets')
    .delete()
    .eq('arb_id', arbId)

  if (error) {
    console.error('Failed to delete arb:', error)
    throw new Error('Delete failed')
  }

  refresh()
}

export async function deleteTodaysBets(): Promise<{ deleted: number }> {
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)

  const { data, error } = await supabase
    .from('bets')
    .delete()
    .gte('recorded_at', todayStart.toISOString())
    .select('id')

  if (error) {
    console.error('Failed to delete today\'s bets:', error)
    throw new Error('Delete failed')
  }

  refresh()
  return { deleted: data?.length ?? 0 }
}
