import { supabase, type Bet } from '@/lib/supabase'
import { Dashboard } from '@/components/Dashboard'

export const revalidate = 0

async function getTakenBets(): Promise<Bet[]> {
  const { data, error } = await supabase
    .from('bets')
    .select('*')
    .eq('is_taken', true)
    .order('recorded_at', { ascending: false })
    .limit(200)

  if (error) console.error('Failed to fetch taken bets:', error)
  return data ?? []
}

export default async function Home() {
  const takenBets = await getTakenBets()
  return <Dashboard takenBets={takenBets} />
}
