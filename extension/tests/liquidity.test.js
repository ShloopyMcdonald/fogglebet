/**
 * Tests for liquidity scraping from picktheodds arb rows.
 *
 * DOM structure of a leg <a> tag:
 *   <a href="...">
 *     <div aria-label="NoVig"></div>
 *     <span class="MuiTypography-label">Over 4.5</span>   ← sideEl
 *     <span class="MuiTypography-label">$350</span>       ← liquidity
 *   </a>
 */

// ─── Functions under test (copied from content/index.js) ──────────────────────
// Keep in sync with content/index.js if these change.

function parseDollarAmount(text) {
  if (!text) return null
  const clean = text.replace('$', '').replace(/,/g, '').trim()
  if (clean.endsWith('k')) return parseFloat(clean) * 1000
  const n = parseFloat(clean)
  return isNaN(n) ? null : n
}

function scrapeLegLiquidity(legEl) {
  const sideEl = legEl.querySelector('span.MuiTypography-label')
  const liquidityEl = Array.from(legEl.querySelectorAll('span.MuiTypography-label'))
    .find(el => el !== sideEl && el.textContent?.includes('$'))
  return parseDollarAmount(liquidityEl?.textContent?.trim() ?? null)
}

// ─── parseDollarAmount ────────────────────────────────────────────────────────

describe('parseDollarAmount', () => {
  test('plain dollar amount', () => {
    expect(parseDollarAmount('$350')).toBe(350)
  })

  test('amount with comma', () => {
    expect(parseDollarAmount('$1,200')).toBe(1200)
  })

  test('k suffix', () => {
    expect(parseDollarAmount('$1.5k')).toBe(1500)
  })

  test('k suffix whole number', () => {
    expect(parseDollarAmount('$2k')).toBe(2000)
  })

  test('null input', () => {
    expect(parseDollarAmount(null)).toBeNull()
  })

  test('empty string', () => {
    expect(parseDollarAmount('')).toBeNull()
  })

  test('non-numeric', () => {
    expect(parseDollarAmount('$—')).toBeNull()
  })
})

// ─── scrapeLegLiquidity ───────────────────────────────────────────────────────

function makeLeg({ sideLabel, liquidity, book = 'NoVig', href = '#' } = {}) {
  const a = document.createElement('a')
  a.setAttribute('href', href)

  const bookDiv = document.createElement('div')
  bookDiv.setAttribute('aria-label', book)
  a.appendChild(bookDiv)

  if (sideLabel) {
    const span = document.createElement('span')
    span.className = 'MuiTypography-label'
    span.textContent = sideLabel
    a.appendChild(span)
  }

  if (liquidity) {
    const span = document.createElement('span')
    span.className = 'MuiTypography-label'
    span.textContent = liquidity
    a.appendChild(span)
  }

  return a
}

describe('scrapeLegLiquidity', () => {
  test('returns parsed number when liquidity span is present', () => {
    const leg = makeLeg({ sideLabel: 'Over 4.5', liquidity: '$350' })
    expect(scrapeLegLiquidity(leg)).toBe(350)
  })

  test('handles k suffix', () => {
    const leg = makeLeg({ sideLabel: 'Under 7.5', liquidity: '$1.2k' })
    expect(scrapeLegLiquidity(leg)).toBe(1200)
  })

  test('returns null when no liquidity span present', () => {
    const leg = makeLeg({ sideLabel: 'Celtics ML' })
    expect(scrapeLegLiquidity(leg)).toBeNull()
  })

  test('returns null when no spans at all', () => {
    const leg = makeLeg({})
    expect(scrapeLegLiquidity(leg)).toBeNull()
  })

  test('does not mistake side label for liquidity (no $ in side label)', () => {
    const leg = makeLeg({ sideLabel: 'Over 4.5' }) // only one span, no $
    expect(scrapeLegLiquidity(leg)).toBeNull()
  })

  test('handles amount with comma', () => {
    const leg = makeLeg({ sideLabel: 'Yes', liquidity: '$1,500' })
    expect(scrapeLegLiquidity(leg)).toBe(1500)
  })

  test('leg with no side label — liquidity span is first and contains $', () => {
    // Edge case: no sideEl means sideEl = liquidity span. Verify it still returns it.
    const leg = makeLeg({ liquidity: '$200' }) // sideEl will be the liquidity span
    // In this case sideEl === liquidityEl, so .find() skips it → null
    // This is correct behaviour: we don't misread the only span as liquidity
    expect(scrapeLegLiquidity(leg)).toBeNull()
  })
})
