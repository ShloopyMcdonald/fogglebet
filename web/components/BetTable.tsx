'use client'

import { useState } from 'react'
import type { Bet } from '@/lib/supabase'
import { deleteArb } from '@/app/actions'

type BookOddsEntry = { odds: number; liquidity?: number }
type BookOdds = Record<string, Record<string, BookOddsEntry>>

function formatOdds(odds: number | null): string {
  if (odds == null) return '—'
  return odds > 0 ? `+${odds}` : `${odds}`
}

function formatBetTitle(bet: { market: string | null; line: string | null; bet_name: string }): string {
  const market = bet.market?.trim()
  const line = bet.line?.trim()

  if (market) {
    // Market format from PickTheOdds: "PropType - LastName, FirstInitial"
    // e.g. "Points - Doncic, L" → "L. Doncic under 33.5 points"
    const dashIdx = market.indexOf(' - ')
    if (dashIdx !== -1) {
      const propType = market.slice(0, dashIdx).toLowerCase()
      const playerPart = market.slice(dashIdx + 3)
      const commaIdx = playerPart.indexOf(', ')
      if (commaIdx !== -1) {
        const lastName = playerPart.slice(0, commaIdx)
        const firstInitial = playerPart.slice(commaIdx + 2)[0]?.toUpperCase()
        if (firstInitial) {
          const lineStr = line ? ` ${line.toLowerCase()}` : ''
          return `${firstInitial}. ${lastName}${lineStr} ${propType}`
        }
      }
    }
  }

  return bet.bet_name
}

function formatGameTime(ts: string | null): string {
  if (!ts) return '—'
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

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-zinc-500 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function BookOddsTable({ bookOdds }: { bookOdds: BookOdds }) {
  const rows = Object.entries(bookOdds).flatMap(([book, sides]) =>
    Object.entries(sides).map(([side, entry]) => ({ book, side, ...entry }))
  )
  if (rows.length === 0) return <p className="text-zinc-600 text-xs">No book odds data</p>

  return (
    <table className="text-xs w-full">
      <thead>
        <tr className="text-zinc-500 uppercase tracking-wide">
          <th className="text-left pb-1.5 font-medium">Book</th>
          <th className="text-right pb-1.5 font-medium">Odds</th>
          <th className="text-right pb-1.5 font-medium">Liq</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ book, side, odds, liquidity }) => (
          <tr key={book + side} className="border-t border-white/5">
            <td className="py-1 text-zinc-300">{book}</td>
            <td className="py-1 text-right font-mono text-white">{formatOdds(odds)}</td>
            <td className="py-1 text-right font-mono text-zinc-400">
              {liquidity != null ? `$${liquidity.toLocaleString()}` : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function BetTable({ bets }: { bets: Bet[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [deletedArbs, setDeletedArbs] = useState<Set<string>>(new Set())

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleDelete = (arbId: string) => {
    setDeletedArbs(prev => new Set(prev).add(arbId))
    deleteArb(arbId).catch(() => {
      setDeletedArbs(prev => { const next = new Set(prev); next.delete(arbId); return next })
    })
  }

  const visibleBets = bets.filter(b => !deletedArbs.has(b.arb_id))

  return (
    <div className="rounded-lg border border-white/5 overflow-hidden">
      {visibleBets.map((bet, i) => {
        const isOpen = expanded.has(bet.id)
        const isNewArb = i === 0 || visibleBets[i - 1].arb_id !== bet.arb_id

        return (
          <div key={bet.id} className={isNewArb && i > 0 ? 'border-t border-white/10' : ''}>
            {/* Compact row */}
            <div
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.03] cursor-pointer border-b border-white/5 transition-colors"
              onClick={() => toggle(bet.id)}
            >
              {/* Bet name + book */}
              <div className="flex-1 min-w-0 flex items-baseline gap-2 overflow-hidden">
                <span className="text-white font-medium text-sm uppercase truncate">{formatBetTitle(bet)}</span>
                <span className="text-zinc-500 text-xs whitespace-nowrap shrink-0">{bet.book}</span>
              </div>

              {/* Game time */}
              <div className="text-xs text-zinc-500 whitespace-nowrap hidden sm:block">
                {formatGameTime(bet.game_time)}
              </div>

              {/* Odds */}
              <div className="font-mono font-semibold text-sm text-white whitespace-nowrap w-14 text-right">
                {formatOdds(bet.odds)}
              </div>

              <TakenBadge is_taken={bet.is_taken} />
              <ResultBadge result={bet.result} />
              <ChevronIcon open={isOpen} />
            </div>

            {/* Expanded section */}
            {isOpen && (
              <div className="px-4 py-3 bg-white/[0.02] border-b border-white/5 flex gap-8 flex-wrap">
                {/* Book odds */}
                <div className="flex-1 min-w-[200px]">
                  {bet.book_odds ? (
                    <BookOddsTable bookOdds={bet.book_odds as BookOdds} />
                  ) : (
                    <p className="text-zinc-600 text-xs">No book odds recorded</p>
                  )}
                </div>

                {/* Meta + actions */}
                <div className="flex flex-col gap-1.5 text-xs text-zinc-500 justify-between">
                  <div className="space-y-1">
                    {bet.arb_percent != null && (
                      <div>Arb: <span className="text-zinc-300">{bet.arb_percent.toFixed(2)}%</span></div>
                    )}
                    {bet.clv != null && (
                      <div>CLV: <span className={bet.clv > 0 ? 'text-emerald-400' : 'text-red-400'}>{bet.clv > 0 ? '+' : ''}{bet.clv.toFixed(2)}%</span></div>
                    )}
                    {bet.profit_loss != null && (
                      <div>P&L: <span className={bet.profit_loss > 0 ? 'text-emerald-400' : 'text-red-400'}>{bet.profit_loss > 0 ? '+' : ''}{bet.profit_loss.toFixed(2)}u</span></div>
                    )}
                    <div>Book: <span className="text-zinc-300">{bet.book}</span></div>
                  </div>
                  {isNewArb && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(bet.arb_id) }}
                      className="text-xs text-zinc-500 hover:text-red-400 transition-colors px-2 py-1 text-left"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
