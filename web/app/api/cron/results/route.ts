import { NextRequest, NextResponse } from 'next/server'
import { supabase, Bet } from '@/lib/supabase'
import {
  ESPN_SPORT_MAP,
  EspnGame,
  EspnSummary,
  fetchScoreboard,
  fetchGameSummary,
  parseTeamsFromBetName,
  findGame,
  determineResult,
  calcProfitLoss,
  toEtDateStr,
} from '@/lib/espn'

const PROP_MARKETS = new Set(['Spread', 'Moneyline', 'Total'])

function isPlayerPropMarket(market: string): boolean {
  return market.includes(' - ') && !PROP_MARKETS.has(market)
}

export async function GET(req: NextRequest) {
  // Auth: Vercel sends Authorization: Bearer {CRON_SECRET}
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // Fetch all pending bets where game_time is known and past the 3h buffer
  const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
  const { data, error: fetchError } = await supabase
    .from('bets')
    .select('*')
    .eq('result', 'pending')
    .not('game_time', 'is', null)
    .lt('game_time', cutoff)

  if (fetchError) {
    console.error('[results-cron] DB fetch error:', fetchError)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  const pending = (data ?? []) as Bet[]
  if (pending.length === 0) {
    return NextResponse.json({ resolved: 0, total: 0 })
  }

  console.log(`[results-cron] Processing ${pending.length} pending bets`)

  // Cache scoreboards by "sport/league/etDate" to avoid duplicate ESPN fetches
  const scoreboardCache = new Map<string, EspnGame[]>()
  // Cache game summaries by ESPN game ID
  const summaryCache = new Map<string, EspnSummary>()

  let resolved = 0
  const failedIds: string[] = []

  for (const bet of pending) {
    if (!bet.sport || !bet.game_time) continue

    // Normalize sport: "NCAAB (M)" → "NCAAB", "NCAAF (W)" → "NCAAF", etc.
    const sportKey = bet.sport.toUpperCase().replace(/\s*\([^)]*\)\s*$/, '').trim()
    const mapping = ESPN_SPORT_MAP[sportKey]
    if (!mapping) {
      console.warn(`[results-cron] No ESPN mapping for sport: "${bet.sport}" (bet ${bet.id})`)
      continue
    }

    // Fetch ESPN scoreboard, cached per sport+date
    const etDate = toEtDateStr(bet.game_time)
    const scoreboardKey = `${sportKey}/${mapping.league}/${etDate}`
    if (!scoreboardCache.has(scoreboardKey)) {
      const games = await fetchScoreboard(mapping.sport, mapping.league, bet.game_time)
      scoreboardCache.set(scoreboardKey, games)
      console.log(`[results-cron] Fetched ${games.length} ${bet.sport} games for ${etDate}`)
    }
    const games = scoreboardCache.get(scoreboardKey)!

    // Parse teams from bet_name ("team1 vs team2 — market — sideLabel")
    const teams = parseTeamsFromBetName(bet.bet_name)
    if (!teams) {
      console.warn(`[results-cron] Cannot parse teams from: "${bet.bet_name}"`)
      continue
    }

    // Match to ESPN game
    const game = findGame(games, teams[0], teams[1])
    if (!game) {
      console.warn(
        `[results-cron] No ESPN game match for "${bet.bet_name}" (${bet.sport} ${etDate})`
      )
      continue
    }

    // Fetch box score summary for player prop bets
    let summary: EspnSummary | null = null
    if (isPlayerPropMarket(bet.market ?? '')) {
      if (!summaryCache.has(game.id)) {
        const s = await fetchGameSummary(mapping.sport, mapping.league, game.id)
        summaryCache.set(game.id, s)
      }
      summary = summaryCache.get(game.id) ?? null
    }

    // Determine win/loss/push
    const result = determineResult(bet, game, summary)
    if (!result) continue // game not final yet, or unresolvable

    // P&L only applies to bets the user actually placed
    const profit_loss = bet.is_taken
      ? calcProfitLoss(result, bet.odds, bet.stake)
      : null

    const { error: updateError } = await supabase
      .from('bets')
      .update({ result, profit_loss })
      .eq('id', bet.id)

    if (updateError) {
      console.error(`[results-cron] Update failed for bet ${bet.id}:`, updateError)
      failedIds.push(bet.id)
    } else {
      console.log(`[results-cron] Resolved bet ${bet.id}: ${result} (P&L: ${profit_loss})`)
      resolved++
    }
  }

  return NextResponse.json({
    resolved,
    total: pending.length,
    ...(failedIds.length > 0 && { errors: failedIds }),
  })
}
