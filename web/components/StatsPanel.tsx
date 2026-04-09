'use client'

import { useState, useEffect, useRef } from 'react'
import type { Bet, BetResult } from '@/lib/supabase'
import { supabase } from '@/lib/supabase'

const BOOK_COLORS = [
  '#34d399', // emerald
  '#60a5fa', // blue
  '#f472b6', // pink
  '#fb923c', // orange
  '#a78bfa', // violet
  '#facc15', // yellow
  '#2dd4bf', // teal
  '#f87171', // red
]

function computeUnitPL(odds: number, result: BetResult): number {
  if (result === 'push') return 0
  if (result === 'loss') return -1
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds)
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function niceTicks(min: number, max: number): number[] {
  const range = max - min || 2
  const roughStep = range / 4
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(roughStep) || 0.1)))
  const step = Math.max(Math.ceil(roughStep / magnitude) * magnitude, 0.5)
  const start = Math.floor(min / step) * step
  const ticks: number[] = []
  let t = start
  while (t <= max + step * 0.01 && ticks.length < 10) {
    ticks.push(Math.round(t * 1000) / 1000)
    t += step
  }
  return ticks
}

function PLChart({ bets, colorMap }: { bets: Bet[]; colorMap?: Record<string, string> }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<{ book: string; color: string; x: number; y: number } | null>(null)
  const settled = bets.filter(b => b.result !== 'pending')

  if (settled.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-600 text-sm">
        No settled bets yet.
      </div>
    )
  }

  const books = [...new Set(settled.map(b => b.book))].sort()

  const series = books.map(book => {
    // Aggregate by calendar day (YYYY-MM-DD based on game_time/recorded_at)
    const dayMap = new Map<string, number>()
    for (const b of settled.filter(bet => bet.book === book)) {
      const d = new Date(b.game_time ?? b.recorded_at)
      const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      dayMap.set(dayKey, (dayMap.get(dayKey) ?? 0) + computeUnitPL(b.odds, b.result))
    }

    const sortedDays = [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b))

    const ORIGIN_TIME = new Date('2026-03-27T12:00:00Z').getTime()

    let cum = 0
    const points: { time: number; cumPL: number }[] = [{ time: ORIGIN_TIME, cumPL: 0 }]
    for (const [dayKey, pl] of sortedDays) {
      cum += pl
      const time = new Date(dayKey + 'T12:00:00Z').getTime()
      if (time > ORIGIN_TIME) points.push({ time, cumPL: parseFloat(cum.toFixed(4)) })
    }
    return { book, points, total: cum }
  })

  const ORIGIN_TIME = new Date('2026-03-27T12:00:00Z').getTime()
  const allTimes = [ORIGIN_TIME, ...series.flatMap(s => s.points.map(p => p.time))]
  const allPLs = series.flatMap(s => s.points.map(p => p.cumPL))
  const minTime = ORIGIN_TIME
  const maxTime = Math.max(...allTimes)

  // Extend each series to the right edge so lines don't stop early
  for (const s of series) {
    const last = s.points[s.points.length - 1]
    if (last && last.time < maxTime) {
      s.points.push({ time: maxTime, cumPL: last.cumPL })
    }
  }
  const rawMinPL = Math.min(0, Math.min(...allPLs))
  const rawMaxPL = Math.max(0, Math.max(...allPLs))

  const PAD = { top: 24, right: 24, bottom: 40, left: 52 }
  const W = 720
  const H = 280
  const cW = W - PAD.left - PAD.right
  const cH = H - PAD.top - PAD.bottom

  const timeRange = maxTime - minTime || 1
  const plRange = rawMaxPL - rawMinPL || 1

  const xP = (t: number) => PAD.left + ((t - minTime) / timeRange) * cW
  const yP = (v: number) => PAD.top + (1 - (v - rawMinPL) / plRange) * cH

  const yTicks = niceTicks(rawMinPL, rawMaxPL)

  const xTickCount = Math.min(6, allTimes.length)
  const xTicks: number[] =
    xTickCount <= 1
      ? [minTime]
      : Array.from({ length: xTickCount }, (_, i) => minTime + (i / (xTickCount - 1)) * timeRange)

  const handleLineMouseMove = (e: React.MouseEvent, book: string, color: string) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    setTooltip({ book, color, x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-2 mb-5">
        {series.map(({ book, total }, i) => {
          const color = colorMap?.[book] ?? BOOK_COLORS[i % BOOK_COLORS.length]
          return (
            <div key={book} className="flex items-center gap-2 text-xs">
              <svg width="18" height="10" className="shrink-0">
                <line x1="0" y1="5" x2="18" y2="5" stroke={color} strokeWidth="2.5" />
              </svg>
              <span className="text-zinc-300">{book}</span>
              <span
                className="font-mono font-medium"
                style={{ color: total >= 0 ? '#34d399' : '#f87171' }}
              >
                {total > 0 ? '+' : ''}{total.toFixed(2)}u
              </span>
            </div>
          )
        })}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ maxHeight: 300 }}
        aria-label="Cumulative P&L by sportsbook"
      >
        {/* Horizontal grid lines + Y labels */}
        {yTicks.map(tick => (
          <g key={tick}>
            <line
              x1={PAD.left}
              y1={yP(tick)}
              x2={PAD.left + cW}
              y2={yP(tick)}
              stroke={tick === 0 ? '#52525b' : '#27272a'}
              strokeWidth={1}
              strokeDasharray={tick === 0 ? undefined : '3 3'}
            />
            <text
              x={PAD.left - 8}
              y={yP(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              fill="#71717a"
              fontSize="11"
              fontFamily="var(--font-geist-mono, monospace)"
            >
              {tick > 0 ? '+' : ''}{tick % 1 === 0 ? tick.toFixed(0) : tick.toFixed(1)}
            </text>
          </g>
        ))}

        {/* X axis baseline */}
        <line
          x1={PAD.left}
          y1={PAD.top + cH}
          x2={PAD.left + cW}
          y2={PAD.top + cH}
          stroke="#27272a"
          strokeWidth={1}
        />

        {/* X axis date labels */}
        {xTicks.map((t, i) => (
          <text
            key={i}
            x={xP(t)}
            y={H - PAD.bottom + 16}
            textAnchor="middle"
            fill="#71717a"
            fontSize="11"
            fontFamily="var(--font-geist-sans, sans-serif)"
          >
            {formatDate(t)}
          </text>
        ))}

        {/* Lines per book */}
        {series.map(({ book, points }, i) => {
          if (points.length === 0) return null
          const color = colorMap?.[book] ?? BOOK_COLORS[i % BOOK_COLORS.length]

          if (points.length === 1) {
            return (
              <g
                key={book}
                onMouseMove={(e) => handleLineMouseMove(e, book, color)}
                onMouseLeave={() => setTooltip(null)}
                style={{ cursor: 'crosshair' }}
              >
                <circle cx={xP(points[0].time)} cy={yP(points[0].cumPL)} r={10} fill="transparent" />
                <circle cx={xP(points[0].time)} cy={yP(points[0].cumPL)} r={4} fill={color} />
              </g>
            )
          }

          const d = points
            .map((p, j) => `${j === 0 ? 'M' : 'L'}${xP(p.time).toFixed(1)},${yP(p.cumPL).toFixed(1)}`)
            .join(' ')

          return (
            <g
              key={book}
              onMouseMove={(e) => handleLineMouseMove(e, book, color)}
              onMouseLeave={() => setTooltip(null)}
              style={{ cursor: 'crosshair' }}
            >
              {/* Wider transparent hit area */}
              <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
              <path
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {points.map((p, j) => (
                <circle key={j} cx={xP(p.time)} cy={yP(p.cumPL)} r={2.5} fill={color} />
              ))}
            </g>
          )
        })}
      </svg>

      {tooltip && (
        <div
          style={{
            position: 'absolute',
            left: tooltip.x + 14,
            top: tooltip.y - 28,
            background: '#18181b',
            border: `1px solid ${tooltip.color}`,
            borderRadius: 4,
            padding: '3px 8px',
            color: tooltip.color,
            fontSize: 11,
            fontFamily: 'var(--font-geist-mono, monospace)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 10,
          }}
        >
          {tooltip.book}
        </div>
      )}
    </div>
  )
}

