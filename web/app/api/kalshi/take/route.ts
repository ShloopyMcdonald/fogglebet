import { NextRequest, NextResponse } from 'next/server'
import { getMarket, getOrderbook, createOrder } from '@/lib/kalshi'
import {
  matchSide,
  maxAcceptablePriceCents,
  availableAtCap,
  kellyContracts,
} from '@/lib/kalshi-math'

// Places a taker-only, price-capped IOC order on Kalshi (demo). No DB writes —
// the Kalshi demo account is the record. Blocks (422) rather than guessing when
// the market doesn't verifiably match the bet.

interface TakeRequest {
  ticker: string
  side_label: string
  odds: number
  edge: number
  bankroll: number
  kelly_fraction: number
}

function isValidBody(b: unknown): b is TakeRequest {
  if (typeof b !== 'object' || b === null) return false
  const o = b as Record<string, unknown>
  return (
    typeof o.ticker === 'string' && o.ticker.length > 0 &&
    typeof o.side_label === 'string' && o.side_label.length > 0 &&
    typeof o.odds === 'number' && Number.isFinite(o.odds) && o.odds !== 0 &&
    typeof o.edge === 'number' && o.edge > 0 && o.edge <= 0.5 &&
    typeof o.bankroll === 'number' && o.bankroll > 0 &&
    typeof o.kelly_fraction === 'number' && o.kelly_fraction > 0 && o.kelly_fraction <= 1
  )
}

function toNum(v: string | number | undefined): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') return parseFloat(v)
  return NaN
}

export async function POST(request: NextRequest) {
  if (request.headers.get('x-api-key') !== process.env.API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!isValidBody(body)) {
    return NextResponse.json(
      { error: 'Body must include ticker, side_label, odds, edge, bankroll, kelly_fraction' },
      { status: 400 }
    )
  }
  const { ticker, side_label, odds, edge, bankroll, kelly_fraction } = body

  // 1. Fetch + verify the market
  let market
  try {
    market = await getMarket(ticker)
  } catch (err) {
    console.error('[kalshi/take] getMarket failed:', err)
    return NextResponse.json(
      { blocked: 'market_not_found', detail: String(err) },
      { status: 422 }
    )
  }

  const marketInfo = {
    ticker: market.ticker,
    title: market.title ?? null,
    yes_sub_title: market.yes_sub_title ?? null,
    no_sub_title: market.no_sub_title ?? null,
    status: market.status ?? null,
  }

  if (market.status !== 'active') {
    return NextResponse.json(
      { blocked: 'market_not_tradable', market: marketInfo },
      { status: 422 }
    )
  }

  // 2. Side verification — PTO sometimes links the wrong market. Never guess.
  const side = matchSide(side_label, market)
  if (!side) {
    console.warn(`[kalshi/take] side mismatch: "${side_label}" vs`, marketInfo)
    return NextResponse.json(
      { blocked: 'side_mismatch', market: marketInfo },
      { status: 422 }
    )
  }

  // 3. Size: min(Kelly, liquidity at acceptable prices)
  const capCents = maxAcceptablePriceCents(odds)
  if (capCents < 1) {
    return NextResponse.json(
      { blocked: 'no_liquidity', cap_cents: capCents, available: 0, market: marketInfo },
      { status: 422 }
    )
  }

  let orderbook
  try {
    orderbook = await getOrderbook(ticker)
  } catch (err) {
    console.error('[kalshi/take] getOrderbook failed:', err)
    return NextResponse.json({ error: `Orderbook fetch failed: ${err}` }, { status: 502 })
  }

  const available = availableAtCap(orderbook, side, capCents)
  const kelly = kellyContracts(bankroll, edge, kelly_fraction, odds, capCents)
  const count = Math.min(kelly, available)
  if (count < 1) {
    return NextResponse.json(
      {
        blocked: 'no_liquidity',
        cap_cents: capCents,
        available,
        kelly_contracts: kelly,
        market: marketInfo,
      },
      { status: 422 }
    )
  }

  // 4. Place the price-capped IOC order.
  // V2 order side: 'bid' buys YES; 'ask' sells YES (= opens NO). Price is
  // always the YES price: cap for YES buys, (100 - cap) for NO buys.
  const orderSide = side === 'yes' ? 'bid' : 'ask'
  const yesPriceCents = side === 'yes' ? capCents : 100 - capCents
  let order
  try {
    order = await createOrder({
      ticker,
      side: orderSide,
      priceDollars: (yesPriceCents / 100).toFixed(2),
      count: count.toFixed(2),
    })
  } catch (err) {
    console.error('[kalshi/take] createOrder failed:', err)
    return NextResponse.json({ error: `Order failed: ${err}` }, { status: 502 })
  }

  const filled = toNum(order.fill_count)
  if (!Number.isFinite(filled) || filled < 1) {
    return NextResponse.json(
      {
        blocked: 'no_fill',
        cap_cents: capCents,
        available,
        order_id: order.order_id ?? null,
        market: marketInfo,
      },
      { status: 422 }
    )
  }

  // avg fill is a YES price; the NO buyer's per-contract cost is 1 − avgFill
  const avgFillYes = toNum(order.average_fill_price)
  const perContract = side === 'yes' ? avgFillYes : Number.isFinite(avgFillYes) ? 1 - avgFillYes : NaN
  const feePerContract = toNum(order.average_fee_paid)
  const costDollars = Number.isFinite(perContract) ? filled * perContract : null
  const feeDollars = Number.isFinite(feePerContract) ? filled * feePerContract : null

  return NextResponse.json(
    {
      filled_count: filled,
      requested_count: count,
      avg_price_cents: Number.isFinite(perContract) ? Math.round(perContract * 100) : null,
      cost_dollars: costDollars,
      fee_dollars: feeDollars,
      cap_cents: capCents,
      side,
      order_id: order.order_id ?? null,
      ticker,
      market_title: marketInfo.title,
      yes_sub_title: marketInfo.yes_sub_title,
      no_sub_title: marketInfo.no_sub_title,
    },
    { status: 201 }
  )
}
