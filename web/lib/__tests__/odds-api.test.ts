/**
 * Tests for findClosingOdds — verifies that every market type FoggleBet records
 * can correctly look up closing odds from an odds-api.io response.
 *
 * decimal→American conversion used throughout:
 *   "2.10" → +110   (>= 2.0:  (d-1)*100)
 *   "1.50" → -200   (< 2.0: -100/(d-1))
 *   "3.00" → +200
 *   "1.91" → -110   (rounds from -109.89)
 */

// Prevent supabase.ts from calling createClient with undefined env vars
jest.mock('../supabase', () => ({ supabase: {} }))

import { findClosingOdds, OddsApiOddsResponse, OddsApiMarket } from '../odds-api'
import type { Bet } from '../supabase'

// ── Helpers ────────────────────────────────────────────────────────────────────

function bet(market: string, line: string): Bet {
  return {
    id: 'test',
    arb_id: 'arb',
    is_taken: true,
    is_training: false,
    recorded_at: '2026-01-01T00:00Z',
    game_time: null,
    bet_name: 'Team A vs Team B — market — side',
    sport: 'NBA',
    market,
    line,
    book: 'FanDuel',
    odds: -110,
    liquidity: null,
    ev_percent: null,
    arb_percent: null,
    closing_odds: null,
    closing_book: null,
    clv: null,
    result: 'pending',
    profit_loss: null,
    stake: 100,
    book_odds: null,
    source_url: null,
    notes: null,
  }
}

function makeEvent(
  home: string,
  away: string,
  bookmakers: Record<string, OddsApiMarket[]>
): OddsApiOddsResponse {
  return {
    id: 1,
    home,
    away,
    date: '2026-01-01T00:00Z',
    status: 'pending',
    sport: { name: 'Basketball', slug: 'basketball' },
    league: { name: 'NBA', slug: 'nba' },
    bookmakers,
  }
}

function mlMarket(home: string, away: string): OddsApiMarket {
  return { name: 'ML', updatedAt: '', odds: [{ home, away }] }
}

function spreadMarket(entries: Array<{ hdp: number; home: string; away: string }>): OddsApiMarket {
  return { name: 'Spread', updatedAt: '', odds: entries.map(e => ({ hdp: e.hdp, home: e.home, away: e.away })) }
}

function totalsMarket(entries: Array<{ hdp: number; over: string; under: string }>): OddsApiMarket {
  return { name: 'Totals', updatedAt: '', odds: entries.map(e => ({ hdp: e.hdp, over: e.over, under: e.under })) }
}

function propMarket(entries: Array<{ label: string; hdp: number; over: string; under: string }>): OddsApiMarket {
  return { name: 'Player Props', updatedAt: '', odds: entries.map(e => ({ label: e.label, hdp: e.hdp, over: e.over, under: e.under })) }
}

// ── Moneyline ─────────────────────────────────────────────────────────────────

describe('Moneyline', () => {
  const event = makeEvent('Golden State Warriors', 'Boston Celtics', {
    Circa: [mlMarket('2.10', '1.75')],
  })

  test('home team — returns correct price and book', () => {
    const r = findClosingOdds(event, bet('Moneyline', 'Warriors'))
    expect(r).not.toBeNull()
    expect(r!.price).toBe(110)          // (2.10-1)*100 = 110
    expect(r!.opposingPrice).toBe(-133) // round(-100/(1.75-1)) = round(-133.33)
    expect(r!.bookKey).toBe('Circa')
  })

  test('away team — returns correct price', () => {
    const r = findClosingOdds(event, bet('Moneyline', 'Celtics'))
    expect(r).not.toBeNull()
    expect(r!.price).toBe(-133)
    expect(r!.opposingPrice).toBe(110)
  })

  test('partial name match — "Golden State" matches Warriors', () => {
    const r = findClosingOdds(event, bet('Moneyline', 'Golden State'))
    expect(r).not.toBeNull()
    expect(r!.price).toBe(110)
  })

  test('fallback to BetOnline.ag when Circa missing', () => {
    const ev = makeEvent('Warriors', 'Celtics', {
      'BetOnline.ag': [mlMarket('2.10', '1.75')],
    })
    const r = findClosingOdds(ev, bet('Moneyline', 'Warriors'))
    expect(r).not.toBeNull()
    expect(r!.bookKey).toBe('BetOnline.ag')
  })

  test('fallback to FanDuel when Circa and BetOnline missing', () => {
    const ev = makeEvent('Warriors', 'Celtics', {
      FanDuel: [mlMarket('2.10', '1.75')],
    })
    const r = findClosingOdds(ev, bet('Moneyline', 'Warriors'))
    expect(r!.bookKey).toBe('FanDuel')
  })

  test('no matching team — returns null', () => {
    const r = findClosingOdds(event, bet('Moneyline', 'Lakers'))
    expect(r).toBeNull()
  })

  test('N/A odds — returns null', () => {
    const ev = makeEvent('Warriors', 'Celtics', {
      Circa: [mlMarket('N/A', 'N/A')],
    })
    expect(findClosingOdds(ev, bet('Moneyline', 'Warriors'))).toBeNull()
  })

  test('soccer Draw', () => {
    const ev = makeEvent('Real Madrid', 'Barcelona', {
      Circa: [{ name: 'ML', updatedAt: '', odds: [{ home: '2.10', away: '3.00', draw: '3.50' }] }],
    })
    const r = findClosingOdds(ev, bet('Moneyline', 'Draw'))
    expect(r).not.toBeNull()
    expect(r!.price).toBe(250) // (3.50-1)*100 = 250
  })
})

