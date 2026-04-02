import { Bet } from './supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OddsApiOdds {
  hdp?: number
  home?: string    // decimal odds as string, e.g. "1.91" or "N/A"
  away?: string
  draw?: string
  over?: string
  under?: string
  label?: string   // player + stat type, e.g. "Paolo Banchero (Points)"
}

export interface OddsApiMarket {
  name: string     // "ML", "Spread", "Totals", "Player Props"
  updatedAt: string
  odds: OddsApiOdds[]
}

// bookmakers is a dict keyed by bookmaker name, NOT an array
export interface OddsApiOddsResponse {
  id: number
  home: string
  away: string
  date: string
  status: string
  sport: { name: string; slug: string }
  league: { name: string; slug: string }
  bookmakers: Record<string, OddsApiMarket[]>
}

export interface OddsApiEvent {
  id: number
  home: string
  away: string
  date: string
  status: string
  sport: { name: string; slug: string }
  league: { name: string; slug: string }
}

export interface ClosingOddsResult {
  price: number
  opposingPrice: number | null
  bookKey: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ODDS_API_IO_BASE = 'https://api.odds-api.io/v3'

// picktheodds sport name → odds-api.io sport slug
export const ODDS_API_SPORT_SLUGS: Record<string, string> = {
  NBA:                     'basketball',
  NCAAB:                   'basketball',
  WNBA:                    'basketball',
  NFL:                     'american-football',
  NCAAF:                   'american-football',
  MLB:                     'baseball',
  NHL:                     'ice-hockey',
  // Tennis
  ATP:                     'tennis',
  WTA:                     'tennis',
  TENNIS:                  'tennis',
  // MMA / Combat
  MMA:                     'mixed-martial-arts',
  UFC:                     'mixed-martial-arts',
  BOXING:                  'boxing',
  // Golf
  PGA:                     'golf',
  GOLF:                    'golf',
  // Soccer
  MLS:                     'football',
  EPL:                     'football',
  'PREMIER LEAGUE':        'football',
  LALIGA:                  'football',
  'LA LIGA':               'football',
  BUNDESLIGA:              'football',
  'SERIE A':               'football',
  'LIGUE 1':               'football',
  UCL:                     'football',
  'CHAMPIONS LEAGUE':      'football',
  'UEFA CHAMPIONS LEAGUE': 'football',
  UEL:                     'football',
  'EUROPA LEAGUE':         'football',
}

// Priority order for featured markets (ML / Spread / Totals).
// Circa is the sharpest available, then BetOnline.ag, then FanDuel as fallback.
export const SHARP_BOOK_PRIORITY = ['Circa', 'BetOnline.ag', 'FanDuel']

// Player prop closing odds are always sourced from FanDuel (best prop coverage).
const PROP_BOOK = 'FanDuel'

// picktheodds stat type → string that appears in the odds-api.io label parentheses,
// e.g. "Points - Doncic, L" → statType "Points" → label contains "(Points)".
// Verify these against live /odds responses if new stat types appear.
export const PROP_STAT_LABEL_MAP: Record<string, string> = {
  // Basketball — singles
  Points:            'Points',
  Rebounds:          'Rebounds',
  Assists:           'Assists',
  Blocks:            'Blocks',
  Steals:            'Steals',
  Turnovers:         'Turnovers',
  '3-Pointers Made': '3 Point FG',
  '3PT':             '3 Point FG',
  // Basketball — combos (picktheodds format: "Pts + Ast + Reb")
  'Pts + Ast + Reb':  'Pts+Rebs+Asts',
  'Pts + Ast':        'Pts+Asts',
  'Pts + Reb':        'Pts+Rebs',
  'Reb + Ast':        'Rebs+Asts',
  // Football
  'Pass Yards':      'Passing Yards',
  'Pass TDs':        'Passing Touchdowns',
  Interceptions:     'Passing Interceptions',
  'Rush Yards':      'Rushing Yards',
  'Rushing TDs':     'Rushing Touchdowns',
  'Receiving Yards': 'Receiving Yards',
  Receptions:        'Receptions',
  'Receiving TDs':   'Receiving Touchdowns',
  // Baseball
  Strikeouts:        'Strikeouts',
  Hits:              'Hits',
  'Home Runs':       'Home Runs',
  RBIs:              'RBIs',
  'Total Bases':     'Total Bases',
  Runs:              'Runs Scored',
  // Baseball — pitcher props
  // Label names verified against FanDuel via odds-api.io; update if live responses differ.
  'Pitcher Strikeouts':   'Pitcher Strikeouts',
  'Pitcher Allowed Hits': 'Hits Allowed',
  'Pitcher Earned Runs':  'Earned Runs',
  'Pitcher Walks':        'Walks',
  'Pitcher Earned Outs':  'Outs Recorded',
  'Pitcher Home Runs':    'Home Runs Allowed',
  // Hockey
  Goals:             'Goals',
  Shots:             'Shots on Goal',
  'Shots on Goal':   'Shots on Goal',   // picktheodds may use either "Shots" or "Shots on Goal"
  'Blocked Shots':   'Blocked Shots',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

function teamMatchesName(keyword: string, teamName: string): boolean {
  const kw = normalize(keyword)
  const tn = normalize(teamName)
  return tn === kw || tn.includes(kw) || kw.includes(tn)
}

// Parse odds string (e.g. "1.91") → number, returns null for "N/A" or invalid.
function parseDecimalOdds(val: string | undefined): number | null {
  if (!val || val === 'N/A') return null
  const n = parseFloat(val)
  return isNaN(n) ? null : n
}

// Decimal odds → American odds
function decimalToAmerican(decimal: number): number {
  if (decimal >= 2.0) return Math.round((decimal - 1) * 100)
  return Math.round(-100 / (decimal - 1))
}

// Parse "Warriors -3" → { teamKeyword: "Warriors", spread: -3 }
function parseSpreadLine(line: string): { teamKeyword: string; spread: number } | null {
  const m = line.match(/^(.+?)\s*([+-]\d+\.?\d*)$/)
  if (!m) return null
  const spread = parseFloat(m[2])
  if (isNaN(spread)) return null
  return { teamKeyword: m[1].trim(), spread }
}

// ── API Fetching ──────────────────────────────────────────────────────────────

// Returns events for a sport within a time window. Used to resolve team names → event IDs.
export async function fetchEvents(
  sportSlug: string,
  from: string,
  to: string,
  apiKey: string
): Promise<OddsApiEvent[]> {
  const params = new URLSearchParams({
    apiKey,
    sport: sportSlug,
    from,
    to,
    status: 'pending,live',
    limit: '100',
  })
  const res = await fetch(`${ODDS_API_IO_BASE}/events?${params}`, { cache: 'no-store' })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`[odds-api] fetchEvents ${sportSlug} failed ${res.status}: ${text}`)
  }
  return res.json() as Promise<OddsApiEvent[]>
}

