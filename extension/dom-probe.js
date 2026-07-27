// FoggleBet DOM probe — paste into the DevTools console on an EXPANDED
// picktheodds arb row to dump how that row lays out its legs and odds.
// Copy the output back so the Kelly-hint selectors can be matched to reality.
//
// Reports, per row: the two leg containers found, every short signed-odds
// text node with its class/tag/position, and which one the geometric
// fallback would pick for each leg.
;(function () {
  function findArbRows() {
    const seen = new Set()
    const rows = []
    document.querySelectorAll('span.MuiTypography-navHeader').forEach(el => {
      let node = el.parentElement
      for (let i = 0; i < 12; i++) {
        if (!node || node === document.body) break
        if (node.querySelectorAll('div[aria-label]').length >= 2) {
          if (!seen.has(node)) { seen.add(node); rows.push(node) }
          break
        }
        node = node.parentElement
      }
    })
    return rows
  }

  const isExpanded = row =>
    row.querySelectorAll('span.MuiTypography-oddsRobotoMono').length > 2

  const rows = findArbRows()
  console.log(`[probe] rows found: ${rows.length}, expanded: ${rows.filter(isExpanded).length}`)

  rows.filter(isExpanded).slice(0, 1).forEach((row, ri) => {
    const bookDivs = Array.from(row.querySelectorAll('div[aria-label]'))
      .filter(el => (el.getAttribute('aria-label') ?? '').length > 0)
      .filter(el => !/[+-]\d/.test(el.getAttribute('aria-label') ?? ''))
      .filter(el => !el.closest('table'))
      .slice(0, 2)
    const legs = bookDivs.map(d => d.parentElement?.parentElement ?? null).filter(Boolean)

    console.log(`[probe] row ${ri}: bookDivs=${bookDivs.length} legs=${legs.length}`,
      bookDivs.map(d => d.getAttribute('aria-label')))

    const rowRect = row.getBoundingClientRect()
    legs.forEach((leg, i) => {
      const r = leg.getBoundingClientRect()
      console.log(`[probe]   leg ${i} rect`, {
        top: Math.round(r.top - rowRect.top),
        left: Math.round(r.left - rowRect.left),
        w: Math.round(r.width),
        h: Math.round(r.height),
        text: (leg.textContent || '').trim().slice(0, 60),
      })
    })

    // Every leaf element whose text looks like odds
    const candidates = []
    row.querySelectorAll('span, p, div').forEach(el => {
      if (el.childElementCount !== 0) return
      const text = (el.textContent || '').trim()
      if (!/^[+-]?\d{2,4}$/.test(text)) return
      const c = el.getBoundingClientRect()
      if (c.width === 0) return
      candidates.push({
        text,
        tag: el.tagName.toLowerCase(),
        cls: el.className || '(none)',
        top: Math.round(c.top - rowRect.top),
        left: Math.round(c.left - rowRect.left),
        inLeg: legs.findIndex(l => l.contains(el)),
        inTable: !!el.closest('table'),
      })
    })
    console.log(`[probe]   odds-like leaf nodes: ${candidates.length}`)
    console.table(candidates.slice(0, 40))

    // What the geometric fallback would choose
    legs.forEach((leg, i) => {
      const r = leg.getBoundingClientRect()
      let best = null, bestDist = Infinity
      row.querySelectorAll('span, p, div').forEach(el => {
        if (el.childElementCount !== 0) return
        if (el.classList.contains('fb-kelly-hint')) return
        const text = (el.textContent || '').trim()
        if (!/^[+-]\d{2,4}$/.test(text)) return
        const c = el.getBoundingClientRect()
        if (c.width === 0) return
        const mid = (c.top + c.bottom) / 2
        if (mid < r.top || mid > r.bottom) return
        const dist = Math.abs(c.left - r.right)
        if (dist < bestDist) { bestDist = dist; best = text }
      })
      console.log(`[probe]   leg ${i} geometric pick:`, best ?? '(none)')
    })
  })
})()
