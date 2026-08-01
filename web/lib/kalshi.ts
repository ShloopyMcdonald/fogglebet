// Kalshi trade API client (demo by default). Follows the odds-api.ts pattern:
// plain module, fetch, throw on !ok with response text — callers catch.
//
// Auth: every request is signed (harmless on public endpoints):
//   KALSHI-ACCESS-KEY:       API key id
//   KALSHI-ACCESS-TIMESTAMP: unix ms
//   KALSHI-ACCESS-SIGNATURE: base64(RSA-PSS-SHA256(timestamp + METHOD + path))
// where path includes the /trade-api/v2 prefix and excludes the query string.

import crypto from 'crypto'
import type { KalshiMarketInfo, KalshiOrderbookFp } from './kalshi-math'

const DEFAULT_BASE = 'https://external-api.demo.kalshi.co/trade-api/v2'

function apiBase(): string {
  return (process.env.KALSHI_API_BASE ?? DEFAULT_BASE).replace(/\/$/, '')
}

let cachedKey: crypto.KeyObject | null = null

function privateKey(): crypto.KeyObject {
  if (cachedKey) return cachedKey
  const raw = process.env.KALSHI_PRIVATE_KEY
  if (!raw) throw new Error('[kalshi] KALSHI_PRIVATE_KEY is not set')
  // Vercel env vars may store the PEM with literal \n and/or wrapping quotes
  const pem = raw.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n')
  try {
    cachedKey = crypto.createPrivateKey(pem)
  } catch (err) {
    throw new Error(`[kalshi] KALSHI_PRIVATE_KEY is not a valid PEM private key: ${err}`)
  }
  return cachedKey
}

function signedHeaders(method: string, pathWithQuery: string): Record<string, string> {
  const keyId = process.env.KALSHI_API_KEY_ID
  if (!keyId) throw new Error('[kalshi] KALSHI_API_KEY_ID is not set')

  // Signed path: /trade-api/v2 prefix + path, query string excluded
  const basePath = new URL(apiBase()).pathname // e.g. /trade-api/v2
  const path = basePath + pathWithQuery.split('?')[0]

  const timestamp = String(Date.now())
  const signature = crypto
    .sign('sha256', Buffer.from(timestamp + method + path), {
      key: privateKey(),
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    })
    .toString('base64')

  return {
    'KALSHI-ACCESS-KEY': keyId,
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
    'KALSHI-ACCESS-SIGNATURE': signature,
    'Content-Type': 'application/json',
  }
}

async function request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(apiBase() + path, {
    method,
    headers: signedHeaders(method, path),
    body: body != null ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`[kalshi] ${method} ${path} failed ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

export async function getBalance(): Promise<{ balance: number }> {
  return request('GET', '/portfolio/balance')
}

export async function getMarket(ticker: string): Promise<KalshiMarketInfo & Record<string, unknown>> {
  const data = await request<{ market: KalshiMarketInfo & Record<string, unknown> }>(
    'GET',
    `/markets/${encodeURIComponent(ticker)}`
  )
  return data.market
}

export async function getOrderbook(ticker: string): Promise<KalshiOrderbookFp> {
  const data = await request<{ orderbook_fp?: KalshiOrderbookFp; orderbook?: KalshiOrderbookFp }>(
    'GET',
    `/markets/${encodeURIComponent(ticker)}/orderbook`
  )
  return data.orderbook_fp ?? data.orderbook ?? {}
}

export interface KalshiOrderResult {
  order_id?: string
  client_order_id?: string
  fill_count?: string | number
  remaining_count?: string | number
  average_fill_price?: string | number
  average_fee_paid?: string | number
  ts_ms?: number
  [k: string]: unknown
}

// Taker-only price-capped order: limit + immediate_or_cancel. `side` is the
// V2 order side: 'bid' buys YES, 'ask' sells YES (= opens a NO position).
// `priceDollars`/`count` must be fixed-point strings ("0.45", "12.00") —
// never raw floats.
export async function createOrder(params: {
  ticker: string
  side: 'bid' | 'ask'
  priceDollars: string
  count: string
}): Promise<KalshiOrderResult> {
  const body = {
    ticker: params.ticker,
    side: params.side,
    price: params.priceDollars,
    count: params.count,
    time_in_force: 'immediate_or_cancel',
    self_trade_prevention_type: 'taker_at_cross',
    client_order_id: crypto.randomUUID(),
  }
  console.log('[kalshi] createOrder:', JSON.stringify(body))
  const data = await request<KalshiOrderResult | { order: KalshiOrderResult }>(
    'POST',
    '/portfolio/events/orders',
    body
  )
  const order = (data as { order?: KalshiOrderResult }).order ?? (data as KalshiOrderResult)
  console.log('[kalshi] createOrder result:', JSON.stringify(order))
  return order
}

export async function getPositions(ticker?: string): Promise<unknown> {
  const q = ticker ? `?ticker=${encodeURIComponent(ticker)}` : ''
  return request('GET', `/portfolio/positions${q}`)
}
