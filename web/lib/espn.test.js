// Plain JS tests for espn.ts core logic (no TypeScript runner needed)
// Reproduces all pure functions from espn.ts inline for verification.
// Run with: node web/lib/espn.test.js

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

// ── Reproduce core pure functions inline ─────────────────────────────────────

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

function teamMatches(espnTeam, keyword) {
  const kw = normalize(keyword)
  if (!kw) return false
  const dn = normalize(espnTeam.displayName)
  const sdn = normalize(espnTeam.shortDisplayName)
  const abbr = normalize(espnTeam.abbreviation)
  return (
    dn === kw || dn.includes(kw) || kw.includes(dn) ||
    sdn === kw || sdn.includes(kw) || kw.includes(sdn) ||
    abbr === kw
  )
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

function parseOverUnderLine(line) {
  const m = line.match(/^(Over|Under)\s+([\d.]+)$/i)
  if (!m) return null
  const threshold = parseFloat(m[2])
  if (isNaN(threshold)) return null
  return { direction: m[1].toLowerCase(), threshold }
}

function findCompetitor(competitors, keyword) {
  return competitors.find(c => teamMatches(c.team, keyword)) ?? null
}

function toEtDateStr(utcIso) {
  const d = new Date(new Date(utcIso).getTime() - 5 * 60 * 60 * 1000)
  const y = d.getUTCFullYear()
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}${mo}${day}`
}

function calcProfitLoss(result, odds, stake) {
  if (result === 'win') {
    return odds > 0 ? stake * (odds / 100) : stake * (100 / Math.abs(odds))
  }
  if (result === 'loss') return -stake
  return 0
}

// Simplified determineResult for testing spread/moneyline/total
function determineResultSimple(market, line, competitors, completed = true) {
  if (!completed) return null
  if (!line) return null

  if (market === 'Moneyline') {
    const betComp = findCompetitor(competitors, line)
    if (!betComp) return null
    const oppComp = competitors.find(c => c !== betComp)
    if (!oppComp) return null
    const bs = parseInt(betComp.score), os = parseInt(oppComp.score)
    if (bs > os) return 'win'
    if (bs < os) return 'loss'
    return 'push'
  }

  if (market === 'Spread') {
    const parsed = parseSpreadLine(line)
    if (!parsed) return null
    const betComp = findCompetitor(competitors, parsed.teamKeyword)
    if (!betComp) return null
    const oppComp = competitors.find(c => c !== betComp)
    if (!oppComp) return null
    const diff = parseInt(betComp.score) - parseInt(oppComp.score) + parsed.spread
    if (diff > 0) return 'win'
    if (diff < 0) return 'loss'
    return 'push'
  }

  if (market === 'Total') {
    const parsed = parseOverUnderLine(line)
    if (!parsed) return null
    const total = parseInt(competitors[0].score) + parseInt(competitors[1].score)
    if (parsed.direction === 'over') {
      if (total > parsed.threshold) return 'win'
      if (total < parsed.threshold) return 'loss'
      return 'push'
    } else {
      if (total < parsed.threshold) return 'win'
      if (total > parsed.threshold) return 'loss'
      return 'push'
    }
  }

  return null
}

// ── Test Data ─────────────────────────────────────────────────────────────────

const warriors = { displayName: 'Golden State Warriors', shortDisplayName: 'Warriors', abbreviation: 'GSW' }
const celtics  = { displayName: 'Boston Celtics', shortDisplayName: 'Celtics', abbreviation: 'BOS' }

// GSW 120, BOS 115
const competitors120_115 = [
  { homeAway: 'home', score: '120', team: warriors },
  { homeAway: 'away', score: '115', team: celtics },
]

// ── parseTeamsFromBetName ──────────────────────────────────────────────────────

console.log('\n── parseTeamsFromBetName ──')

const t1 = parseTeamsFromBetName('Golden State Warriors vs Boston Celtics \u2014 Spread \u2014 Warriors -3')
assert(t1 !== null, 'parses 3-part bet_name')
assert(t1?.[0] === 'Golden State Warriors', 'team1 = Golden State Warriors')
assert(t1?.[1] === 'Boston Celtics', 'team2 = Boston Celtics')

const t2 = parseTeamsFromBetName('Golden State Warriors vs Boston Celtics \u2014 Moneyline \u2014 Warriors')
assert(t2?.[0] === 'Golden State Warriors', 'moneyline: team1')
assert(t2?.[1] === 'Boston Celtics', 'moneyline: team2')

const t3 = parseTeamsFromBetName('Golden State Warriors vs Boston Celtics \u2014 Total \u2014 Over 220.5')
assert(t3?.[0] === 'Golden State Warriors', 'total: team1')

const t4 = parseTeamsFromBetName('single team name')
assert(t4 === null, 'returns null when no vs separator')

// ── parseSpreadLine ───────────────────────────────────────────────────────────

console.log('\n── parseSpreadLine ──')

const s1 = parseSpreadLine('Warriors -3')
assert(s1?.teamKeyword === 'Warriors', 'Warriors -3: teamKeyword')
assert(s1?.spread === -3, 'Warriors -3: spread = -3')

const s2 = parseSpreadLine('CHI+34.5')
assert(s2?.teamKeyword === 'CHI', 'CHI+34.5: teamKeyword = CHI')
assert(s2?.spread === 34.5, 'CHI+34.5: spread = +34.5')

const s3 = parseSpreadLine('Celtics +7')
assert(s3?.teamKeyword === 'Celtics', 'Celtics +7: teamKeyword')
assert(s3?.spread === 7, 'Celtics +7: spread = 7')

const s4 = parseSpreadLine('Over 200.5')
assert(s4 === null, 'Over 200.5 is not a spread line')

// ── parseOverUnderLine ────────────────────────────────────────────────────────

console.log('\n── parseOverUnderLine ──')

const o1 = parseOverUnderLine('Over 220.5')
assert(o1?.direction === 'over', 'Over 220.5: direction = over')
assert(o1?.threshold === 220.5, 'Over 220.5: threshold = 220.5')

const o2 = parseOverUnderLine('Under 180')
assert(o2?.direction === 'under', 'Under 180: direction = under')
assert(o2?.threshold === 180, 'Under 180: threshold = 180')

const o3 = parseOverUnderLine('Warriors -3')
assert(o3 === null, 'Warriors -3 is not an over/under line')

// ── teamMatches ───────────────────────────────────────────────────────────────

console.log('\n── teamMatches ──')

assert(teamMatches(warriors, 'Warriors'), 'Warriors matches shortDisplayName')
assert(teamMatches(warriors, 'Golden State Warriors'), 'Warriors matches displayName')
assert(teamMatches(warriors, 'GSW'), 'Warriors matches abbreviation')
assert(teamMatches(warriors, 'gsw'), 'Warriors matches abbr case-insensitive')
assert(!teamMatches(warriors, 'Celtics'), 'Warriors does not match Celtics')
assert(!teamMatches(warriors, 'BOS'), 'Warriors does not match BOS')

// ── Moneyline result ──────────────────────────────────────────────────────────

console.log('\n── Moneyline results ──')

// Warriors won 120-115, bet on Warriors
assert(
  determineResultSimple('Moneyline', 'Warriors', competitors120_115) === 'win',
  'Warriors ML: bet Warriors → win (120-115)'
)

// Bet on Celtics (losers)
assert(
  determineResultSimple('Moneyline', 'Celtics', competitors120_115) === 'loss',
  'Celtics ML: bet Celtics → loss (120-115)'
)

// Push: 100-100
const push100 = [
  { score: '100', team: warriors },
  { score: '100', team: celtics },
]
assert(
  determineResultSimple('Moneyline', 'Warriors', push100) === 'push',
  'ML push when scores equal'
)

// Game not final
assert(
  determineResultSimple('Moneyline', 'Warriors', competitors120_115, false) === null,
  'Returns null when game not completed'
)

// ── Spread results ────────────────────────────────────────────────────────────

console.log('\n── Spread results ──')

// Warriors win by 5 (120-115), bet Warriors -3 → diff = 5 + (-3) = 2 → WIN
assert(
  determineResultSimple('Spread', 'Warriors -3', competitors120_115) === 'win',
  'Warriors -3: win by 5 → covers -3'
)

// Warriors win by 5 (120-115), bet Warriors -7 → diff = 5 + (-7) = -2 → LOSS
assert(
  determineResultSimple('Spread', 'Warriors -7', competitors120_115) === 'loss',
  'Warriors -7: win by 5 → does not cover -7'
)

// Warriors win by 5 (120-115), bet Celtics +5 → diff = 115-120+5 = 0 → PUSH
const comp120_115Celtics = [
  { score: '120', team: warriors },
  { score: '115', team: celtics },
]
assert(
  determineResultSimple('Spread', 'Celtics +5', comp120_115Celtics) === 'push',
  'Celtics +5: lose by 5 → push on +5'
)

// Warriors win by 5, bet Celtics +3 → diff = 115-120+3 = -2 → LOSS
assert(
  determineResultSimple('Spread', 'Celtics +3', comp120_115Celtics) === 'loss',
  'Celtics +3: lose by 5 → does not cover +3'
)

// GSW abbreviation in line
const warriors_abbr = [
  { score: '110', team: warriors },
  { score: '105', team: celtics },
]
assert(
  determineResultSimple('Spread', 'GSW -4', warriors_abbr) === 'win',
  'GSW -4: win by 5 → covers -4'
)

// ── Total results ─────────────────────────────────────────────────────────────

console.log('\n── Total results ──')

// 120 + 115 = 235
const comp235 = [
  { score: '120', team: warriors },
  { score: '115', team: celtics },
]

assert(
  determineResultSimple('Total', 'Over 230', comp235) === 'win',
  'Over 230: total 235 → win'
)

assert(
  determineResultSimple('Total', 'Under 230', comp235) === 'loss',
  'Under 230: total 235 → loss'
)

assert(
  determineResultSimple('Total', 'Over 235', comp235) === 'push',
  'Over 235: total exactly 235 → push'
)

assert(
  determineResultSimple('Total', 'Under 240', comp235) === 'win',
  'Under 240: total 235 → win'
)

// ── calcProfitLoss ────────────────────────────────────────────────────────────

console.log('\n── calcProfitLoss ──')

assert(
  Math.abs(calcProfitLoss('win', 100, 1) - 1.0) < 0.001,
  '+100 win on $1 → $1.00 profit'
)
assert(
  Math.abs(calcProfitLoss('win', 200, 1) - 2.0) < 0.001,
  '+200 win on $1 → $2.00 profit'
)
assert(
  Math.abs(calcProfitLoss('win', -110, 1) - (100/110)) < 0.001,
  '-110 win on $1 → $0.909 profit'
)
assert(
  calcProfitLoss('loss', -110, 1) === -1,
  'loss on $1 → -$1.00'
)
assert(
  calcProfitLoss('push', -110, 1) === 0,
  'push → $0.00'
)

// ── toEtDateStr ───────────────────────────────────────────────────────────────

console.log('\n── toEtDateStr ──')

// 2026-03-28T20:00:00Z = 3pm ET → same day
assert(
  toEtDateStr('2026-03-28T20:00:00.000Z') === '20260328',
  '8pm UTC = 3pm ET → 20260328'
)

// 2026-03-29T03:00:00Z = 10pm ET on Mar 28 → 20260328
assert(
  toEtDateStr('2026-03-29T03:00:00.000Z') === '20260328',
  '3am UTC Mar 29 = 10pm ET Mar 28 → 20260328'
)

// 2026-03-28T10:00:00Z = 5am ET → same day
assert(
  toEtDateStr('2026-03-28T10:00:00.000Z') === '20260328',
  '10am UTC = 5am ET → 20260328'
)

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n── Results: ${passed} passed, ${failed} failed ──`)

if (failed > 0) {
  process.exit(1)
}
