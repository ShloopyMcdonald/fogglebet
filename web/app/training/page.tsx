import { supabase, type Bet } from '@/lib/supabase'
import { TrainingTable } from '@/components/TrainingTable'

export const revalidate = 0

async function getTrainingBets(): Promise<Bet[]> {
  const { data, error } = await supabase
    .from('bets')
    .select('*')
    .eq('is_training', true)
    .order('recorded_at', { ascending: false })
    .limit(5000)

  if (error) {
    console.error('Failed to fetch training bets:', error)
    return []
  }
  return data ?? []
}

export default async function TrainingPage() {
  const bets = await getTrainingBets()

  return (
    <main className="px-4 py-6 max-w-6xl mx-auto w-full">
      <TrainingTable bets={bets} />
    </main>
  )
}
