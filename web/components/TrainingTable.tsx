'use client'

import { useState, useEffect } from 'react'
import type { Bet } from '@/lib/supabase'
import { supabase } from '@/lib/supabase'
import { BetTable } from '@/components/BetTable'

// ─── Date helpers ─────────────────────────────────────────────────────────────

function mondayOf(d: Date): Date {
  const day = d.getDay()
  const monday = new Date(d)
  monday.setDate(d.getDate() - ((day + 6) % 7))
  monday.setHours(0, 0, 0, 0)
  return monday
}

function toDateKey(d: Date): string {
  return d.toISOString().split('T')[0]
}

function toMonthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-')
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

function formatWeekLabel(weekStart: string): string {
  const d = new Date(weekStart + 'T12:00:00')
  return 'Week of ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDayLabel(dayKey: string): string {
  const d = new Date(dayKey + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// ─── Structure types ──────────────────────────────────────────────────────────

type SummaryItem = { recorded_at: string; arb_id: string }

interface DayGroup   { dayKey: string;  betCount: number }
interface WeekGroup  { weekKey: string; betCount: number; days: DayGroup[] }
interface MonthGroup { monthKey: string; betCount: number; weeks: WeekGroup[] }

function buildStructure(items: SummaryItem[]): MonthGroup[] {
  // monthKey → weekKey → dayKey → bet count
  const monthMap = new Map<string, Map<string, Map<string, number>>>()

  for (const item of items) {
    const d = new Date(item.recorded_at)
    const monthKey = toMonthKey(d)
    const weekKey  = toDateKey(mondayOf(d))
    const dayKey   = toDateKey(d)

    if (!monthMap.has(monthKey)) monthMap.set(monthKey, new Map())
    const weekMap = monthMap.get(monthKey)!
    if (!weekMap.has(weekKey)) weekMap.set(weekKey, new Map())
    const dayMap = weekMap.get(weekKey)!
    dayMap.set(dayKey, (dayMap.get(dayKey) ?? 0) + 1)
  }

  return Array.from(monthMap.entries()).map(([monthKey, weekMap]) => {
    let monthBetCount = 0
    const weeks = Array.from(weekMap.entries()).map(([weekKey, dayMap]) => {
      let weekBetCount = 0
      const days = Array.from(dayMap.entries()).map(([dayKey, count]) => {
        weekBetCount += count
        return { dayKey, betCount: count }
      })
      monthBetCount += weekBetCount
      return { weekKey, betCount: weekBetCount, days }
    })
    return { monthKey, betCount: monthBetCount, weeks }
  })
}

// ─── Chevron ──────────────────────────────────────────────────────────────────

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 transition-transform duration-150 shrink-0 ${open ? 'rotate-180' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

// ─── Over/Under P&L summary ───────────────────────────────────────────────────

interface OUSummary {
  overPL: number
  overCount: number
  underPL: number
  underCount: number
}

function isPlayerProp(market: string | null): boolean {
  return market != null && market.includes(' - ')
}

function OUPnlDisplay({ summary }: { summary: OUSummary | null }) {
  if (!summary) return null

  const { overPL, overCount, underPL, underCount } = summary

  function fmt(n: number) {
    const sign = n >= 0 ? '+' : ''
    return `${sign}${n.toFixed(2)}u`
  }

  return (
    <div className="flex gap-4 mb-4">
      <div className="flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
        <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Overs P&L</div>
        <div className={`text-lg font-semibold tabular-nums ${overPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {fmt(overPL)}
        </div>
        <div className="text-xs text-zinc-600 mt-0.5">{overCount} settled bets · per $1 unit</div>
      </div>
      <div className="flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
        <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Unders P&L</div>
        <div className={`text-lg font-semibold tabular-nums ${underPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {fmt(underPL)}
        </div>
        <div className="text-xs text-zinc-600 mt-0.5">{underCount} settled bets · per $1 unit</div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

type LoadState = 'idle' | 'loading' | 'error'
type DayData = Bet[] | 'loading' | 'error'

export function TrainingTable() {
  const [status, setStatus]     = useState<LoadState>('loading')
  const [structure, setStructure] = useState<MonthGroup[]>([])
  const [ouSummary, setOUSummary] = useState<OUSummary | null>(null)

  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set())
  const [openWeeks,  setOpenWeeks]  = useState<Set<string>>(new Set())
  const [openDays,   setOpenDays]   = useState<Set<string>>(new Set())

  const [dayData, setDayData] = useState<Map<string, DayData>>(new Map())

  // Load lightweight structure (recorded_at + arb_id only) on first mount
  useEffect(() => {
    let cancelled = false

    async function loadStructure() {
      const PAGE = 1000
      const all: SummaryItem[] = []
      let offset = 0
      while (true) {
        const { data, error } = await supabase
          .from('bets')
          .select('recorded_at, arb_id')
          .eq('is_training', true)
          .order('recorded_at', { ascending: true })
          .range(offset, offset + PAGE - 1)
        if (error || !data) throw new Error('fetch failed')
        all.push(...(data as SummaryItem[]))
        if (data.length < PAGE) break
        offset += PAGE
      }
      return all
    }

    async function loadOUSummary() {
      const PAGE = 1000
      const all: Array<{ market: string | null; line: string | null; odds: number; result: string | null }> = []
      let offset = 0
      while (true) {
        const { data, error } = await supabase
          .from('bets')
          .select('market, line, odds, result')
          .eq('is_training', true)
          .range(offset, offset + PAGE - 1)
        if (error || !data) throw new Error('fetch failed')
        all.push(...(data as typeof all))
        if (data.length < PAGE) break
        offset += PAGE
      }

      // Compute P&L per $1 unit from result + odds (profit_loss only exists for taken bets)
      function unitPL(odds: number, result: string): number {
        if (result === 'win') return odds > 0 ? odds / 100 : 100 / Math.abs(odds)
        if (result === 'loss') return -1
        return 0 // push
      }

      let overPL = 0, overCount = 0, underPL = 0, underCount = 0
      for (const row of all) {
        if (!isPlayerProp(row.market)) continue
        if (row.result === 'pending' || row.result == null) continue
        const dir = (row.line ?? '').toLowerCase()
        const pl = unitPL(row.odds, row.result)
        if (dir.startsWith('over')) {
          overPL += pl
          overCount++
        } else if (dir.startsWith('under')) {
          underPL += pl
          underCount++
        }
      }
      return { overPL, overCount, underPL, underCount }
    }

    Promise.all([loadStructure(), loadOUSummary()])
      .then(([items, summary]) => {
        if (cancelled) return
        setStructure(buildStructure(items))
        setOUSummary(summary)
        setStatus('idle')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })

    return () => { cancelled = true }
  }, [])

  function toggleMonth(key: string) {
    setOpenMonths(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s })
  }
  function toggleWeek(key: string) {
    setOpenWeeks(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s })
  }
  function toggleDay(dayKey: string) {
    const isOpening = !openDays.has(dayKey)
    setOpenDays(prev => { const s = new Set(prev); s.has(dayKey) ? s.delete(dayKey) : s.add(dayKey); return s })

    if (isOpening && !dayData.has(dayKey)) {
      setDayData(prev => new Map(prev).set(dayKey, 'loading'))

      supabase
        .from('bets')
        .select('*')
        .eq('is_training', true)
        .gte('recorded_at', dayKey + 'T00:00:00.000Z')
        .lte('recorded_at', dayKey + 'T23:59:59.999Z')
        .order('recorded_at', { ascending: false })
        .then(({ data, error }) => {
          setDayData(prev => new Map(prev).set(dayKey, error || !data ? 'error' : data as Bet[]))
        })
    }
  }

  if (status === 'loading') {
    return <div className="text-center py-24 text-zinc-500 text-sm">Loading training data…</div>
  }
  if (status === 'error') {
    return <div className="text-center py-24 text-red-500 text-sm">Failed to load training data.</div>
  }
  if (structure.length === 0) {
    return (
      <div className="text-center py-24 text-zinc-500 text-sm">
        No training data yet. Use the Chrome extension and select &ldquo;Log for training&rdquo;.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <OUPnlDisplay summary={ouSummary} />
      {structure.map(({ monthKey, betCount: monthBetCount, weeks }) => {
        const monthOpen = openMonths.has(monthKey)
        return (
          <div key={monthKey} className="rounded-lg border border-white/5 overflow-hidden">
            <button
              onClick={() => toggleMonth(monthKey)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.03] transition-colors"
            >
              <span className="text-sm font-semibold text-white">{formatMonthLabel(monthKey)}</span>
              <div className="flex items-center gap-3 text-zinc-500">
                <span className="text-xs">{monthBetCount.toLocaleString()} bets</span>
                <Chevron open={monthOpen} />
              </div>
            </button>

            {monthOpen && (
              <div className="border-t border-white/5">
                {weeks.map(({ weekKey, betCount: weekBetCount, days }) => {
                  const weekOpen = openWeeks.has(weekKey)
                  return (
                    <div key={weekKey} className="border-b border-white/5 last:border-0">
                      <button
                        onClick={() => toggleWeek(weekKey)}
                        className="w-full flex items-center justify-between px-6 py-2.5 hover:bg-white/[0.03] transition-colors"
                      >
                        <span className="text-sm font-medium text-zinc-300">{formatWeekLabel(weekKey)}</span>
                        <div className="flex items-center gap-3 text-zinc-500">
                          <span className="text-xs">{weekBetCount.toLocaleString()} bets</span>
                          <Chevron open={weekOpen} />
                        </div>
                      </button>

                      {weekOpen && (
                        <div className="border-t border-white/5">
                          {days.map(({ dayKey, betCount: dayBetCount }) => {
                            const dayOpen = openDays.has(dayKey)
                            const data = dayData.get(dayKey)
                            return (
                              <div key={dayKey} className="border-b border-white/5 last:border-0">
                                <button
                                  onClick={() => toggleDay(dayKey)}
                                  className="w-full flex items-center justify-between px-8 py-2 hover:bg-white/[0.03] transition-colors"
                                >
                                  <span className="text-xs font-medium text-zinc-400">{formatDayLabel(dayKey)}</span>
                                  <div className="flex items-center gap-3 text-zinc-600">
                                    <span className="text-xs">{dayBetCount.toLocaleString()} bets</span>
                                    <Chevron open={dayOpen} />
                                  </div>
                                </button>

                                {dayOpen && (
                                  <div className="border-t border-white/5">
                                    {data === 'loading' && (
                                      <div className="py-6 text-center text-xs text-zinc-500">Loading…</div>
                                    )}
                                    {data === 'error' && (
                                      <div className="py-6 text-center text-xs text-red-500">Failed to load bets for this day.</div>
                                    )}
                                    {Array.isArray(data) && <BetTable bets={data} />}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