// Returns full odds (all markets) for a single event from the specified bookmakers.
export async function fetchEventOddsById(
  eventId: number,
  bookmakers: string[],
  apiKey: string
): Promise<OddsApiOddsResponse> {
  const params = new URLSearchParams({
    apiKey,
    eventId: String(eventId),
    bookmakers: bookmakers.join(','),
  })
  const res = await fetch(`${ODDS_API_IO_BASE}/odds?${params}`, { cache: 'no-store' })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`[odds-api] fetchEventOddsById ${eventId} failed ${res.status}: ${text}`)
  }
  return res.json() as Promise<OddsApiOddsResponse>
}

// ── Event Matching ────────────────────────────────────────────────────────────

export function findEvent(events: OddsApiEvent[], team1: string, team2: string): OddsApiEvent | null {
  for (const ev of events) {
    const hasTeam1 = teamMatchesName(team1, ev.home) || teamMatchesName(team1, ev.away)
    const hasTeam2 = teamMatchesName(team2, ev.home) || teamMatchesName(team2, ev.away)
    if (hasTeam1 && hasTeam2) return ev
  }
  return null
}

// ── Outcome Extraction ────────────────────────────────────────────────────────

function extractMoneylineOdds(
  event: OddsApiOddsResponse,
  odds: OddsApiOdds,
  betLine: string
): { price: number; opposingPrice: number | null } | null {
  if (betLine.toLowerCase() === 'draw') {
    const p = parseDecimalOdds(odds.draw)
    if (p == null) return null
    return { price: decimalToAmerican(p), opposingPrice: null }
  }
  const isHome = teamMatchesName(betLine, event.home)
  const isAway = teamMatchesName(betLine, event.away)
  const ourVal = isHome ? odds.home : isAway ? odds.away : null
  const oppVal = isHome ? odds.away : isAway ? odds.home : null
  const ourP = parseDecimalOdds(ourVal ?? undefined)
  if (ourP == null) return null
  const oppP = parseDecimalOdds(oppVal ?? undefined)
  return { price: decimalToAmerican(ourP), opposingPrice: oppP != null ? decimalToAmerican(oppP) : null }
}

