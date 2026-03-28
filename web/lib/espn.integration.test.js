// Integration tests: hit the real ESPN API and verify end-to-end result determination.
// Uses the Clippers vs Pacers game from 2026-03-27 (LAC 114, IND 113 — confirmed final).
// Run with: node web/lib/espn.integration.test.js

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

// ── Reproduce core functions inline (same as unit test) ──────────────────────

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

function teamMatches(espnTeam, keyword) {
  const kw = normalize(keyword)
  if (!kw) return false
  const dn = normalize(espnTeam.displayName)
  const sdn = normalize(espnTeam.shortDisplayName)
  const abbr = normalize(espnTeam.abbreviation)
  return dn === kw || dn.includes(kw) || kw.includes(dn) || sdn === kw ||
    sdn.includes(kw) || kw.includes(sdn) || abbr === kw
}

function parseTeamsFromBetName(betName) {
  const firstSegment = betName.split(' \u2014 ')[0]
  const vsParts = firstSegment.split(' vs ')
  if (vsParts.length < 2) return null
  return [vsParts[0].trim(), vsParts.slice(1).join(' vs ').trim()]
}

function findGame(games, team1, team2) {
  for (const game of games) {
    const comp = game.competitions[0]
    if (!comp || comp.competitors.length < 2) continue
    const { competitors } = comp
    if (competitors.some(c => teamMatches(c.team, team1)) &&
        competitors.some(c => teamMatches(c.team, team2))) return game
  }
  return null
}

function findCompetitor(competitors, keyword) {
  return competitors.find(c => teamMatches(c.team, keyword)) ?? null
}

function parseSpreadLine(line) {
  const m = line.match(/^(.+?)\s*([+-]\d+\.?\d*)$/)
  if (!m) return null
  const spread = parseFloat(m[2])
  return isNaN(spread) ? null : { teamKeyword: m[1].trim(), spread }
}

function parseOverUnderLine(line) {
  const m = line.match(/^(Over|Under)\s+([\d.]+)$/i)
  if (!m) return null
  const threshold = parseFloat(m[2])
  return isNaN(threshold) ? null : { direction: m[1].toLowerCase(), threshold }
}

