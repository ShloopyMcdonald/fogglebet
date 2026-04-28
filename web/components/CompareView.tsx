'use client'

import { useState, useEffect, useMemo } from 'react'
import type { Bet } from '@/lib/supabase'
import { supabase } from '@/lib/supabase'
import { BetTable } from '@/components/BetTable'

// ─── Market filter ────────────────────────────────────────────────────────────

type MarketFilter = 'All' | 'Moneyline' | 'Spread' | 'Total' | 'Player Props'
const MARKET_FILTERS: MarketFilter[] = ['All', 'Moneyline', 'Spread', 'Total', 'Player Props']

function matchesMarket(market: string | null, filter: MarketFilter): boolean {
  if (filter === 'All') return true
  const m = market ?? ''
  if (filter === 'Player Props') return m.includes(' - ')
  if (filter === 'Total') return m === 'Total' || m.startsWith('Total ')
  return m === filter
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function StatCard({ label, value, color = 'text-white' }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-white/5 px-4 py-4">
      <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-xl font-mono font-semibold ${color}`}>{value}</div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

type FetchState = 'idle' | 'loading' | 'error'

export function CompareView() {
  const [availableBooks, setAvailableBooks] = useState<string[]>([])
  const [bookA, setBookA] = useState('')
  const [bookB, setBookB] = useState('')
  const [marketFilter, setMarketFilter] = useState<MarketFilter>('All')

  const [fetchState, setFetchState] = useState<FetchState>('idle')
  const [allBets, setAllBets] = useState<Bet[] | null>(null)

  // Load distinct books on first render
  useEffect(() => {
    async function loadBooks() {
      const PAGE = 1000
      const seen = new Set<string>()
      let offset = 0
      while (true) {
        const { data, error } = await supabase
          .from('bets')
          .select('book')
          .range(offset, offset + PAGE - 1)
        if (error || !data || data.length === 0) break
        for (const row of data as { book: string }[]) seen.add(row.book)
        if (data.length < PAGE) break
        offset += PAGE
      }
      setAvailableBooks([...seen].sort())
    }
    loadBooks()
  }, [])

  // Fetch when both books are selected
  useEffect(() => {
    if (!bookA || !bookB || bookA === bookB) {
      setAllBets(null)
      setFetchState('idle')
      return
    }

    let cancelled = false
    setFetchState('loading')
    setAllBets(null)

    ;(async () => {
      try {
        // Phase 1: lightweight — find arb_ids where both books appear
        const PAGE = 1000
        const lightweight: { arb_id: string; book: string; market: string | null }[] = []
        let offset = 0
        while (true) {
          const { data, error } = await supabase
            .from('bets')
            .select('arb_id, book, market')
            .in('book', [bookA, bookB])
            .range(offset, offset + PAGE - 1)
          if (error || !data) throw new Error('fetch failed')
          lightweight.push(...(data as typeof lightweight))
          if (data.length < PAGE) break
          offset += PAGE
        }

        const arbBooks = new Map<string, Set<string>>()
        for (const row of lightweight) {
          if (!arbBooks.has(row.arb_id)) arbBooks.set(row.arb_id, new Set())
          arbBooks.get(row.arb_id)!.add(row.book)
        }
        const matchingArbIds = [...arbBooks.entries()]
          .filter(([, bks]) => bks.has(bookA) && bks.has(bookB))
          .map(([id]) => id)

        if (matchingArbIds.length === 0) {
          if (!cancelled) { setAllBets([]); setFetchState('idle') }
          return
        }

        // Phase 2: full bet data in batches of 100 arb_ids
        const fullBets: Bet[] = []
        for (let i = 0; i < matchingArbIds.length; i += 100) {
          const batch = matchingArbIds.slice(i, i + 100)
          const { data, error } = await supabase
            .from('bets')
            .select('*')
            .in('arb_id', batch)
            .order('recorded_at', { ascending: false })
          if (error || !data) throw new Error('full fetch failed')
          fullBets.push(...(data as Bet[]))
        }

        if (!cancelled) {
          setAllBets(fullBets)
          setFetchState('idle')
        }
      } catch {
        if (!cancelled) setFetchState('error')
      }
    })()

    return () => { cancelled = true }
  }, [bookA, bookB])

  // Apply market filter client-side at arb level
  const filteredBets = useMemo(() => {
    if (!allBets) return null
    const qualifying = new Set<string>()
    for (const bet of allBets) {
      if (matchesMarket(bet.market, marketFilter)) qualifying.add(bet.arb_id)
    }
    return allBets.filter(b => qualifying.has(b.arb_id))
  }, [allBets, marketFilter])

  // Summary stats
  const summary = useMemo(() => {
    if (!filteredBets || filteredBets.length === 0) return null
    const arbIds = new Set(filteredBets.map(b => b.arb_id))
    const takenLegs = filteredBets.filter(b => b.is_taken)
    const settledTaken = takenLegs.filter(b => b.result !== 'pending')
    const takenArbIds = new Set(takenLegs.map(b => b.arb_id))
    const pnl = settledTaken.length > 0
      ? settledTaken.reduce((sum, b) => sum + (b.profit_loss ?? 0), 0)
      : null
    const clvBets = filteredBets.filter(b => b.clv !== null)
    const avgClv = clvBets.length > 0
      ? clvBets.reduce((sum, b) => sum + b.clv!, 0) / clvBets.length
      : null
    return { arbCount: arbIds.size, takenCount: takenArbIds.size, pnl, avgClv }
  }, [filteredBets])

  const bothSelected = bookA && bookB && bookA !== bookB

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500 uppercase tracking-wide">Book A</label>
          <select
            value={bookA}
            onChange={e => setBookA(e.target.value)}
            className="bg-zinc-900 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
          >
            <option value="">Select a book</option>
            {availableBooks.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        <span className="text-zinc-600 text-sm pb-2">vs</span>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500 uppercase tracking-wide">Book B</label>
          <select
            value={bookB}
            onChange={e => setBookB(e.target.value)}
            className="bg-zinc-900 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
          >
            <option value="">Select a book</option>
            {availableBooks.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500 uppercase tracking-wide">Market</label>
          <div className="flex gap-1">
            {MARKET_FILTERS.map(f => (
              <button
                key={f}
                onClick={() => setMarketFilter(f)}
                className={`px-3 py-2 rounded text-xs font-medium transition-colors ${
                  marketFilter === f
                    ? 'bg-white/10 text-white'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* States */}
      {!bookA || !bookB ? (
        <div className="text-center py-20 text-zinc-600 text-sm">Select two books to compare.</div>
      ) : bookA === bookB ? (
        <div className="text-center py-20 text-zinc-600 text-sm">Select two different books.</div>
      ) : fetchState === 'error' ? (
        <div className="text-center py-20 text-red-500 text-sm">Failed to load bets.</div>
      ) : fetchState === 'loading' ? (
        <div className="text-center py-20 text-zinc-500 text-sm">Loading…</div>
      ) : filteredBets && filteredBets.length === 0 ? (
        <div className="text-center py-20 text-zinc-600 text-sm">
          No bets found for {bookA} vs {bookB}{marketFilter !== 'All' ? ` · ${marketFilter}` : ''}.
        </div>
      ) : bothSelected && summary && filteredBets ? (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Arbs" value={summary.arbCount.toLocaleString()} />
            <StatCard label="Taken" value={summary.takenCount.toLocaleString()} />
            {summary.pnl !== null && (
              <StatCard
                label="P&L"
                value={`${summary.pnl >= 0 ? '+$' : '-$'}${Math.abs(summary.pnl).toFixed(2)}`}
                color={summary.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}
              />
            )}
            {summary.avgClv !== null && (
              <StatCard
                label="Avg CLV"
                value={`${summary.avgClv >= 0 ? '+' : ''}${summary.avgClv.toFixed(2)}%`}
                color={summary.avgClv >= 0 ? 'text-emerald-400' : 'text-red-400'}
              />
            )}
          </div>

          {/* Bet list */}
          <BetTable bets={filteredBets} />
        </>
      ) : null}
    </div>
  )
}