// ── Spread ────────────────────────────────────────────────────────────────────

describe('Spread', () => {
  const event = makeEvent('Warriors', 'Celtics', {
    Circa: [
      spreadMarket([
        { hdp: -3.5, home: '1.91', away: '1.91' },
        { hdp: -7.5, home: '1.85', away: '2.00' },
      ]),
    ],
  })

  test('home team at -3.5', () => {
    const r = findClosingOdds(event, bet('Spread', 'Warriors -3.5'))
    expect(r).not.toBeNull()
    expect(r!.price).toBe(-110)   // round(-100/0.91) = -110
    expect(r!.opposingPrice).toBe(-110)
  })

  test('away team at +3.5', () => {
    // away bet: line = "Celtics +3.5", targetHdp = -3.5 (home's hdp), price = entry.away
    const r = findClosingOdds(event, bet('Spread', 'Celtics +3.5'))
    expect(r).not.toBeNull()
    expect(r!.price).toBe(-110)
  })

  test('home team at -7.5 (asymmetric odds)', () => {
    const r = findClosingOdds(event, bet('Spread', 'Warriors -7.5'))
    expect(r).not.toBeNull()
    expect(r!.price).toBe(-118)  // round(-100/0.85)
    expect(r!.opposingPrice).toBe(100) // (2.00-1)*100 = 100
  })

  test('line not offered — returns null', () => {
    const r = findClosingOdds(event, bet('Spread', 'Warriors -5.5'))
    expect(r).toBeNull()
  })

  test('half-point lines accepted within 0.1 tolerance', () => {
    // hdp stored as -3.5, bet line as "Warriors -3.5" → |(-3.5) - (-3.5)| < 0.1 ✓
    const r = findClosingOdds(event, bet('Spread', 'Warriors -3.5'))
    expect(r).not.toBeNull()
  })
})

// ── Totals ────────────────────────────────────────────────────────────────────

describe('Totals', () => {
  const event = makeEvent('Warriors', 'Celtics', {
    Circa: [totalsMarket([{ hdp: 224.5, over: '1.91', under: '2.10' }])],
  })

  test('market="Total" Over', () => {
    const r = findClosingOdds(event, bet('Total', 'Over 224.5'))
    expect(r).not.toBeNull()
    expect(r!.price).toBe(-110)
    expect(r!.opposingPrice).toBe(110)
  })

  test('market="Total" Under', () => {
    const r = findClosingOdds(event, bet('Total', 'Under 224.5'))
    expect(r).not.toBeNull()
    expect(r!.price).toBe(110)
    expect(r!.opposingPrice).toBe(-110)
  })

  test('market="Total Points" is treated as a total', () => {
    const r = findClosingOdds(event, bet('Total Points', 'Over 224.5'))
    expect(r).not.toBeNull()
    expect(r!.price).toBe(-110)
  })

  test('market="Total Runs" (MLB) is treated as a total', () => {
    const ev = makeEvent('Yankees', 'Red Sox', {
      Circa: [totalsMarket([{ hdp: 8.5, over: '1.91', under: '1.91' }])],
    })
    const r = findClosingOdds(ev, bet('Total Runs', 'Over 8.5'))
    expect(r).not.toBeNull()
  })

  test('market="Total Goals" (NHL/Soccer) is treated as a total', () => {
    const ev = makeEvent('Avalanche', 'Stars', {
      Circa: [totalsMarket([{ hdp: 6.5, over: '2.00', under: '1.80' }])],
    })
    const r = findClosingOdds(ev, bet('Total Goals', 'Over 6.5'))
    expect(r).not.toBeNull()
  })

  test('wrong total number — returns null', () => {
    const r = findClosingOdds(event, bet('Total', 'Over 220.5'))
    expect(r).toBeNull()
  })
})

// ── Basketball Player Props ───────────────────────────────────────────────────

