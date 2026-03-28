import { supabase, type Bet } from '@/lib/supabase'
import { BetTable } from '@/components/BetTable'

export const revalidate = 0 // always fresh

async function getBets(): Promise<Bet[]> {
  const { data, error } = await supabase
    .from('bets')
    .select('*')
    .order('recorded_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('Failed to fetch bets:', error)
    return []
  }
  return data ?? []
}

export default async function BetFeed() {
  const bets = await getBets()

  return (
    <div
      className="min-h-screen"
      style={{ background: 'radial-gradient(ellipse at 20% 10%, #0f172a 0%, #0b0b0f 60%)' }}
    >
      <header className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight text-white">FoggleBet</h1>
        <span className="text-xs text-zinc-500">{bets.length} bets</span>
      </header>

      <main className="px-4 py-6 max-w-6xl mx-auto">
        {bets.length === 0 ? (
          <div className="text-center py-24 text-zinc-500 text-sm">
            No bets logged yet. Use the Chrome extension on picktheodds.com to log your first arb.
          </div>
        ) : (
          <BetTable bets={bets} />
        )}
      </main>
    </div>
  )
}