function extractSpreadOdds(
  event: OddsApiOddsResponse,
  oddsArr: OddsApiOdds[],
  betLine: string
): { price: number; opposingPrice: number | null } | null {
  const parsed = parseSpreadLine(betLine)
  if (!parsed) return null

  const betIsHome = teamMatchesName(parsed.teamKeyword, event.home)
  const betIsAway = teamMatchesName(parsed.teamKeyword, event.away)
  if (!betIsHome && !betIsAway) return null

  // hdp = home team's handicap (e.g. -2 means home is -2 favorite).
  // If bet is on home at -2: targetHdp = -2, price = entry.home.
  // If bet is on away at +2: home's hdp = -2, targetHdp = -parsed.spread = -2, price = entry.away.
  const targetHdp = betIsHome ? parsed.spread : -parsed.spread
  const entry = oddsArr.find(o => o.hdp != null && Math.abs(o.hdp - targetHdp) < 0.1)
  if (!entry) return null

  const ourP = parseDecimalOdds(betIsHome ? entry.home : entry.away)
  const oppP = parseDecimalOdds(betIsHome ? entry.away : entry.home)
  if (ourP == null) return null
  return { price: decimalToAmerican(ourP), opposingPrice: oppP != null ? decimalToAmerican(oppP) : null }
}

function extractTotalOdds(
  oddsArr: OddsApiOdds[],
  betLine: string
): { price: number; opposingPrice: number | null } | null {
  const m = betLine.match(/^(Over|Under)\s+([\d.]+)/i)
  if (!m) return null
  const direction = m[1].toLowerCase()
  const totalValue = parseFloat(m[2])

  const entry = oddsArr.find(o => o.hdp != null && Math.abs(o.hdp - totalValue) < 0.1)
  if (!entry) return null

  const ourP = parseDecimalOdds(direction === 'over' ? entry.over : entry.under)
  const oppP = parseDecimalOdds(direction === 'over' ? entry.under : entry.over)
  if (ourP == null) return null
  return { price: decimalToAmerican(ourP), opposingPrice: oppP != null ? decimalToAmerican(oppP) : null }
}

// Props label format: "Paolo Banchero (Points)" — match by lastName + stat type in parens.
function extractPropOdds(
  oddsArr: OddsApiOdds[],
  lastName: string,
  statLabelStr: string,  // e.g. "Points" (the parentheses content to match)
  betLine: string
): { price: number; opposingPrice: number | null } | null {
  const m = betLine.match(/^(Over|Under)\s+([\d.]+)/i)
  if (!m) return null
  const direction = m[1].toLowerCase()
  const lineValue = parseFloat(m[2])
  const lastNameNorm = normalize(lastName)
  const statNorm = normalize(statLabelStr)

  const entry = oddsArr.find(o => {
    if (!o.label) return false
    if (o.hdp == null || Math.abs(o.hdp - lineValue) >= 0.1) return false
    const labelNorm = normalize(o.label)
    // Label format: "firstname lastname (stat type)" — check lastName and stat type
    const parenMatch = o.label.match(/\(([^)]+)\)$/)
    if (!parenMatch) return false
    const labelStat = normalize(parenMatch[1])
    return labelNorm.includes(lastNameNorm) && labelStat === statNorm
  })
  if (!entry) return null

  const ourP = parseDecimalOdds(direction === 'over' ? entry.over : entry.under)
  const oppP = parseDecimalOdds(direction === 'over' ? entry.under : entry.over)
  // Require both sides — one-sided prop odds can't be de-vigged.
  if (ourP == null || oppP == null) return null
  return { price: decimalToAmerican(ourP), opposingPrice: decimalToAmerican(oppP) }
}

// ── Player Prop Market Parsing ────────────────────────────────────────────────

// "Points - Doncic, L" → { statType: "Points", lastName: "Doncic", firstInitial: "L" }
export function parsePropMarketStr(
  market: string
): { statType: string; lastName: string; firstInitial: string } | null {
  const dashIdx = market.indexOf(' - ')
  if (dashIdx === -1) return null
  const statType = market.slice(0, dashIdx).trim()
  const playerPart = market.slice(dashIdx + 3).trim()
  const commaIdx = playerPart.indexOf(',')
  if (commaIdx === -1) {
    return { statType, lastName: playerPart, firstInitial: '' }
  }
  return {
    statType,
    lastName: playerPart.slice(0, commaIdx).trim(),
    firstInitial: playerPart.slice(commaIdx + 1).trim(),
  }
}

// ── Main: find closing odds for a bet ─────────────────────────────────────────

function isFeaturedMarket(market: string): boolean {
  // Player props always contain " - " (e.g. "Total Bases - Soto, J"); exclude them first.
  if (market.includes(' - ')) return false
  return market === 'Moneyline' || market === 'Spread' || market === 'Total' || market.startsWith('Total ')
}

function extractFeaturedOddsFromBookmaker(
  event: OddsApiOddsResponse,
  markets: OddsApiMarket[],
  bet: Bet
): { price: number; opposingPrice: number | null } | null {
  const market = bet.market!
  const line = bet.line!

  if (market === 'Moneyline') {
    const mkt = markets.find(m => m.name === 'ML')
    if (!mkt || mkt.odds.length === 0) return null
    return extractMoneylineOdds(event, mkt.odds[0], line)
  }

  if (market === 'Spread') {
    const mkt = markets.find(m => m.name === 'Spread')
    if (!mkt) return null
    return extractSpreadOdds(event, mkt.odds, line)
  }

  if (market === 'Total' || market.startsWith('Total ')) {
    const mkt = markets.find(m => m.name === 'Totals')
    if (!mkt) return null
    return extractTotalOdds(mkt.odds, line)
  }

  return null
}