describe('Basketball player props', () => {
  function nbaEvent(label: string, hdp: number) {
    return makeEvent('Mavericks', 'Lakers', {
      FanDuel: [propMarket([{ label, hdp, over: '1.91', under: '2.10' }])],
    })
  }

  const singles: Array<[string, string]> = [
    ['Points',            'Luka Doncic (Points)'],
    ['Rebounds',          'Luka Doncic (Rebounds)'],
    ['Assists',           'Luka Doncic (Assists)'],
    ['Blocks',            'Luka Doncic (Blocks)'],
    ['Steals',            'Luka Doncic (Steals)'],
    ['Turnovers',         'Luka Doncic (Turnovers)'],
    ['3-Pointers Made',   'Luka Doncic (3 Point FG)'],
    ['3PT',               'Luka Doncic (3 Point FG)'],
  ]

  test.each(singles)('market "%s" — found via FanDuel', (statType, label) => {
    const ev = nbaEvent(label, 33.5)
    const r = findClosingOdds(ev, bet(`${statType} - Doncic, L`, 'Over 33.5'))
    expect(r).not.toBeNull()
    expect(r!.bookKey).toBe('FanDuel')
    expect(r!.price).toBe(-110)
  })

  const combos: Array<[string, string]> = [
    ['Pts + Ast + Reb', 'LeBron James (Pts+Rebs+Asts)'],
    ['Pts + Ast',       'LeBron James (Pts+Asts)'],
    ['Pts + Reb',       'LeBron James (Pts+Rebs)'],
    ['Reb + Ast',       'LeBron James (Rebs+Asts)'],
  ]

  test.each(combos)('combo prop "%s" — found', (statType, label) => {
    const ev = nbaEvent(label, 28.5)
    const r = findClosingOdds(ev, bet(`${statType} - James, L`, 'Over 28.5'))
    expect(r).not.toBeNull()
  })

  test('wrong line value — returns null', () => {
    const ev = nbaEvent('Luka Doncic (Points)', 33.5)
    const r = findClosingOdds(ev, bet('Points - Doncic, L', 'Over 30.5'))
    expect(r).toBeNull()
  })

  test('player not in response — returns null', () => {
    const ev = nbaEvent('Luka Doncic (Points)', 33.5)
    const r = findClosingOdds(ev, bet('Points - Davis, A', 'Over 25.5'))
    expect(r).toBeNull()
  })

  test('FanDuel missing — falls back to Circa per PROP_BOOK_PRIORITY', () => {
    const ev = makeEvent('Mavericks', 'Lakers', {
      Circa: [propMarket([{ label: 'Luka Doncic (Points)', hdp: 33.5, over: '1.91', under: '1.91' }])],
    })
    const r = findClosingOdds(ev, bet('Points - Doncic, L', 'Over 33.5'))
    expect(r).not.toBeNull()
    expect(r!.bookKey).toBe('Circa')
  })

  test('no book in PROP_BOOK_PRIORITY present — returns null', () => {
    const ev = makeEvent('Mavericks', 'Lakers', {
      SomeOtherBook: [propMarket([{ label: 'Luka Doncic (Points)', hdp: 33.5, over: '1.91', under: '1.91' }])],
    })
    const r = findClosingOdds(ev, bet('Points - Doncic, L', 'Over 33.5'))
    expect(r).toBeNull()
  })
})

// ── Football Player Props ─────────────────────────────────────────────────────

describe('Football player props', () => {
  function nflEvent(label: string, hdp: number) {
    return makeEvent('Chiefs', 'Eagles', {
      FanDuel: [propMarket([{ label, hdp, over: '1.91', under: '1.91' }])],
    })
  }

  const passing: Array<[string, string]> = [
    ['Pass Yards',    'Patrick Mahomes (Passing Yards)'],
    ['Pass TDs',      'Patrick Mahomes (Passing Touchdowns)'],
    ['Interceptions', 'Patrick Mahomes (Passing Interceptions)'],
  ]

  test.each(passing)('passing: "%s"', (statType, label) => {
    const ev = nflEvent(label, 285.5)
    const r = findClosingOdds(ev, bet(`${statType} - Mahomes, P`, 'Over 285.5'))
    expect(r).not.toBeNull()
  })

  const rushing: Array<[string, string]> = [
    ['Rush Yards',  'Derrick Henry (Rushing Yards)'],
    ['Rushing TDs', 'Derrick Henry (Rushing Touchdowns)'],
  ]

  test.each(rushing)('rushing: "%s"', (statType, label) => {
    const ev = nflEvent(label, 85.5)
    const r = findClosingOdds(ev, bet(`${statType} - Henry, D`, 'Over 85.5'))
    expect(r).not.toBeNull()
  })

  const receiving: Array<[string, string]> = [
    ['Receiving Yards', 'Tyreek Hill (Receiving Yards)'],
    ['Receptions',      'Tyreek Hill (Receptions)'],
    ['Receiving TDs',   'Tyreek Hill (Receiving Touchdowns)'],
  ]

  test.each(receiving)('receiving: "%s"', (statType, label) => {
    const ev = nflEvent(label, 75.5)
    const r = findClosingOdds(ev, bet(`${statType} - Hill, T`, 'Over 75.5'))
    expect(r).not.toBeNull()
  })
})

