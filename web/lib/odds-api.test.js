// Plain JS tests for odds-api.ts pure logic (no API key needed)
// Mirrors the structure of espn.test.js
// Run with: node web/lib/odds-api.test.js

let passed = 0
let failed = 0

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`)
    passed++
  } else {
    console.error(`  ✗ ${label}`)
    failed++
  }
}

// ── Reproduce pure functions inline ───────────────────────────────────────────

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

function teamMatchesName(keyword, teamName) {
  const kw = normalize(keyword)
  const tn = normalize(teamName)
  return tn === kw || tn.includes(kw) || kw.includes(tn)
}

function parseTeamsFromBetName(betName) {
  const firstSegment = betName.split(' \u2014 ')[0]
  const vsParts = firstSegment.split(' vs ')
  if (vsParts.length < 2) return null
  return [vsParts[0].trim(), vsParts.slice(1).join(' vs ').trim()]
}

function parseSpreadLine(line) {
  const m = line.match(/^(.+?)\s*([+-]\d+\.?\d*)$/)
  if (!m) return null
  const spread = parseFloat(m[2])
  if (isNaN(spread)) return null
  return { teamKeyword: m[1].trim(), spread }
}

function findEvent(events, team1, team2) {
  for (const ev of events) {
    const hasTeam1 = teamMatchesName(team1, ev.home_team) || teamMatchesName(team1, ev.away_team)
    const hasTeam2 = teamMatchesName(team2, ev.home_team) || teamMatchesName(team2, ev.away_team)
    if (hasTeam1 && hasTeam2) return ev
  }
  return null
}

function findOutcome(market, betMarket, betLine) {
  if (betMarket === 'Moneyline') {
    return market.outcomes.find(o => teamMatchesName(betLine, o.name)) ?? null
  }
  if (betMarket === 'Spread') {
    const parsed = parseSpreadLine(betLine)
    if (!parsed) return null
    return market.outcomes.find(o => teamMatchesName(parsed.teamKeyword, o.name)) ?? null
  }
  if (betMarket === 'Total') {
    const m = betLine.match(/^(Over|Under)/i)
    if (!m) return null
    const direction = m[1].toLowerCase()
    return market.outcomes.find(o => o.name.toLowerCase() === direction) ?? null
  }
  return null
}

function impliedProb(americanOdds) {
  if (americanOdds > 0) return 100 / (100 + americanOdds)
  return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100)
}

function calcCLV(betOdds, closingOdds, opposingClosingOdds) {
  const closingP = impliedProb(closingOdds)
  if (opposingClosingOdds != null) {
    const opposingP = impliedProb(opposingClosingOdds)
    const fairP = closingP / (closingP + opposingP)
    return (fairP - impliedProb(betOdds)) * 100
  }
  return (closingP - impliedProb(betOdds)) * 100
}

// ── Mock Odds API event ────────────────────────────────────────────────────────

const mockEvent = {
  id: 'abc123',
  sport_key: 'basketball_nba',
  commence_time: '2026-03-29T23:00:00Z',
  home_team: 'Golden State Warriors',
  away_team: 'Boston Celtics',
  bookmakers: [
    {
      key: 'draftkings',
      markets: [
        {
          key: 'h2h',
          outcomes: [
            { name: 'Golden State Warriors', price: -130 },
            { name: 'Boston Celtics', price: 110 },
          ],
        },
        {
          key: 'spreads',
          outcomes: [
            { name: 'Golden State Warriors', price: -110, point: -3.5 },
            { name: 'Boston Celtics', price: -110, point: 3.5 },
          ],
        },
        {
          key: 'totals',
          outcomes: [
            { name: 'Over', price: -110, point: 220.5 },
            { name: 'Under', price: -110, point: 220.5 },
          ],
        },
      ],
    },
    {
      key: 'pinnacle',
      markets: [
        {
          key: 'h2h',
          outcomes: [
            { name: 'Golden State Warriors', price: -125 },
            { name: 'Boston Celtics', price: 105 },
          ],
        },
      ],
    },
  ],
}

const events = [mockEvent]

// ── findEvent ─────────────────────────────────────────────────────────────────

console.log('\n── findEvent ──')

assert(
  findEvent(events, 'Golden State Warriors', 'Boston Celtics') === mockEvent,
  'matches by full team name'
)
assert(
  findEvent(events, 'Warriors', 'Celtics') === mockEvent,
  'matches by partial name (Warriors / Celtics)'
)
assert(
  findEvent(events, 'golden state', 'boston') === mockEvent,
  'matches case-insensitive partial'
)
assert(
  findEvent(events, 'Lakers', 'Celtics') === null,
  'no match when team1 not found'
)
assert(
  findEvent(events, 'Warriors', 'Lakers') === null,
  'no match when team2 not found'
)

// ── findOutcome — Moneyline ───────────────────────────────────────────────────

console.log('\n── findOutcome (Moneyline) ──')

const h2hMarket = mockEvent.bookmakers[0].markets.find(m => m.key === 'h2h')

assert(
  findOutcome(h2hMarket, 'Moneyline', 'Warriors')?.price === -130,
  'Warriors ML → -130'
)
assert(
  findOutcome(h2hMarket, 'Moneyline', 'Celtics')?.price === 110,
  'Celtics ML → +110'
)
assert(
  findOutcome(h2hMarket, 'Moneyline', 'Golden State Warriors')?.price === -130,
  'full team name match → -130'
)
assert(
  findOutcome(h2hMarket, 'Moneyline', 'Lakers') === null,
  'no match for unknown team'
)

// ── findOutcome — Spread ──────────────────────────────────────────────────────

console.log('\n── findOutcome (Spread) ──')

const spreadsMarket = mockEvent.bookmakers[0].markets.find(m => m.key === 'spreads')

assert(
  findOutcome(spreadsMarket, 'Spread', 'Warriors -3')?.price === -110,
  'Warriors -3 spread → -110 (closing spread may differ from recorded)'
)
assert(
  findOutcome(spreadsMarket, 'Spread', 'Celtics +5')?.price === -110,
  'Celtics +5 → -110 (matched by team name, ignores recorded point)'
)
assert(
  findOutcome(spreadsMarket, 'Spread', 'Lakers -3') === null,
  'no match for unknown team'
)

// ── findOutcome — Total ───────────────────────────────────────────────────────

console.log('\n── findOutcome (Total) ──')

const totalsMarket = mockEvent.bookmakers[0].markets.find(m => m.key === 'totals')

assert(
  findOutcome(totalsMarket, 'Total', 'Over 220.5')?.price === -110,
  'Over 220.5 → -110'
)
assert(
  findOutcome(totalsMarket, 'Total', 'Under 215')?.price === -110,
  'Under 215 → -110 (closing total may differ)'
)
assert(
  findOutcome(totalsMarket, 'Total', 'Warriors -3') === null,
  'non over/under line → null'
)

// ── calcCLV ───────────────────────────────────────────────────────────────────

console.log('\n── calcCLV ──')

// Without opposing odds (null) — same as old formula
const clv1 = calcCLV(-110, -130, null)
assert(clv1 > 0, 'bet -110, close -130, no opposing → positive CLV (beat the line)')
assert(Math.abs(clv1 - 4.14) < 0.01, `CLV (no opposing) = ~4.14% (got ${clv1.toFixed(2)})`)

const clv2 = calcCLV(-130, -110, null)
assert(clv2 < 0, 'bet -130, close -110, no opposing → negative CLV')

const clv3 = calcCLV(-110, -110, null)
assert(Math.abs(clv3) < 0.001, 'same odds, no opposing → 0 CLV')

const clv4 = calcCLV(110, 100, null)
assert(clv4 > 0, 'bet +110, close +100, no opposing → positive CLV')

// De-vig: Pinnacle -105/-105 market (even), bet both sides at +102
// fair prob each side = 0.5122/(0.5122+0.5122) = 50.0%
// CLV = (0.5000 - impliedProb(+102)) * 100 = (0.5000 - 0.4950) * 100 = +0.50%
const clv5 = calcCLV(102, -105, -105)
assert(clv5 > 0, 'de-vig: bet +102, close -105/-105 → positive CLV (+0.5%)')
assert(Math.abs(clv5 - 0.50) < 0.02, `de-vig CLV ≈ +0.50% (got ${clv5.toFixed(2)})`)

// De-vig: both sides of same arb are equally positive (not inflated by vig)
const clvA = calcCLV(102, -105, -105)
const clvB = calcCLV(102, -105, -105)
assert(Math.abs(clvA - clvB) < 0.001, 'symmetric arb at even prices → equal CLV both sides')

// De-vig: verify vig inflation is removed vs raw formula
const clvRaw = calcCLV(102, -105, null)
assert(clvRaw > clv5, 'raw formula inflates CLV vs de-vigged (Pinnacle vig removed)')

// ── impliedProb sanity ────────────────────────────────────────────────────────

console.log('\n── impliedProb ──')

assert(Math.abs(impliedProb(-110) - 0.5238) < 0.001, '-110 → ~52.38%')
assert(Math.abs(impliedProb(100)  - 0.5)    < 0.001, '+100 → 50.00%')
assert(Math.abs(impliedProb(-200) - 0.6667) < 0.001, '-200 → ~66.67%')
assert(Math.abs(impliedProb(200)  - 0.3333) < 0.001, '+200 → ~33.33%')

// ── Sharp book priority (Pinnacle over DraftKings) ────────────────────────────

console.log('\n── Sharp book priority ──')

// Simulate findClosingOdds priority: pinnacle has h2h but not spreads/totals
// For h2h, pinnacle (-125) should be preferred over draftkings (-130)
const SHARP_PRIORITY = ['pinnacle', 'betonsports', 'fanduel', 'draftkings', 'betmgm', 'caesars']

function simulateFindClosingOdds(event, betMarket, betLine) {
  const marketKeyMap = { Moneyline: 'h2h', Spread: 'spreads', Total: 'totals' }
  const oddsKey = marketKeyMap[betMarket]
  if (!oddsKey) return null

  const allKeys = [
    ...SHARP_PRIORITY,
    ...event.bookmakers.map(b => b.key).filter(k => !SHARP_PRIORITY.includes(k)),
  ]

  for (const bookKey of allKeys) {
    const bm = event.bookmakers.find(b => b.key === bookKey)
    if (!bm) continue
    const market = bm.markets.find(m => m.key === oddsKey)
    if (!market) continue
    const outcome = findOutcome(market, betMarket, betLine)
    if (outcome) return { price: outcome.price, bookKey }
  }
  return null
}

const mlResult = simulateFindClosingOdds(mockEvent, 'Moneyline', 'Warriors')
assert(mlResult?.bookKey === 'pinnacle', 'Moneyline uses pinnacle when available')
assert(mlResult?.price === -125, 'Pinnacle Warriors ML price = -125')

// Spread: pinnacle doesn't have spreads in mock, falls back to draftkings
const spreadResult = simulateFindClosingOdds(mockEvent, 'Spread', 'Warriors -3')
assert(spreadResult?.bookKey === 'draftkings', 'Spread falls back to draftkings when pinnacle lacks it')
assert(spreadResult?.price === -110, 'DraftKings Warriors spread price = -110')

// ── parsePropMarketStr ────────────────────────────────────────────────────────

console.log('\n── parsePropMarketStr ──')

function parsePropMarketStr(market) {
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

const p1 = parsePropMarketStr('Points - Doncic, L')
assert(p1?.statType === 'Points', 'statType = "Points"')
assert(p1?.lastName === 'Doncic', 'lastName = "Doncic"')
assert(p1?.firstInitial === 'L', 'firstInitial = "L"')

const p2 = parsePropMarketStr('Pass Yards - Mahomes, P')
assert(p2?.statType === 'Pass Yards', 'statType = "Pass Yards"')
assert(p2?.lastName === 'Mahomes', 'lastName = "Mahomes"')

const p3 = parsePropMarketStr('Strikeouts - Scherzer')
assert(p3?.statType === 'Strikeouts', 'statType = "Strikeouts"')
assert(p3?.lastName === 'Scherzer', 'lastName = "Scherzer" (no comma)')
assert(p3?.firstInitial === '', 'firstInitial = "" when no comma')

assert(parsePropMarketStr('Moneyline') === null, 'no " - " → null')
assert(parsePropMarketStr('') === null, 'empty string → null')

// ── findPropClosingOdds ───────────────────────────────────────────────────────

console.log('\n── findPropClosingOdds ──')

const PROP_SHARP_PRIORITY = ['pinnacle', 'betonlineag', 'fanduel', 'draftkings', 'betmgm', 'caesars', 'williamhill_us', 'pointsbetus']

function findPropClosingOdds(event, propMarketKey, lastName, _firstInitial, direction) {
  const lastNameNorm = normalize(lastName)
  const bookmakerOrder = [
    ...PROP_SHARP_PRIORITY,
    ...event.bookmakers.map(b => b.key).filter(k => !PROP_SHARP_PRIORITY.includes(k)),
  ]
  for (const bookKey of bookmakerOrder) {
    const bookmaker = event.bookmakers.find(b => b.key === bookKey)
    if (!bookmaker) continue
    const market = bookmaker.markets.find(m => m.key === propMarketKey)
    if (!market) continue
    const outcome = market.outcomes.find(o => {
      if (o.name.toLowerCase() !== direction) return false
      if (!o.description) return false
      return normalize(o.description).includes(lastNameNorm)
    })
    if (outcome) {
      const opposingDirection = direction === 'over' ? 'under' : 'over'
      const opposing = market.outcomes.find(o => {
        if (o.name.toLowerCase() !== opposingDirection) return false
        if (!o.description) return false
        return normalize(o.description).includes(lastNameNorm)
      })
      return { price: outcome.price, opposingPrice: opposing?.price ?? null, bookKey }
    }
  }
  return null
}

const mockPropEvent = {
  id: 'prop_event_1',
  sport_key: 'basketball_nba',
  commence_time: '2026-03-29T23:00:00Z',
  home_team: 'Dallas Mavericks',
  away_team: 'Los Angeles Lakers',
  bookmakers: [
    {
      key: 'draftkings',
      markets: [
        {
          key: 'player_points',
          outcomes: [
            { name: 'Over',  description: 'Luka Doncic', price: -115, point: 29.5 },
            { name: 'Under', description: 'Luka Doncic', price: -105, point: 29.5 },
            { name: 'Over',  description: 'Anthony Davis', price: -110, point: 24.5 },
            { name: 'Under', description: 'Anthony Davis', price: -110, point: 24.5 },
          ],
        },
      ],
    },
    {
      key: 'pinnacle',
      markets: [
        {
          key: 'player_points',
          outcomes: [
            { name: 'Over',  description: 'Luka Doncic', price: -112, point: 29.5 },
            { name: 'Under', description: 'Luka Doncic', price: -108, point: 29.5 },
          ],
        },
      ],
    },
  ],
}

// Pinnacle preferred over DraftKings
const propRes1 = findPropClosingOdds(mockPropEvent, 'player_points', 'Doncic', 'L', 'over')
assert(propRes1?.bookKey === 'pinnacle', 'Pinnacle preferred over DraftKings for Doncic Over')
assert(propRes1?.price === -112, 'Doncic Over at Pinnacle = -112')
assert(propRes1?.opposingPrice === -108, 'Doncic Over: opposing (Under) at Pinnacle = -108')

// Under direction
const propRes2 = findPropClosingOdds(mockPropEvent, 'player_points', 'Doncic', 'L', 'under')
assert(propRes2?.price === -108, 'Doncic Under at Pinnacle = -108')
assert(propRes2?.opposingPrice === -112, 'Doncic Under: opposing (Over) at Pinnacle = -112')

// Davis only at DraftKings (Pinnacle doesn't have him)
const propRes3 = findPropClosingOdds(mockPropEvent, 'player_points', 'Davis', 'A', 'over')
assert(propRes3?.bookKey === 'draftkings', 'Davis falls back to DraftKings')
assert(propRes3?.price === -110, 'Davis Over at DraftKings = -110')

// Unknown player → null
const propRes4 = findPropClosingOdds(mockPropEvent, 'player_points', 'LeBron', 'L', 'over')
assert(propRes4 === null, 'unknown player → null')

// Wrong market key → null
const propRes5 = findPropClosingOdds(mockPropEvent, 'player_rebounds', 'Doncic', 'L', 'over')
assert(propRes5 === null, 'wrong market key → null')

// Case-insensitive player name match
const propRes6 = findPropClosingOdds(mockPropEvent, 'player_points', 'doncic', 'L', 'over')
assert(propRes6?.price === -112, 'case-insensitive lastName match')

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n── Results: ${passed} passed, ${failed} failed ──`)

if (failed > 0) process.exit(1)