function CLVBarChart({ bets, colorMap }: { bets: Bet[]; colorMap?: Record<string, string> }) {
  // Exclude outliers beyond ±10%
  const withClv = bets.filter(b => b.clv !== null && Math.abs(b.clv) <= 10)

  if (withClv.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-600 text-sm">
        No CLV data yet.
      </div>
    )
  }

  const books = [...new Set(withClv.map(b => b.book))].sort()

  const bars = books.map((book, i) => {
    const bookBets = withClv.filter(b => b.book === book)
    const avg = bookBets.reduce((sum, b) => sum + b.clv!, 0) / bookBets.length
    const color = colorMap?.[book] ?? BOOK_COLORS[i % BOOK_COLORS.length]
    return { book, avg: parseFloat(avg.toFixed(4)), color }
  })

  // Symmetric range so 0 is always the vertical midpoint
  const maxAbs = Math.max(0.5, ...bars.map(b => Math.abs(b.avg)))
  const symMin = -maxAbs
  const symMax = maxAbs

  const PAD = { top: 32, right: 24, bottom: 40, left: 52 }
  const W = 720
  const H = 280
  const cW = W - PAD.left - PAD.right
  const cH = H - PAD.top - PAD.bottom

  const valRange = symMax - symMin
  const yP = (v: number) => PAD.top + (1 - (v - symMin) / valRange) * cH
  const zeroY = yP(0) // always vertical center

  const yTicks = niceTicks(symMin, symMax)

  const slotW = cW / books.length
  const barW = Math.min(slotW * 0.5, 60)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ maxHeight: 300 }}
      aria-label="Average CLV % by sportsbook"
    >
      {/* Y grid + labels */}
      {yTicks.map(tick => (
        <g key={tick}>
          <line
            x1={PAD.left} y1={yP(tick)}
            x2={PAD.left + cW} y2={yP(tick)}
            stroke={tick === 0 ? '#52525b' : '#27272a'}
            strokeWidth={1}
            strokeDasharray={tick === 0 ? undefined : '3 3'}
          />
          <text
            x={PAD.left - 8} y={yP(tick)}
            textAnchor="end" dominantBaseline="middle"
            fill="#71717a" fontSize="11"
            fontFamily="var(--font-geist-mono, monospace)"
          >
            {tick > 0 ? '+' : ''}{tick % 1 === 0 ? tick.toFixed(0) : tick.toFixed(1)}%
          </text>
        </g>
      ))}

      {/* Bars */}
      {bars.map(({ book, avg, color }, i) => {
        const cx = PAD.left + slotW * i + slotW / 2
        const barX = cx - barW / 2
        const barTop = avg >= 0 ? yP(avg) : zeroY
        const barH = Math.abs(yP(avg) - zeroY)
        // Positive: label above bar. Negative: label inside bar near bottom.
        const labelY = avg >= 0 ? barTop - 5 : barTop + barH - 6

        return (
          <g key={book}>
            <rect
              x={barX} y={barTop}
              width={barW} height={Math.max(barH, 1)}
              fill={color}
              opacity={0.85}
              rx={2}
            />
            {/* Value label */}
            <text
              x={cx} y={labelY}
              textAnchor="middle"
              dominantBaseline={avg >= 0 ? 'auto' : 'auto'}
              fill={avg >= 0 ? color : '#18181b'}
              fontSize="11"
              fontFamily="var(--font-geist-mono, monospace)"
              fontWeight="600"
            >
              {avg > 0 ? '+' : ''}{avg.toFixed(2)}%
            </text>
            {/* Book label — always below chart area, never overlaps bars */}
            <text
              x={cx} y={H - PAD.bottom + 16}
              textAnchor="middle"
              fill="#71717a" fontSize="11"
              fontFamily="var(--font-geist-sans, sans-serif)"
            >
              {book}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

const MARKET_GROUPS = ['Moneyline', 'Spread', 'Totals', 'Player Props'] as const
type MarketGroup = typeof MARKET_GROUPS[number]

function getMarketGroup(market: string | null): MarketGroup | null {
  if (!market) return null
  if (market === 'Moneyline') return 'Moneyline'
  if (market === 'Spread') return 'Spread'
  if (market === 'Total' || market.startsWith('Total ')) return 'Totals'
  return 'Player Props'
}

function SectionHeading({ title, count }: { title: string; count: number | null }) {
  return (
    <div className="flex items-baseline gap-3 mb-4">
      <h2 className="text-sm font-semibold text-white uppercase tracking-wide">{title}</h2>
      {count !== null && (
        <span className="text-xs text-zinc-500">{count} settled bet{count !== 1 ? 's' : ''}</span>
      )}
    </div>
  )
}

async function fetchAllSettledTrainingBets(): Promise<Bet[]> {
  const PAGE = 1000
  const results: Bet[] = []
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('bets').select('*')
      .eq('is_training', true).neq('result', 'pending')
      .order('recorded_at', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error || !data || data.length === 0) break
    results.push(...(data as Bet[]))
    if (data.length < PAGE) break
    offset += PAGE
  }
  return results
}

async function fetchAllTakenBets(): Promise<Bet[]> {
  const PAGE = 1000
  const results: Bet[] = []
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('bets').select('*')
      .eq('is_training', false).eq('is_taken', true)
      .order('recorded_at', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error || !data || data.length === 0) break
    results.push(...(data as Bet[]))
    if (data.length < PAGE) break
    offset += PAGE
  }
  return results
}

export function StatsPanel({ takenBets }: { takenBets: Bet[] }) {
  const [trainingBets, setTrainingBets] = useState<Bet[] | null>(null)
  const [allTakenBets, setAllTakenBets] = useState<Bet[] | null>(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    fetchAllSettledTrainingBets()
      .then(data => setTrainingBets(data))
      .catch(() => setLoadError(true))
  }, [])

  useEffect(() => {
    fetchAllTakenBets()
      .then(data => setAllTakenBets(data))
      .catch(() => { /* use prop as fallback */ })
  }, [])

  const betsForStats = allTakenBets ?? takenBets
  const settledTaken = betsForStats.filter(b => b.result !== 'pending')

  // Build stable book→color maps so colors are consistent across all charts
  const trainingColorMap: Record<string, string> = Object.fromEntries(
    [...new Set((trainingBets ?? []).map(b => b.book))].sort()
      .map((book, i) => [book, BOOK_COLORS[i % BOOK_COLORS.length]])
  )
  const takenColorMap: Record<string, string> = Object.fromEntries(
    [...new Set(betsForStats.map(b => b.book))].sort()
      .map((book, i) => [book, BOOK_COLORS[i % BOOK_COLORS.length]])
  )

  return (
    <div className="space-y-10">
      {/* ── Training Stats ─────────────────────────────────────────── */}
      <section>
        <SectionHeading
          title="Training Stats"
          count={trainingBets ? trainingBets.length : null}
        />
        {loadError ? (
          <div className="rounded-lg border border-white/5 px-5 py-5">
            <div className="text-center py-12 text-red-500 text-sm">Failed to load training bets.</div>
          </div>
        ) : trainingBets === null ? (
          <div className="rounded-lg border border-white/5 px-5 py-5">
            <div className="text-center py-12 text-zinc-600 text-sm">Loading…</div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* PnL charts */}
            <div className="rounded-lg border border-white/5 px-5 py-5">
              <PLChart bets={trainingBets} colorMap={trainingColorMap} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              {MARKET_GROUPS.map(group => {
                const groupBets = trainingBets.filter(b => getMarketGroup(b.market) === group)
                const settledCount = groupBets.filter(b => b.result !== 'pending').length
                return (
                  <div key={group} className="rounded-lg border border-white/5 px-5 py-5">
                    <div className="flex items-baseline gap-2 mb-4">
                      <span className="text-xs font-semibold text-white uppercase tracking-wide">{group}</span>
                      <span className="text-xs text-zinc-500">{settledCount} settled bet{settledCount !== 1 ? 's' : ''}</span>
                    </div>
                    <PLChart bets={groupBets} colorMap={trainingColorMap} />
                  </div>
                )
              })}
            </div>

            {/* CLV bar charts */}
            <div className="rounded-lg border border-white/5 px-5 py-5">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-xs font-semibold text-white uppercase tracking-wide">Avg CLV % by Book</span>
              </div>
              <CLVBarChart bets={trainingBets} colorMap={trainingColorMap} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              {MARKET_GROUPS.map(group => {
                const groupBets = trainingBets.filter(b => getMarketGroup(b.market) === group)
                return (
                  <div key={group} className="rounded-lg border border-white/5 px-5 py-5">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-xs font-semibold text-white uppercase tracking-wide">{group} — CLV</span>
                    </div>
                    <CLVBarChart bets={groupBets} colorMap={trainingColorMap} />
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </section>

      {/* ── Real Stats ─────────────────────────────────────────────── */}
      <section>
        <SectionHeading
          title="Real Stats"
          count={settledTaken.length}
        />
        <div className="rounded-lg border border-white/5 px-5 py-5">
          <PLChart bets={betsForStats} colorMap={takenColorMap} />
        </div>
      </section>
    </div>
  )
}