// ── Baseball Player Props ─────────────────────────────────────────────────────

describe('Baseball player props — batter', () => {
  function mlbEvent(label: string, hdp: number) {
    return makeEvent('Yankees', 'Red Sox', {
      FanDuel: [propMarket([{ label, hdp, over: '2.00', under: '1.80' }])],
    })
  }

  const batterProps: Array<[string, string]> = [
    ['Strikeouts',   'Juan Soto (Strikeouts)'],
    ['Hits',         'Juan Soto (Hits)'],
    ['Home Runs',    'Juan Soto (Home Runs)'],
    ['RBIs',         'Juan Soto (RBIs)'],
    ['Total Bases',  'Juan Soto (Total Bases)'],
    ['Runs',         'Juan Soto (Runs Scored)'],
  ]

  test.each(batterProps)('batter: "%s"', (statType, label) => {
    const ev = mlbEvent(label, 1.5)
    const r = findClosingOdds(ev, bet(`${statType} - Soto, J`, 'Over 1.5'))
    expect(r).not.toBeNull()
  })
})

describe('Baseball player props — pitcher', () => {
  function mlbEvent(label: string, hdp: number) {
    return makeEvent('Yankees', 'Red Sox', {
      FanDuel: [propMarket([{ label, hdp, over: '1.91', under: '1.91' }])],
    })
  }

  // Pitcher prop stat types → expected FanDuel label (per PROP_STAT_LABEL_MAP)
  const pitcherProps: Array<[string, string]> = [
    ['Pitcher Strikeouts',   'Gerrit Cole (Pitcher Strikeouts)'],
    ['Pitcher Allowed Hits', 'Gerrit Cole (Hits Allowed)'],
    ['Pitcher Earned Runs',  'Gerrit Cole (Earned Runs)'],
    ['Pitcher Walks',        'Gerrit Cole (Walks)'],
    ['Pitcher Earned Outs',  'Gerrit Cole (Outs Recorded)'],
    ['Pitcher Home Runs',    'Gerrit Cole (Home Runs Allowed)'],
  ]

  test.each(pitcherProps)('pitcher: "%s"', (statType, label) => {
    const ev = mlbEvent(label, 6.5)
    const r = findClosingOdds(ev, bet(`${statType} - Cole, G`, 'Over 6.5'))
    expect(r).not.toBeNull()
  })
})

// ── Diacritic player names ────────────────────────────────────────────────────

describe('Diacritic player names', () => {
  // PTO stores names without diacritics ("Jokic"), odds-api labels use them ("Jokić").
  // normalize() must use NFD decomposition so both reduce to the same string.
  test('Jokić (ć) matched by "Jokic" from PTO', () => {
    const ev = makeEvent('Nuggets', 'Heat', {
      FanDuel: [propMarket([{ label: 'Nikola Jokić (Points)', hdp: 28.5, over: '1.91', under: '1.91' }])],
    })
    const r = findClosingOdds(ev, bet('Points - Jokic, N', 'Over 28.5'))
    expect(r).not.toBeNull()
  })

  test('Dončić (č) matched by "Doncic" from PTO', () => {
    const ev = makeEvent('Mavericks', 'Lakers', {
      FanDuel: [propMarket([{ label: 'Luka Dončić (Points)', hdp: 33.5, over: '1.91', under: '1.91' }])],
    })
    const r = findClosingOdds(ev, bet('Points - Doncic, L', 'Over 33.5'))
    expect(r).not.toBeNull()
  })
})

// ── Hockey Player Props ───────────────────────────────────────────────────────

describe('Hockey player props', () => {
  function nhlEvent(label: string, hdp: number) {
    return makeEvent('Avalanche', 'Stars', {
      FanDuel: [propMarket([{ label, hdp, over: '1.80', under: '2.00' }])],
    })
  }

  const hockeyProps: Array<[string, string]> = [
    ['Goals',          'Nathan MacKinnon (Goals)'],
    ['Shots',          'Nathan MacKinnon (Shots on Goal)'],
    ['Shots on Goal',  'Nathan MacKinnon (Shots on Goal)'],
    ['Blocked Shots',  'Nathan MacKinnon (Blocked Shots)'],
  ]

  test.each(hockeyProps)('hockey: "%s"', (statType, label) => {
    const ev = nhlEvent(label, 2.5)
    const r = findClosingOdds(ev, bet(`${statType} - MacKinnon, N`, 'Over 2.5'))
    expect(r).not.toBeNull()
  })
})
