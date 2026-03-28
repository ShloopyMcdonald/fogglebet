'use client'

import { useState } from 'react'
import type { Bet } from '@/lib/supabase'
import { BetTable } from '@/components/BetTable'

// ─── Grouping helpers ────────────────────────────────────────────────────────

function mondayOf(d: Date): Date {
  const day = d.getDay() // 0=Sun
  const monday = new Date(d)
  monday.setDate(d.getDate() - ((day + 6) % 7))
  monday.setHours(0, 0, 0, 0)
  return monday
}

function toDateKey(d: Date): string {
  return d.toISOString().split('T')[0] // "2026-03-28"
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

interface DayGroup  { dayKey: string;   bets: Bet[] }
interface WeekGroup { weekKey: string;  days: DayGroup[] }
interface MonthGroup { monthKey: string; weeks: WeekGroup[] }

function groupBets(bets: Bet[]): MonthGroup[] {
  const monthMap = new Map<string, Map<string, Map<string, Bet[]>>>()

  for (const bet of bets) {
    const d = new Date(bet.recorded_at)
    const monthKey = toMonthKey(d)
    const weekKey  = toDateKey(mondayOf(d))
    const dayKey   = toDateKey(d)

    if (!monthMap.has(monthKey)) monthMap.set(monthKey, new Map())
    const weekMap = monthMap.get(monthKey)!
    if (!weekMap.has(weekKey)) weekMap.set(weekKey, new Map())
    const dayMap = weekMap.get(weekKey)!
    if (!dayMap.has(dayKey)) dayMap.set(dayKey, [])
    dayMap.get(dayKey)!.push(bet)
  }

  return Array.from(monthMap.entries()).map(([monthKey, weekMap]) => ({
    monthKey,
    weeks: Array.from(weekMap.entries()).map(([weekKey, dayMap]) => ({
      weekKey,
      days: Array.from(dayMap.entries()).map(([dayKey, dayBets]) => ({ dayKey, bets: dayBets })),
    })),
  }))
}

function arbCount(bets: Bet[]): number {
  return new Set(bets.map(b => b.arb_id)).size
}

// ─── Chevron ─────────────────────────────────────────────────────────────────

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

// ─── Main component ───────────────────────────────────────────────────────────

export function TrainingTable({ bets }: { bets: Bet[] }) {
  const groups = groupBets(bets)

  const today     = toDateKey(new Date())
  const thisWeek  = toDateKey(mondayOf(new Date()))
  const thisMonth = toMonthKey(new Date())

  const [openMonths, setOpenMonths] = useState<Set<string>>(() => new Set([thisMonth]))
  const [openWeeks,  setOpenWeeks]  = useState<Set<string>>(() => new Set([thisWeek]))
  const [openDays,   setOpenDays]   = useState<Set<string>>(() => new Set([today]))

  function toggle<T>(set: Set<T>, key: T): Set<T> {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }

  if (groups.length === 0) {
    return (
      <div className="text-center py-24 text-zinc-500 text-sm">
        No training data yet. Use the Chrome extension and select &ldquo;Log for training&rdquo;.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {groups.map(({ monthKey, weeks }) => {
        const monthOpen  = openMonths.has(monthKey)
        const monthArbs  = arbCount(weeks.flatMap(w => w.days.flatMap(d => d.bets)))

        return (
          <div key={monthKey} className="rounded-lg border border-white/5 overflow-hidden">
            {/* Month header */}
            <button
              onClick={() => setOpenMonths(toggle(openMonths, monthKey))}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.03] transition-colors"
            >
              <span className="text-sm font-semibold text-white">
                {formatMonthLabel(monthKey)}
              </span>
              <div className="flex items-center gap-3 text-zinc-500">
                <span className="text-xs">{monthArbs.toLocaleString()} arbs</span>
                <Chevron open={monthOpen} />
              </div>
            </button>

            {monthOpen && (
              <div className="border-t border-white/5">
                {weeks.map(({ weekKey, days }) => {
                  const weekOpen = openWeeks.has(weekKey)
                  const weekArbs = arbCount(days.flatMap(d => d.bets))

                  return (
                    <div key={weekKey} className="border-b border-white/5 last:border-0">
                      {/* Week header */}
                      <button
                        onClick={() => setOpenWeeks(toggle(openWeeks, weekKey))}
                        className="w-full flex items-center justify-between px-6 py-2.5 hover:bg-white/[0.03] transition-colors"
                      >
                        <span className="text-sm font-medium text-zinc-300">
                          {formatWeekLabel(weekKey)}
                        </span>
                        <div className="flex items-center gap-3 text-zinc-500">
                          <span className="text-xs">{weekArbs.toLocaleString()} arbs</span>
                          <Chevron open={weekOpen} />
                        </div>
                      </button>

                      {weekOpen && (
                        <div className="border-t border-white/5">
                          {days.map(({ dayKey, bets: dayBets }) => {
                            const dayOpen = openDays.has(dayKey)
                            const dayArbs = arbCount(dayBets)

                            return (
                              <div key={dayKey} className="border-b border-white/5 last:border-0">
                                {/* Day header */}
                                <button
                                  onClick={() => setOpenDays(toggle(openDays, dayKey))}
                                  className="w-full flex items-center justify-between px-8 py-2 hover:bg-white/[0.03] transition-colors"
                                >
                                  <span className="text-xs font-medium text-zinc-400">
                                    {formatDayLabel(dayKey)}
                                  </span>
                                  <div className="flex items-center gap-3 text-zinc-600">
                                    <span className="text-xs">{dayArbs.toLocaleString()} arbs</span>
                                    <Chevron open={dayOpen} />
                                  </div>
                                </button>

                                {dayOpen && (
                                  <div className="border-t border-white/5">
                                    <BetTable bets={dayBets} />
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
