import { supabase, type Bet } from '@/lib/supabase'
import { DeleteArbButton } from '@/components/DeleteArbButton'

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

function formatOdds(odds: number | null): string {
  if (odds == null) return '—'
  return odds > 0 ? `+${odds}` : `${odds}`
}

function formatPercent(n: number | null): string {
  if (n == null) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function ResultBadge({ result }: { result: Bet['result'] }) {
  const styles: Record<Bet['result'], string> = {
    pending: 'bg-zinc-800 text-zinc-400',
    win: 'bg-emerald-900/60 text-emerald-400',
    loss: 'bg-red-900/60 text-red-400',
    push: 'bg-yellow-900/60 text-yellow-400',
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${styles[result]}`}>
      {result}
    </span>
  )
}

function TakenBadge({ is_taken }: { is_taken: boolean }) {
  return is_taken ? (
    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-blue-900/60 text-blue-400">
      taken
    </span>
  ) : (
    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-zinc-800 text-zinc-500">
      passed
    </span>
  )
}

export default async function BetFeed() {
  const bets = await getBets()

  return (
    <div
      className="min-h-screen"
      style={{
        background: 'radial-gradient(ellipse at 20% 10%, #0f172a 0%, #0b0b0f 60%)',
      }}
    >
      {/* Header */}
      <header className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight text-white">FoggleBet</h1>
        <span className="text-xs text-zinc-500">{bets.length} bets</span>
      </header>

      <main className="px-4 py-6 max-w-7xl mx-auto">
        {bets.length === 0 ? (
          <div className="text-center py-24 text-zinc-500 text-sm">
            No bets logged yet. Use the Chrome extension on picktheodds.com to log your first arb.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-white/5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-xs text-zinc-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">Time</th>
                  <th className="text-left px-4 py-3 font-medium">Bet</th>
                  <th className="text-left px-4 py-3 font-medium">Sport</th>
                  <th className="text-left px-4 py-3 font-medium">Market</th>
                  <th className="text-right px-4 py-3 font-medium">Odds</th>
                  <th className="text-right px-4 py-3 font-medium">Arb%</th>
                  <th className="text-left px-4 py-3 font-medium">Book</th>
                  <th className="text-right px-4 py-3 font-medium">Liq</th>
                  <th className="text-right px-4 py-3 font-medium">CLV</th>
                  <th className="text-center px-4 py-3 font-medium">Side</th>
                  <th className="text-center px-4 py-3 font-medium">Result</th>
                  <th className="text-right px-4 py-3 font-medium">P&amp;L</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {bets.map((bet, i) => {
                  const isNewArb = i === 0 || bets[i - 1].arb_id !== bet.arb_id
                  const clvPositive = bet.clv != null && bet.clv > 0
                  const clvNegative = bet.clv != null && bet.clv < 0

                  return (
                    <tr
                      key={bet.id}
                      className={`border-b border-white/5 hover:bg-white/[0.03] transition-colors ${
                        isNewArb ? 'border-t border-white/10' : ''
                      }`}
                    >
                      <td className="px-4 py-3 text-zinc-400 whitespace-nowrap text-xs">
                        {formatDate(bet.recorded_at)}
                      </td>
                      <td className="px-4 py-3 text-white max-w-[220px] truncate font-medium">
                        {bet.bet_name}
                      </td>
                      <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">
                        {bet.sport ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">
                        {bet.market ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-medium text-white whitespace-nowrap">
                        {formatOdds(bet.odds)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-400 whitespace-nowrap">
                        {bet.arb_percent != null ? `${bet.arb_percent.toFixed(2)}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-zinc-300 whitespace-nowrap">
                        {bet.book}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-400 whitespace-nowrap">
                        {bet.liquidity != null ? `$${bet.liquidity}` : '—'}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono font-medium whitespace-nowrap ${
                          clvPositive
                            ? 'text-emerald-400'
                            : clvNegative
                            ? 'text-red-400'
                            : 'text-zinc-500'
                        }`}
                      >
                        {formatPercent(bet.clv)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <TakenBadge is_taken={bet.is_taken} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <ResultBadge result={bet.result} />
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono font-medium whitespace-nowrap ${
                          bet.profit_loss != null && bet.profit_loss > 0
                            ? 'text-emerald-400'
                            : bet.profit_loss != null && bet.profit_loss < 0
                            ? 'text-red-400'
                            : 'text-zinc-500'
                        }`}
                      >
                        {bet.profit_loss != null
                          ? `${bet.profit_loss > 0 ? '+' : ''}${bet.profit_loss.toFixed(2)}u`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isNewArb && <DeleteArbButton arbId={bet.arb_id} />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
