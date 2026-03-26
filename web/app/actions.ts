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
