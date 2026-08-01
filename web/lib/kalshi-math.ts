// Pure math + matching for Kalshi paper trading. No env, no fetch — unit-testable.

// ── Types ─────────────────────────────────────────────────────────────────────

export interface KalshiMarketInfo {
  ticker: string
  title?: string | null
  yes_sub_title?: string | null
  no_sub_title?: string | null
  status?: string | null
}

// orderbook_fp arrays: [price_dollars_string, count_fp_string], e.g. ["0.15", "100.00"].
// Kalshi returns BIDS only: yes_dollars = bids for YES, no_dollars = bids for NO.
export interface KalshiOrderbookFp {
  yes_dollars?: [string, string][] | null
  no_dollars?: [string, string][] | null
}

export type KalshiSide = 'yes' | 'no'

// ── Odds / price math ─────────────────────────────────────────────────────────

// Kalshi taker fee ≈ ceil_to_cent(0.07 × contracts × P × (1−P)) per order.
// A few series use different multipliers; 0.07 is the general-markets rate.
export const KALSHI_FEE_RATE = 0.07

export function americanToImpliedProb(odds: number): number {
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100)
}

// American-odds net decimal (b in Kelly): +150 → 1.5, -200 → 0.5
export function americanNetDecimal(odds: number): number {
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds)
}

// Per-contract cost of buying at p cents, INCLUDING the taker fee, expressed
// as a probability-scale number (0..1). This is the true break-even
// probability of the position.
export function effectiveCostAtCents(p: number): number {
  const price = p / 100
  return price + KALSHI_FEE_RATE * price * (1 - price)
}

// Probability → American odds (rounded).
export function probToAmerican(prob: number): number {
  if (prob >= 0.5) return -Math.round((100 * prob) / (1 - prob))
  return Math.round((100 * (1 - prob)) / prob)
}

// Highest cent price we may pay per contract such that price + taker fee does
// not exceed the PTO-implied probability (PTO odds already include fees).
// Returns 0 when no price is acceptable.
export function maxAcceptablePriceCents(odds: number): number {
  const target = americanToImpliedProb(odds) + 1e-9
  let best = 0
  for (let p = 1; p <= 99; p++) {
    if (effectiveCostAtCents(p) <= target) best = p
  }
  return best
}

// Cheapest price (cents) at which `side` can actually be bought right now —
// the best executable level, crossing the opposite side's bids. NaN when the
// book is empty.
export function bestAvailablePriceCents(
  orderbook: KalshiOrderbookFp | null | undefined,
  side: KalshiSide
): number {
  const oppositeBids = (side === 'yes' ? orderbook?.no_dollars : orderbook?.yes_dollars) ?? []
  let best = NaN
  for (const level of oppositeBids) {
    if (!Array.isArray(level) || level.length < 2) continue
    const opp = parseFloat(level[0])
    const count = parseFloat(level[1])
    if (isNaN(opp) || isNaN(count) || count <= 0) continue
    const ourCents = 100 - Math.round(opp * 100)
    if (ourCents >= 1 && ourCents <= 99 && (isNaN(best) || ourCents < best)) best = ourCents
  }
  return best
}

// Stopper: the odds actually executable on Kalshi (best price + fees, as
// American odds) must agree with what PTO displayed. A material disagreement
// in EITHER direction means the row is stale or the linked market is wrong —
// don't place. Tolerance is in probability points; one cent of price moves
// the effective probability ~1pt, so 3pts ≈ "the same odds, allowing for
// cent granularity and PTO refresh lag".
export const ODDS_AGREEMENT_TOLERANCE = 0.03

export function checkOddsAgreement(
  ptoOdds: number,
  bestPriceCents: number
): { ok: boolean; kalshi_odds: number; kalshi_prob: number; pto_prob: number } {
  const kalshiProb = effectiveCostAtCents(bestPriceCents)
  const ptoProb = americanToImpliedProb(ptoOdds)
  return {
    ok: Math.abs(kalshiProb - ptoProb) <= ODDS_AGREEMENT_TOLERANCE,
    kalshi_odds: probToAmerican(kalshiProb),
    kalshi_prob: kalshiProb,
    pto_prob: ptoProb,
  }
}

// ── Orderbook liquidity ───────────────────────────────────────────────────────

function parseCents(dollars: string): number {
  const n = parseFloat(dollars)
  return isNaN(n) ? NaN : Math.round(n * 100)
}

// Contracts available to BUY `side` at ≤ capCents per contract.
// You cross against the OPPOSITE side's bids: a bid for NO at price q is an ask
// for YES at (100 − q), and vice versa.
export function availableAtCap(
  orderbook: KalshiOrderbookFp | null | undefined,
  side: KalshiSide,
  capCents: number
): number {
  const oppositeBids = (side === 'yes' ? orderbook?.no_dollars : orderbook?.yes_dollars) ?? []
  let total = 0
  for (const level of oppositeBids) {
    if (!Array.isArray(level) || level.length < 2) continue
    const oppCents = parseCents(level[0])
    const count = parseFloat(level[1])
    if (isNaN(oppCents) || isNaN(count)) continue
    const ourCents = 100 - oppCents
    if (ourCents <= capCents) total += count
  }
  return Math.floor(total)
}

// ── Kelly sizing ──────────────────────────────────────────────────────────────

// Mirrors the extension's kellyStake: stake$ = bankroll × edge × fraction / b.
// Contracts = floor(stake$ / (capCents/100)) — conservative: sizes at the cap
// price; actual fills at better prices just cost less.
export function kellyContracts(
  bankroll: number,
  edge: number,
  kellyFraction: number,
  odds: number,
  capCents: number
): number {
  if (capCents <= 0) return 0
  const b = americanNetDecimal(odds)
  const stake = (bankroll * edge * kellyFraction) / b
  return Math.floor((stake * 100) / capCents)
}

// ── Side matching (ported from odds-api.ts) ───────────────────────────────────

// NFD decomposition converts accented chars (ć→c+◌́) then strips combining marks.
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

function nameMatches(keyword: string, candidate: string): boolean {
  const kw = normalize(keyword)
  const cn = normalize(candidate)
  if (!kw || !cn) return false
  if (cn === kw || cn.includes(kw) || kw.includes(cn)) return true
  // Word-level fallback: PTO renders tennis names as "Fetecau I" while Kalshi
  // sub-titles are "Irina Fetecau".
  const kwWords = kw.split(' ').filter(w => w.length > 2)
  const cnWords = cn.split(' ').filter(w => w.length > 2)
  return kwWords.some(w => cn.includes(w)) || cnWords.some(w => kw.includes(w))
}

// Verify the linked market is about the side we're taking.
//
// Kalshi structures two-sided matchups as TWO markets — one per entity, each
// with that entity as YES (ticker suffix names it; yes_sub_title and
// no_sub_title are both just the subject, e.g. both "San Diego"). A PTO Kalshi
// leg therefore always means BUY YES on its linked market. Verification =
// the market's subject matches the PTO side label; when PTO links the wrong
// market (e.g. the opponent's), the subject won't match → block, never guess.
export function matchSide(sideLabel: string, market: KalshiMarketInfo): KalshiSide | null {
  const subject = market.yes_sub_title || market.title || ''
  return nameMatches(sideLabel, subject) ? 'yes' : null
}
