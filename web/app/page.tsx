import { supabase, type Bet } from '@/lib/supabase'
import { BetTable } from '@/components/BetTable'

export const revalidate = 0

async function getTakenBets(): Promise<Bet[]> {
  const { data, error } = await supabase
    .from('bets')
    .select('*')
    .eq('is_training', false)
    .order('recorded_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('Failed to fetch bets:', error)
    return []
  }
  return data ?? []
}

export default async function TakenBetsPage() {
  const bets = await getTakenBets()

  return (
    <main className="px-4 py-6 max-w-6xl mx-auto w-full">
      {bets.length === 0 ? (
        <div className="text-center py-24 text-zinc-500 text-sm">
          No taken bets yet. Use the Chrome extension on picktheodds.app to log your first bet.
        </div>
      ) : (
        <BetTable bets={bets} />
      )}
    </main>
  )
}
