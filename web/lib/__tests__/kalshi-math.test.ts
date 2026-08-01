import {
  americanToImpliedProb,
  americanNetDecimal,
  maxAcceptablePriceCents,
  availableAtCap,
  kellyContracts,
  matchSide,
  bestAvailablePriceCents,
  checkOddsAgreement,
  probToAmerican,
  effectiveCostAtCents,
  KALSHI_FEE_RATE,
  ODDS_AGREEMENT_TOLERANCE,
  type KalshiOrderbookFp,
} from '../kalshi-math'

describe('americanToImpliedProb', () => {
  it('converts positive odds', () => {
    expect(americanToImpliedProb(100)).toBeCloseTo(0.5)
    expect(americanToImpliedProb(150)).toBeCloseTo(0.4)
    expect(americanToImpliedProb(1083)).toBeCloseTo(100 / 1183)
  })
  it('converts negative odds', () => {
    expect(americanToImpliedProb(-100)).toBeCloseTo(0.5)
    expect(americanToImpliedProb(-150)).toBeCloseTo(0.6)
    expect(americanToImpliedProb(-1237)).toBeCloseTo(1237 / 1337)
  })
})

describe('americanNetDecimal', () => {
  it('mirrors the extension kellyStake b', () => {
    expect(americanNetDecimal(150)).toBeCloseTo(1.5)
    expect(americanNetDecimal(-200)).toBeCloseTo(0.5)
    expect(americanNetDecimal(-110)).toBeCloseTo(100 / 110)
  })
})

describe('maxAcceptablePriceCents', () => {
  it('is fee-aware: effective cost at cap never exceeds implied prob', () => {
    for (const odds of [100, 150, -110, -150, 1083, -1237, 573, -654]) {
      const cap = maxAcceptablePriceCents(odds)
      expect(cap).toBeGreaterThan(0)
      const price = cap / 100
      const effective = price + KALSHI_FEE_RATE * price * (1 - price)
      expect(effective).toBeLessThanOrEqual(americanToImpliedProb(odds) + 1e-9)
      // and one cent more would exceed it (cap is maximal)
      if (cap < 99) {
        const p2 = (cap + 1) / 100
        const eff2 = p2 + KALSHI_FEE_RATE * p2 * (1 - p2)
        expect(eff2).toBeGreaterThan(americanToImpliedProb(odds))
      }
    }
  })
  it('even money (+100, implied 0.50) caps below 50c because of fees', () => {
    expect(maxAcceptablePriceCents(100)).toBeLessThan(50)
    expect(maxAcceptablePriceCents(100)).toBeGreaterThanOrEqual(48)
  })
  it('heavy favorite -1237 (implied ~92.5%) caps near 92', () => {
    const cap = maxAcceptablePriceCents(-1237)
    expect(cap).toBeGreaterThanOrEqual(90)
    expect(cap).toBeLessThanOrEqual(93)
  })
})

describe('availableAtCap', () => {
  // yes_dollars = bids for YES, no_dollars = bids for NO (dollar strings)
  const book: KalshiOrderbookFp = {
    yes_dollars: [
      ['0.40', '100.00'], // ask for NO at 60c
      ['0.55', '50.00'],  // ask for NO at 45c
    ],
    no_dollars: [
      ['0.30', '200.00'], // ask for YES at 70c
      ['0.45', '80.00'],  // ask for YES at 55c
    ],
  }

  it('buying YES crosses NO bids: counts levels where 100 - no_price <= cap', () => {
    expect(availableAtCap(book, 'yes', 54)).toBe(0)   // cheapest YES ask is 55c
    expect(availableAtCap(book, 'yes', 55)).toBe(80)
    expect(availableAtCap(book, 'yes', 70)).toBe(280)
  })

  it('buying NO crosses YES bids: counts levels where 100 - yes_price <= cap', () => {
    expect(availableAtCap(book, 'no', 44)).toBe(0)    // cheapest NO ask is 45c
    expect(availableAtCap(book, 'no', 45)).toBe(50)
    expect(availableAtCap(book, 'no', 60)).toBe(150)
  })

  it('never sums same-side bids', () => {
    const onlyYesBids: KalshiOrderbookFp = { yes_dollars: [['0.50', '999.00']], no_dollars: [] }
    expect(availableAtCap(onlyYesBids, 'yes', 99)).toBe(0)
  })

  it('handles null/missing arrays (empty demo books)', () => {
    expect(availableAtCap({}, 'yes', 90)).toBe(0)
    expect(availableAtCap({ yes_dollars: null, no_dollars: null }, 'no', 90)).toBe(0)
    expect(availableAtCap(null, 'yes', 90)).toBe(0)
  })

  it('floors fractional contract counts', () => {
    const b: KalshiOrderbookFp = { no_dollars: [['0.50', '10.75']] }
    expect(availableAtCap(b, 'yes', 50)).toBe(10)
  })
})

describe('probToAmerican', () => {
  it('round-trips with americanToImpliedProb', () => {
    expect(probToAmerican(0.5238)).toBe(-110)
    expect(probToAmerican(0.4)).toBe(150)
    expect(probToAmerican(americanToImpliedProb(-1237))).toBe(-1237)
    expect(probToAmerican(americanToImpliedProb(573))).toBe(573)
  })
})