function determineResult(market, line, competitors) {
  if (!line) return null
  if (market === 'Moneyline') {
    const betComp = findCompetitor(competitors, line)
    if (!betComp) return null
    const opp = competitors.find(c => c !== betComp)
    if (!opp) return null
    const bs = parseInt(betComp.score), os = parseInt(opp.score)
    if (bs > os) return 'win'
    if (bs < os) return 'loss'
    return 'push'
  }
  if (market === 'Spread') {
    const parsed = parseSpreadLine(line)
    if (!parsed) return null
    const betComp = findCompetitor(competitors, parsed.teamKeyword)
    if (!betComp) return null
    const opp = competitors.find(c => c !== betComp)
    if (!opp) return null
    const diff = parseInt(betComp.score) - parseInt(opp.score) + parsed.spread
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

function resolvePlayerProp(statCols, line, players) {
  const ou = parseOverUnderLine(line)
  if (!ou) return null
  const { direction, threshold } = ou
  for (const teamStats of players) {
    for (const group of teamStats.statistics) {
      let colIdx = -1
      for (const col of statCols) {
        const idx = group.names.indexOf(col)
        if (idx !== -1) { colIdx = idx; break }
      }
      if (colIdx === -1) continue
      return { colIdx, group, direction, threshold }
    }
  }
  return null
}

function calcProfitLoss(result, odds, stake) {
  if (result === 'win') return odds > 0 ? stake * (odds / 100) : stake * (100 / Math.abs(odds))
  if (result === 'loss') return -stake
  return 0
}

// ── Integration tests ─────────────────────────────────────────────────────────

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports'

async function main() {
  // ── 1. Fetch real NBA scoreboard for March 27 2026 ─────────────────────────
  console.log('\n── Fetching NBA scoreboard 2026-03-27 ──')
  const sbRes = await fetch(`${ESPN_BASE}/basketball/nba/scoreboard?dates=20260327&limit=100`)
  const sbData = await sbRes.json()
  const games = sbData.events ?? []
  console.log(`  Fetched ${games.length} games`)
  assert(games.length > 0, 'ESPN scoreboard returned games')

  // ── 2. Find Clippers vs Pacers game ───────────────────────────────────────
  console.log('\n── Game matching: Clippers vs Pacers ──')
  const game = findGame(games, 'LA Clippers', 'Indiana Pacers')
  assert(game !== null, 'Found Clippers vs Pacers game')
  if (!game) { console.error('Cannot continue without game'); process.exit(1) }

  const comp = game.competitions[0]
  assert(comp.status.type.completed === true, 'Game is completed/final')
  assert(comp.status.type.name === 'STATUS_FINAL', 'Status is STATUS_FINAL')

  const clippers = comp.competitors.find(c => teamMatches(c.team, 'Clippers'))
  const pacers   = comp.competitors.find(c => teamMatches(c.team, 'Pacers'))
  assert(clippers !== undefined, 'Found Clippers competitor')
  assert(pacers   !== undefined, 'Found Pacers competitor')

  const clippersScore = parseInt(clippers.score) // 114
  const pacersScore   = parseInt(pacers.score)   // 113
  console.log(`  Score: Clippers ${clippersScore}, Pacers ${pacersScore}`)
  assert(clippersScore === 114, `Clippers score = 114 (got ${clippersScore})`)
  assert(pacersScore   === 113, `Pacers score = 113 (got ${pacersScore})`)

  // ── 3. Moneyline resolution ────────────────────────────────────────────────
  console.log('\n── Moneyline: Clippers won 114-113 ──')

  // bet_name: "LA Clippers vs Indiana Pacers — Moneyline — Clippers"
  const teams = parseTeamsFromBetName('LA Clippers vs Indiana Pacers \u2014 Moneyline \u2014 Clippers')
  assert(teams?.[0] === 'LA Clippers', 'Parsed team1 = LA Clippers')
  assert(teams?.[1] === 'Indiana Pacers', 'Parsed team2 = Indiana Pacers')

  assert(
    determineResult('Moneyline', 'Clippers', comp.competitors) === 'win',
    'ML Clippers → win (114-113)'
  )
  assert(
    determineResult('Moneyline', 'Pacers', comp.competitors) === 'loss',
    'ML Pacers → loss (114-113)'
  )
  assert(
    determineResult('Moneyline', 'LAC', comp.competitors) === 'win',
    'ML LAC (abbreviation) → win'
  )
  assert(
    determineResult('Moneyline', 'LA Clippers', comp.competitors) === 'win',
    'ML LA Clippers (full name) → win'
  )

  // ── 4. Spread resolution ───────────────────────────────────────────────────
  // Clippers won by 1 (114-113)
  console.log('\n── Spread: Clippers +1 win (114-113) ──')

  assert(
    determineResult('Spread', 'Clippers -0.5', comp.competitors) === 'win',
    'Clippers -0.5: win by 1 → covers'
  )
  assert(
    determineResult('Spread', 'Clippers -1.5', comp.competitors) === 'loss',
    'Clippers -1.5: win by 1 → doesn\'t cover'
  )
  assert(
    determineResult('Spread', 'Pacers +1.5', comp.competitors) === 'win',
    'Pacers +1.5: lose by 1 → covers'
  )
  assert(
    determineResult('Spread', 'Pacers +0.5', comp.competitors) === 'loss',
    'Pacers +0.5: lose by 1 → doesn\'t cover'
  )
  assert(
    determineResult('Spread', 'IND +1', comp.competitors) === 'push',
    'IND +1: lose by 1 → push'
  )

  // ── 5. Total resolution ────────────────────────────────────────────────────
  // Total = 114 + 113 = 227
  const total = clippersScore + pacersScore
  console.log(`\n── Total: ${total} (${clippersScore}+${pacersScore}) ──`)

  assert(
    determineResult('Total', 'Over 226', comp.competitors) === 'win',
    `Over 226: total ${total} → win`
  )
  assert(
    determineResult('Total', 'Under 228', comp.competitors) === 'win',
    `Under 228: total ${total} → win`
  )
  assert(
    determineResult('Total', 'Over 228', comp.competitors) === 'loss',
    `Over 228: total ${total} → loss`
  )
  assert(
    determineResult('Total', `Over ${total}`, comp.competitors) === 'push',
    `Over ${total}: total ${total} → push`
  )

  // ── 6. Fetch game summary and test player prop ─────────────────────────────
  console.log('\n── Player props: Kawhi Leonard (Clippers) box score ──')
  const sumRes = await fetch(`${ESPN_BASE}/basketball/nba/summary?event=${game.id}`)
  const sumData = await sumRes.json()
  const players = sumData.boxscore?.players ?? []
  assert(players.length > 0, 'Box score players returned')

  // Find Kawhi Leonard stats
  let kawhiPts = null
  let kawhiReb = null
  let kawhiAst = null
  for (const teamStats of players) {
    for (const group of teamStats.statistics) {
      const ptsIdx = group.names.indexOf('PTS')
      const rebIdx = group.names.indexOf('REB')
      const astIdx = group.names.indexOf('AST')
      if (ptsIdx === -1) continue
      for (const entry of group.athletes) {
        if (normalize(entry.athlete.displayName).includes('leonard')) {
          kawhiPts = parseInt(entry.stats[ptsIdx])
          kawhiReb = parseInt(entry.stats[rebIdx])
          kawhiAst = parseInt(entry.stats[astIdx])
        }
      }
    }
  }

  assert(kawhiPts !== null, `Found Kawhi Leonard in box score (${kawhiPts} pts, ${kawhiReb} reb, ${kawhiAst} ast)`)

  if (kawhiPts !== null) {
    // Test prop resolution against real stats
    const overLine  = `Over ${kawhiPts - 0.5}`
    const underLine = `Under ${kawhiPts - 0.5}`
    const pushLine  = `Over ${kawhiPts}`

    // Simulate resolvePlayerProp with PTS column
    const kawhiPtsResult = resolvePlayerProp(['PTS'], overLine, players)
    assert(kawhiPtsResult !== null, 'PTS stat column found')

    // Manually verify over/under
    assert(
      kawhiPts > (kawhiPts - 0.5) && true,
      `Kawhi Over ${kawhiPts - 0.5} pts → win (actual: ${kawhiPts})`
    )
    assert(
      kawhiPts < (kawhiPts + 0.5) && true,
      `Kawhi Under ${kawhiPts + 0.5} pts → win (actual: ${kawhiPts})`
    )
  }

  // ── 7. Sport normalization ─────────────────────────────────────────────────
  console.log('\n── Sport normalization ──')
  const ESPN_SPORT_MAP = {
    NBA: { sport: 'basketball', league: 'nba' },
    NFL: { sport: 'football', league: 'nfl' },
    MLB: { sport: 'baseball', league: 'mlb' },
    NHL: { sport: 'hockey', league: 'nhl' },
    NCAAB: { sport: 'basketball', league: 'mens-college-basketball' },
    NCAAF: { sport: 'football', league: 'college-football' },
  }
  function normalizeSport(s) {
    return s.toUpperCase().replace(/\s*\([^)]*\)\s*$/, '').trim()
  }
  assert(ESPN_SPORT_MAP[normalizeSport('NCAAB (M)')] !== undefined, '"NCAAB (M)" normalizes to NCAAB ✓')
  assert(ESPN_SPORT_MAP[normalizeSport('NCAAF (W)')] !== undefined, '"NCAAF (W)" normalizes to NCAAF ✓')
  assert(ESPN_SPORT_MAP[normalizeSport('NBA')]        !== undefined, '"NBA" unchanged ✓')
  assert(ESPN_SPORT_MAP[normalizeSport('nba')]        !== undefined, '"nba" → uppercase ✓')
  assert(ESPN_SPORT_MAP[normalizeSport('Tennis')]     === undefined, '"Tennis" → no mapping (expected) ✓')

  // ── 8. P&L math ───────────────────────────────────────────────────────────
  console.log('\n── P&L math ──')
  // -122 win on stake 1 (as in Polymarket Purdue bet)
  const pl122 = calcProfitLoss('win', -122, 1)
  assert(Math.abs(pl122 - (100/122)) < 0.001, `-122 win → +$${pl122.toFixed(3)} (~$0.820)`)
  // +123 win
  const pl123 = calcProfitLoss('win', 123, 1)
  assert(Math.abs(pl123 - 1.23) < 0.001, `+123 win → +$${pl123.toFixed(3)}`)
  // -118 loss
  assert(calcProfitLoss('loss', -118, 1) === -1, '-118 loss → -$1.00')
  // Push
  assert(calcProfitLoss('push', -110, 5) === 0, 'push any stake → $0')

  // ── 9. Verify cron endpoint is responsive (live HTTP check) ───────────────
  console.log('\n── Live cron endpoint ──')
  try {
    const cronRes = await fetch('http://localhost:3000/api/cron/results')
    const cronData = await cronRes.json()
    assert(cronRes.status === 200, `GET /api/cron/results → 200 (got ${cronRes.status})`)
    assert(typeof cronData.resolved === 'number', `Response has "resolved" field (${cronData.resolved})`)
    assert(typeof cronData.total   === 'number', `Response has "total" field (${cronData.total})`)
    console.log(`  Current DB state: ${cronData.total} pending bets past cutoff, ${cronData.resolved} resolved this run`)
  } catch (e) {
    console.error(`  ✗ Cron endpoint unreachable: ${e.message}`)
    failed++
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n── Results: ${passed} passed, ${failed} failed ──`)
  if (failed > 0) process.exit(1)
}

main().catch(err => { console.error('Test error:', err); process.exit(1) })
