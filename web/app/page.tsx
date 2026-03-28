import { supabase, type Bet } from '@/lib/supabase'
import { Dashboard } from '@/components/Dashboard'

export const revalidate = 0

async function getAllBets(): Promise<{ taken: Bet[]; training: Bet[] }> {
  const [takenResult, trainingResult] = await Promise.all([
    supabase.from('bets').select('*').eq('is_training', false).order('recorded_at', { ascending: false }).limit(200),
    supabase.from('bets').select('*').eq('is_training', true).order('recorded_at', { ascending: false }).limit(5000),
  ])

  if (takenResult.error) console.error('Failed to fetch taken bets:', takenResult.error)
  if (trainingResult.error) console.error('Failed to fetch training bets:', trainingResult.error)

  return {
    taken: takenResult.data ?? [],
    training: trainingResult.data ?? [],
  }
}

export default async function Home() {
  const { taken, training } = await getAllBets()
  return <Dashboard takenBets={taken} trainingBets={training} />
}