describe('bestAvailablePriceCents', () => {
  const book: KalshiOrderbookFp = {
    yes_dollars: [['0.40', '100.00'], ['0.55', '50.00']], // NO asks at 60c, 45c
    no_dollars: [['0.30', '200.00'], ['0.45', '80.00']],  // YES asks at 70c, 55c
  }
  it('finds the cheapest executable price crossing the opposite side', () => {
    expect(bestAvailablePriceCents(book, 'yes')).toBe(55)
    expect(bestAvailablePriceCents(book, 'no')).toBe(45)
  })
  it('NaN for empty books and zero-count levels', () => {
    expect(bestAvailablePriceCents({}, 'yes')).toBeNaN()
    expect(bestAvailablePriceCents({ no_dollars: [['0.50', '0.00']] }, 'yes')).toBeNaN()
  })
})

describe('checkOddsAgreement (the stopper)', () => {
  it('accepts when Kalshi effective odds ≈ PTO odds', () => {
    // -110 → implied .5238; 50c + fee = .5175 → diff .0063
    const r = checkOddsAgreement(-110, 50)
    expect(r.ok).toBe(true)
    expect(r.kalshi_odds).toBeLessThan(0) // near even money, slight fav pricing
  })
  it('blocks when Kalshi is much cheaper than PTO implies (wrong/stale market)', () => {
    // PTO +300 → implied .25; best price 50c + fee = .5175 → diff .2675
    const r = checkOddsAgreement(300, 50)
    expect(r.ok).toBe(false)
  })
  it('blocks when Kalshi is much more expensive than PTO implies', () => {
    // PTO -110 → implied .5238; best price 75c + fee = .7631
    const r = checkOddsAgreement(-110, 75)
    expect(r.ok).toBe(false)
  })
  it('tolerance boundary: one cent of price stays within tolerance', () => {
    // cap for -110 is 50; a book at 49c or 51c is still "the same odds"
    expect(checkOddsAgreement(-110, 49).ok).toBe(true)
    expect(checkOddsAgreement(-110, 52).ok).toBe(true) // .5485 vs .5238 = .0247 < .03
    expect(checkOddsAgreement(-110, 54).ok).toBe(false) // .5686 vs .5238 = .0448 > .03
  })
  it('reports fee-inclusive Kalshi odds', () => {
    const r = checkOddsAgreement(-110, 50)
    expect(r.kalshi_prob).toBeCloseTo(effectiveCostAtCents(50))
    expect(r.kalshi_odds).toBe(probToAmerican(effectiveCostAtCents(50)))
  })
  it('exposes a sane tolerance constant', () => {
    expect(ODDS_AGREEMENT_TOLERANCE).toBeGreaterThan(0.01)
    expect(ODDS_AGREEMENT_TOLERANCE).toBeLessThanOrEqual(0.05)
  })
})

describe('kellyContracts', () => {
  it('matches stake$ x 100 / cap, floored', () => {
    // bankroll 50k, edge 1%, quarter kelly, odds -119 -> b = 100/119
    // stake = 50000*0.01*0.25/(100/119) = 148.75; at cap 51c -> floor(14875/51)=291
    expect(kellyContracts(50000, 0.01, 0.25, -119, 51)).toBe(291)
  })
  it('underdog sizing: +120 at cap 43c', () => {
    // stake = 50000*0.01*0.25/1.2 = 104.1667 -> floor(10416.67/43) = 242
    expect(kellyContracts(50000, 0.01, 0.25, 120, 43)).toBe(242)
  })
  it('returns 0 for cap 0', () => {
    expect(kellyContracts(50000, 0.05, 0.25, 150, 0)).toBe(0)
  })
})

describe('matchSide', () => {
  // Real Kalshi shape: one market PER ENTITY; yes_sub_title === no_sub_title
  // === the subject. A PTO leg always means buy YES on its linked market.
  const market = {
    ticker: 'KXWTAMATCH-26AUG02ZHALIN-LIN',
    title: 'Will Magda Linette win?',
    yes_sub_title: 'Magda Linette',
    no_sub_title: 'Magda Linette',
    status: 'active',
  }

  it('matches the subject → yes', () => {
    expect(matchSide('Magda Linette', market)).toBe('yes')
  })
  it('matches PTO "Lastname F" rendering', () => {
    expect(matchSide('Linette M', market)).toBe('yes')
  })
  it('handles accents (Kalshi ASCII vs PTO diacritics)', () => {
    expect(matchSide('Magda Linetté', market)).toBe('yes')
  })
  it('blocks when the linked market is about someone else (opponent or wrong match)', () => {
    expect(matchSide('Shuai Zhang', market)).toBe(null)
    expect(matchSide('Irina Fetecau', market)).toBe(null)
  })
  it('falls back to title when yes_sub_title is empty', () => {
    const noSub = { ...market, yes_sub_title: '' }
    expect(matchSide('Magda Linette', noSub)).toBe('yes')
  })
  it('blocks when subject and title are both empty', () => {
    const empty = { ...market, yes_sub_title: '', title: '' }
    expect(matchSide('Magda Linette', empty)).toBe(null)
  })
  it('team markets: subject is the team, opponent blocked', () => {
    const sd = { ticker: 'KXMLBGAME-26AUG032140SDAZ-SD', title: '', yes_sub_title: 'San Diego', no_sub_title: 'San Diego', status: 'active' }
    expect(matchSide('San Diego', sd)).toBe('yes')
    expect(matchSide('Arizona', sd)).toBe(null)
  })
})
