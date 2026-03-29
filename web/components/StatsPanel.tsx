'use client'

import type { Bet, BetResult } from '@/lib/supabase'

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

export function StatsPanel({ bets }: { bets: Bet[] }) {
  const settled = bets.filter(b => b.result !== 'pending')

  if (settled.length === 0) {
    return (
      <div className="text-center py-24 text-zinc-500 text-sm">
        No settled bets yet.
      </div>
    )
  }

  const books = [...new Set(settled.map(b => b.book))].sort()

  const series = books.map(book => {
    const pts = settled
      .filter(b => b.book === book)
      .map(b => ({
        time: new Date(b.game_time ?? b.recorded_at).getTime(),
        pl: computeUnitPL(b.odds, b.result),
      }))
      .sort((a, b) => a.time - b.time)

    let cum = 0
    const points = pts.map(({ time, pl }) => {
      cum += pl
      return { time, cumPL: parseFloat(cum.toFixed(4)) }
    })
    return { book, points, total: cum }
  })

  const allTimes = series.flatMap(s => s.points.map(p => p.time))
  const allPLs = series.flatMap(s => s.points.map(p => p.cumPL))
  const minTime = Math.min(...allTimes)
  const maxTime = Math.max(...allTimes)
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

  return (
    <div>
      <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wide mb-4">
        Cumulative P&amp;L by Sportsbook (units, 1u/bet)
      </h2>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-2 mb-5">
        {series.map(({ book, total }, i) => {
          const color = BOOK_COLORS[i % BOOK_COLORS.length]
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
          const color = BOOK_COLORS[i % BOOK_COLORS.length]

          if (points.length === 1) {
            return (
              <circle
                key={book}
                cx={xP(points[0].time)}
                cy={yP(points[0].cumPL)}
                r={4}
                fill={color}
              />
            )
          }

          const d = points
            .map((p, j) => `${j === 0 ? 'M' : 'L'}${xP(p.time).toFixed(1)},${yP(p.cumPL).toFixed(1)}`)
            .join(' ')

          return (
            <g key={book}>
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
    </div>
  )
}
