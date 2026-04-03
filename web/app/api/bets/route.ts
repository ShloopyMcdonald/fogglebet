import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

interface BetPayload {
  arb_id: string
  is_taken: boolean
  is_training?: boolean
  game_time: string | null
  bet_name: string
  sport: string | null
  market: string | null
  line: string | null
  book: string
  odds: number
  liquidity: number | null
  ev_percent: number | null
  arb_percent: number | null
  book_odds?: Record<string, unknown> | null
  stake?: number
  source_url: string | null
  notes?: string | null
}

function isValidBet(b: unknown): b is BetPayload {
  if (typeof b !== 'object' || b === null) return false
  const bet = b as Record<string, unknown>
  return (
    typeof bet.arb_id === 'string' &&
    typeof bet.is_taken === 'boolean' &&
    typeof bet.bet_name === 'string' &&
    typeof bet.book === 'string' &&
    typeof bet.odds === 'number'
  )
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  if (apiKey !== process.env.API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!Array.isArray(body) || body.length !== 2) {
    return NextResponse.json(
      { error: 'Body must be an array of exactly 2 bet objects' },
      { status: 400 }
    )
  }

  const [betA, betB] = body
  if (!isValidBet(betA) || !isValidBet(betB)) {
    return NextResponse.json(
      { error: 'Each bet must have arb_id, is_taken, bet_name, book, and odds' },
      { status: 400 }
    )
  }

  if (betA.arb_id !== betB.arb_id) {
    return NextResponse.json({ error: 'Both bets must share the same arb_id' }, { status: 400 })
  }

  // Duplicate check for training bets: same game + market cannot be logged twice
  if (betA.is_training && betA.market) {
    const gamePrefix = betA.bet_name.split(' \u2014 ')[0]

    let query = supabase
      .from('bets')
      .select('id')
      .eq('is_training', true)
      .eq('market', betA.market)
      .ilike('bet_name', `${gamePrefix}%`)

    // If game_time is known, constrain to the same UTC day to allow same matchup on different dates
    if (betA.game_time) {
      const gameDate = betA.game_time.slice(0, 10)
      const nextDate = new Date(`${gameDate}T00:00:00Z`)
      nextDate.setUTCDate(nextDate.getUTCDate() + 1)
      const nextDateStr = nextDate.toISOString().slice(0, 10)
      query = query
        .gte('game_time', `${gameDate}T00:00:00Z`)
        .lt('game_time', `${nextDateStr}T00:00:00Z`)
    }

    const { data: existing } = await query.limit(1)

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: 'Duplicate: this game and market are already in training data' },
        { status: 409 }
      )
    }
  }

  console.log('book_odds received:', JSON.stringify(betA.book_odds))

  const rows = [betA, betB].map((b) => ({
    arb_id: b.arb_id,
    is_taken: b.is_taken,
    is_training: b.is_training ?? false,
    game_time: b.game_time ?? null,
    bet_name: b.bet_name,
    sport: b.sport ?? null,
    market: b.market ?? null,
    line: b.line ?? null,
    book: b.book,
    odds: b.odds,
    liquidity: b.liquidity ?? null,
    ev_percent: b.ev_percent ?? null,
    arb_percent: b.arb_percent ?? null,
    stake: b.stake ?? 1,
    book_odds: b.book_odds ?? null,
    source_url: b.source_url ?? null,
    notes: b.notes ?? null,
  }))

  const { error } = await supabase.from('bets').insert(rows)
  if (error) {
    console.error('Supabase insert error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  // If game is within ±15min of now, trigger closing-odds lookup immediately
  // so we don't depend on the cron happening to fire in the right window
  const gameTime = betA.game_time ? new Date(betA.game_time).getTime() : null
  if (gameTime != null && Math.abs(gameTime - Date.now()) < 15 * 60 * 1000) {
    const origin = new URL(req.url).origin
    const cronSecret = process.env.CRON_SECRET
    fetch(`${origin}/api/cron/closing-odds`, {
      headers: cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {},
    }).catch((err) => console.warn('[bets] background closing-odds trigger failed:', err))
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}

export async function GET(req: NextRequest) {
  // Internal — no auth required (dashboard is private by URL)
  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100'), 500)
  const offset = parseInt(searchParams.get('offset') ?? '0')

  const { data, error } = await supabase
    .from('bets')
    .select('*')
    .order('recorded_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    console.error('Supabase fetch error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  return NextResponse.json(data)
}