export function findClosingOdds(
  oddsResp: OddsApiOddsResponse,
  bet: Bet
): ClosingOddsResult | null {
  if (!bet.market || !bet.line) {
    console.warn(`[odds-api] Bet ${bet.id} missing market or line`)
    return null
  }

  // ── Player props: always use FanDuel ────────────────────────────────────────
  if (!isFeaturedMarket(bet.market)) {
    const parsed = parsePropMarketStr(bet.market)
    if (!parsed) {
      console.warn(`[odds-api] Cannot parse prop market: "${bet.market}" (bet ${bet.id})`)
      return null
    }
    const statLabel = PROP_STAT_LABEL_MAP[parsed.statType]
    if (!statLabel) {
      console.warn(`[odds-api] Unsupported prop stat type: "${parsed.statType}" (bet ${bet.id})`)
      return null
    }
    const bmMarkets = oddsResp.bookmakers[PROP_BOOK]
    if (!bmMarkets) {
      console.warn(`[odds-api] ${PROP_BOOK} not in odds response for bet ${bet.id}`)
      return null
    }
    const propMkt = bmMarkets.find(m => m.name === 'Player Props')
    if (!propMkt) return null
    const result = extractPropOdds(propMkt.odds, parsed.lastName, statLabel, bet.line)
    if (!result) return null
    return { ...result, bookKey: PROP_BOOK }
  }

  // ── Featured markets: Circa → BetOnline.ag → FanDuel ────────────────────────
  // Require both sides (opposingPrice != null) so de-vig is accurate.
  // Draw moneylines are exempt — they're 3-way markets with no single opposing side.
  const isDraw = bet.line?.toLowerCase() === 'draw'
  const bookOrder = [
    ...SHARP_BOOK_PRIORITY,
    ...Object.keys(oddsResp.bookmakers).filter(n => !SHARP_BOOK_PRIORITY.includes(n)),
  ]

  for (const bookName of bookOrder) {
    const bmMarkets = oddsResp.bookmakers[bookName]
    if (!bmMarkets) continue

    const result = extractFeaturedOddsFromBookmaker(oddsResp, bmMarkets, bet)
    if (!result) continue
    if (result.opposingPrice == null && !isDraw) continue  // one-sided data — skip this book
    return { ...result, bookKey: bookName }
  }

  console.warn(
    `[odds-api] No closing odds found for bet ${bet.id} (${bet.market} / ${bet.line})`
  )
  return null
}

// ── CLV Calculation ───────────────────────────────────────────────────────────

function impliedProb(americanOdds: number): number {
  if (americanOdds > 0) return 100 / (100 + americanOdds)
  return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100)
}

// TKO (Theoretical Kelly Optimization) de-vig for two-way markets.
// Source: https://www.pinnacle.com/en/betting-articles/Betting-Strategy/why-the-favourite-longshot-bias-is-not-a-bias/
// Formula: b0 = log[p2/(1-p1)] / log[p1/(1-p2)], true_fav = b0/(1+b0)
// where p1 = favourite implied prob, p2 = longshot implied prob.
// Falls back to additive if the formula is degenerate (effectively zero vig).
function deVigTKO(pA: number, pB: number): number {
  const aIsFav = pA >= pB
  const p1 = aIsFav ? pA : pB  // favourite
  const p2 = aIsFav ? pB : pA  // longshot

  const num = Math.log(p2 / (1 - p1))
  const den = Math.log(p1 / (1 - p2))

  if (!isFinite(num) || !isFinite(den) || Math.abs(den) < 1e-10) {
    return pA / (pA + pB)  // additive fallback
  }

  const b0 = num / den
  const trueFav = b0 / (1 + b0)
  return aIsFav ? trueFav : 1 - trueFav
}

// Positive CLV = you beat the closing line (good).
// When opposingClosingOdds is provided, de-vigs the closing line (TKO method)
// so both sides of an arb don't both appear as positive CLV.
export function calcCLV(
  betOdds: number,
  closingOdds: number,
  opposingClosingOdds: number | null
): number {
  const closingP = impliedProb(closingOdds)
  if (opposingClosingOdds != null) {
    const opposingP = impliedProb(opposingClosingOdds)
    const fairP = deVigTKO(closingP, opposingP)
    return (fairP - impliedProb(betOdds)) * 100
  }
  return (closingP - impliedProb(betOdds)) * 100
}
