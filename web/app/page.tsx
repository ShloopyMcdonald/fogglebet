import { supabase, type Bet } from '@/lib/supabase'
import { Dashboard } from '@/components/Dashboard'

export const revalidate = 0

async function getTakenBets(): Promise<Bet[]> {
  // Step 1: get arb_ids of the most recent taken bets
  const { data: takenLegs, error: e1 } = await supabase
    .from('bets')
    .select('arb_id')
    .eq('is_taken', true)
    .order('recorded_at', { ascending: false })
    .limit(200)

  if (e1 || !takenLegs || takenLegs.length === 0) return []

  const arbIds = [...new Set(takenLegs.map((b: { arb_id: string }) => b.arb_id))]

  // Step 2: fetch both legs for every taken arb
  const { data, error } = await supabase
    .from('bets')
    .select('*')
    .in('arb_id', arbIds)
    .order('recorded_at', { ascending: false })

  if (error) console.error('Failed to fetch taken bets:', error)
  return data ?? []
}

export default async function Home() {
  const takenBets = await getTakenBets()
  return <Dashboard takenBets={takenBets} />
}
