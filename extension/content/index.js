// FoggleBet content script — picktheodds.app overlay
// Injects "Log Bet" buttons on expanded [rowtype="ARBITRAGE"] rows only

console.log('[FoggleBet] content script loaded', window.location.href)

;(function () {
  'use strict'

  // ─── Scraping helpers ──────────────────────────────────────────────────────

  function scrapeRow(row) {
    const warn = (msg) => console.warn('[FoggleBet]', msg)

    // Sport
    const sportEl = row.querySelector('.MuiTypography-sofiaSansHeaderUppercase')
    const sport = sportEl?.textContent?.trim() ?? null
    if (!sport) warn('sport not found')

    // Teams (first two .MuiTypography-body3 elements)
    const teamEls = row.querySelectorAll('.MuiTypography-body3')
    const team1 = teamEls[0]?.textContent?.trim() ?? null
    const team2 = teamEls[1]?.textContent?.trim() ?? null

    // Market — most stable: p[aria-label]
    const marketEl = row.querySelector('p[aria-label]')
    const market = marketEl?.getAttribute('aria-label')?.trim() ?? null
    if (!market) warn('market not found')

    // Game time — two formats
    const gameTime = parseGameTime(row)

    // Arb % — span.MuiTypography-navHeader containing %
    const navHeaders = row.querySelectorAll('span.MuiTypography-navHeader')
    let arbPercent = null
    let arbProfit = null
    for (const el of navHeaders) {
      const text = el.textContent?.trim() ?? ''
      if (text.includes('%')) arbPercent = parseFloat(text.replace('%', '').trim())
      if (text.includes('$')) arbProfit = parseFloat(text.replace('$', '').trim())
    }

    // Legs — find each leg container by locating book-name div[aria-label]s and
    // walking 2 levels up. This works for both US books (<a href> containers) and
    // international books like BookMaker.eu (plain <div> containers with no <a> at all).
    // Spread-value aria-labels like "CHI+32.5" are excluded via the /[+-]\d/ filter.
    // Exclude divs inside <table> — those belong to the expanded book-odds table header,
    // not to the compact leg containers. This prevents rare misidentification (~1/20 bets)
    // when the expanded table's DOM order precedes the compact legs.
    const bookDivs = Array.from(row.querySelectorAll('div[aria-label]'))
      .filter(el => (el.getAttribute('aria-label') ?? '').length > 0)
      .filter(el => !/[+-]\d/.test(el.getAttribute('aria-label') ?? ''))
      .filter(el => !el.closest('table'))
      .slice(0, 2)
    const legs = bookDivs
      .map(div => div.parentElement?.parentElement ?? null)
      .filter(Boolean)
    if (legs.length < 2) warn(`expected 2 leg containers, found ${legs.length}`)

    const legData = []
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i]

      // Book name: use bookDivs[i] directly — do NOT re-query via leg.querySelector which
      // can return a different element if legs[i] is a shared ancestor container.
      const book = bookDivs[i].getAttribute('aria-label')?.trim() ?? null
      if (!book) warn(`leg ${i}: book name not found`)

      // Side + line from span.MuiTypography-body3 (within the <a> tag)
      const sideEl = leg.querySelector('span.MuiTypography-body3')
      const sideLabel = sideEl?.textContent?.trim() ?? null

      // Spread line from sibling element (e.g. "+34.5", "-3"); null for moneylines
      const lineEl = Array.from(sideEl?.parentElement?.children ?? [])
        .find(el => el !== sideEl && /^[+-]\d/.test(el.textContent?.trim() ?? ''))
      const sideLine = lineEl?.textContent?.trim() ?? null

      // Leg href (sportsbook URL)
      const href = leg.getAttribute('href') ?? null

      // img[alt] is the abbreviated book name used as the colMap key in the expanded table
      const bookImgAlt = leg.querySelector('img')?.getAttribute('alt')?.trim() ?? null

      legData.push({ book, bookImgAlt, sideLabel, sideLine, href })
    }

    // Compact leg odds — the real compact odds render as span.MuiTypography-body3 siblings
    // OUTSIDE the leg containers (the ODDS column is a separate flex column, not inside the <a>).
    // We cannot use span.MuiTypography-oddsRobotoMono here: PTO's expanded book-odds table
    // does NOT nest its columns inside a real HTML <table> element, so closest('table') returns
    // null for every span on the page — the !closest('table') filter is a no-op and every
    // expanded table span (BEST, AVERAGE, per-book columns) bleeds through.
    const allRowBody3 = Array.from(row.querySelectorAll('span.MuiTypography-body3'))
    const compactOddsSpans = allRowBody3
      .filter(s => /^[+-]?\d+$/.test(s.textContent?.trim() ?? ''))
      .filter(s => !legs.some(leg => leg?.contains(s)))
    const oddsValues = legData.map((_, i) => {
      const span = compactOddsSpans[i]
      return span ? parseInt((span.textContent?.trim() ?? '').replace('+', ''), 10) : null
    })
    if (compactOddsSpans.length < 2) warn(`expected 2 compact odds body3 spans, found ${compactOddsSpans.length}`)

    // Wager amounts
    const wager0 = row.querySelector('input[type="number"][name="0"]')
    const wager1 = row.querySelector('input[type="number"][name="1"]')

    // Assemble bet name: "team1 vs team2 — market" or just market
    const teams = [team1, team2].filter(Boolean).join(' vs ')
    const betBaseName = [teams, market].filter(Boolean).join(' — ')

    return {
      sport,
      market,
      game_time: gameTime,
      arb_percent: arbPercent,
      arb_profit: arbProfit,
      legs: legData.map((leg, i) => ({
        book: leg.book,
        side_label: leg.sideLabel,
        side_line: leg.sideLine,
        href: leg.href,
        odds: oddsValues[i] ?? null,
        wager: i === 0 ? parseFloat(wager0?.value ?? '0') || null : parseFloat(wager1?.value ?? '0') || null,
        bet_name: leg.sideLabel
          ? `${betBaseName} — ${leg.sideLabel}`
          : betBaseName,
      })),
    }
  }

  function parseGameTime(row) {
    const timeEl = row.querySelector('p.MuiTypography-body2')
    if (!timeEl) return null

    const strongEl = timeEl.querySelector('strong')
    if (strongEl) {
      // Format A: "09:40 PM" — time only, use today's date
      const timeStr = strongEl.textContent?.trim()
      if (timeStr) {
        const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD
        const combined = `${today} ${timeStr}`
        const d = new Date(combined)
        return isNaN(d.getTime()) ? null : d.toISOString()
      }
    } else {
      // Format B: "March 26, 2026 at 04:15 PM"
      const text = timeEl.textContent?.trim()
      if (text) {
        const cleaned = text.replace(' at ', ' ')
        const d = new Date(cleaned)
        return isNaN(d.getTime()) ? null : d.toISOString()
      }
    }
    return null
  }

  // ─── Book odds scraping ────────────────────────────────────────────────────

  // Match a cell0 identifier (team abbreviation or abbreviated player name) to a full side label.
  // Handles two formats:
  //   - Team abbr   "DIJ"           → "JDA Dijon Basket"   (substring / word-prefix match)
  //   - Player abbr "A.Jecan / B.Pavel" → "Jecan A / Pavel B" (last-name extraction after ".")
  function matchCell0LabelToSideLabel(cell0Label, sideLabel) {
    const lCell = cell0Label.toLowerCase().trim()
    const lSide = sideLabel.toLowerCase().trim()
    // Direct: cell0 is a substring of sideLabel, or any word in sideLabel starts with cell0
    if (lSide.includes(lCell) || lSide.split(/\s+/).some(w => w.startsWith(lCell))) return true
    // Abbreviated player names: extract last names after "." and check all appear in sideLabel
    if (lCell.includes('.') || lCell.includes('/')) {
      const lastNames = lCell.split(/\s*\/\s*/).map(part => {
        const dot = part.indexOf('.')
        return dot >= 0 ? part.substring(dot + 1).trim() : part.trim()
      }).filter(ln => ln.length >= 2)
      if (lastNames.length > 0 && lastNames.every(ln => lSide.includes(ln))) return true
    }
    return false
  }

  const TARGET_BOOKS = ['NoVig', 'ProphetX', 'Polymarket (INT)', 'Pinnacle', 'Circa', 'FanDuel', 'Kalshi', 'Polymarket (US)', 'Coinbase']

  function parseDollarAmount(text) {
    if (!text) return null
    const clean = text.replace('$', '').replace(/,/g, '').trim()
    if (clean.endsWith('M')) return Math.round(parseFloat(clean) * 1_000_000)
    if (clean.endsWith('k')) return Math.round(parseFloat(clean) * 1_000)
    const n = parseFloat(clean)
    return isNaN(n) ? null : n
  }

  function isRowExpanded(row) {
    return row.querySelectorAll('span.MuiTypography-oddsRobotoMono').length > 2
  }

  function scrapeBookOdds(row, takenBooks, sideLabels, bookAltMap = {}, sideLines = []) {
    const booksToCapture = [...TARGET_BOOKS]
    for (const b of takenBooks) {
      if (b && !booksToCapture.includes(b)) booksToCapture.push(b)
    }

    const result = {}

    // Find the header table: the table whose first row contains multiple div[aria-label]
    // (book logos). This works regardless of whether they're inside <a> tags.
    const tables = Array.from(row.querySelectorAll('table'))
    let headerTable = null
    let headerRow = null
    for (const table of tables) {
      const firstRow = table.querySelector('tr')
      if (!firstRow) continue
      if (firstRow.querySelectorAll('div[aria-label]').length > 1) {
        headerTable = table
        headerRow = firstRow
        break
      }
    }

    if (!headerTable || !headerRow) {
      console.warn('[FoggleBet] scrapeBookOdds — could not find header table. Tables found:', tables.length)
      return result
    }

    // Build column index map: bookName -> colIndex
    // Try div[aria-label], then img[alt], then img[title]
    const colMap = {}
    Array.from(headerRow.cells).forEach((cell, i) => {
      const raw =
        cell.querySelector('div[aria-label]')?.getAttribute('aria-label')?.trim() ||
        cell.querySelector('img')?.getAttribute('alt')?.trim() ||
        cell.querySelector('img')?.getAttribute('title')?.trim()
      if (raw) colMap[bookAltMap[raw] ?? raw] = i
    })
    console.log('[FoggleBet] scrapeBookOdds — colMap:', colMap)

    // Data rows live in tables other than the header table
    const dataRows = Array.from(row.querySelectorAll('tr'))
      .filter(tr => !headerTable.contains(tr))

    // Reorder sideLabels to match the table's button order.
    // The table renders teams in game order (home/away or alphabetical), which can differ
    // from leg DOM order. ~50% of ML bets are swapped without this correction.
    // Cell 0 always encodes which side is btn[0] vs btn[1]:
    //   - Spreads: aria-labels like "CHI+34.5" — match via the spread value
    //   - Moneylines: aria-labels like "DIJ" or "A.Jecan / B.Pavel" — match via name
    let orderedSideLabels = sideLabels
    if (dataRows.length > 0) {
      const cell0 = dataRows[0].cells[0]
      if (cell0) {
        if (sideLines.some(Boolean)) {
          // ── Spread: use aria-labels that contain a spread value ("CHI+32.5") ──
          const cell0Divs = Array.from(cell0.querySelectorAll('div[aria-label]'))
            .filter(el => /[+-]\d/.test(el.getAttribute('aria-label') ?? ''))
          const lineToLabel = {}
          sideLines.forEach((line, i) => {
            if (line && sideLabels[i]) lineToLabel[line] = sideLabels[i]
          })
          const reordered = cell0Divs.map(div => {
            const ariaLabel = div.getAttribute('aria-label') ?? ''
            const match = ariaLabel.match(/([+-]\d+(?:\.\d+)?)$/)
            return match ? (lineToLabel[match[1]] ?? null) : null
          })
          if (cell0Divs.length >= 2 && reordered.every(l => l !== null)) {
            orderedSideLabels = reordered
            console.log('[FoggleBet] scrapeBookOdds — reordered sideLabels for spread:', orderedSideLabels)
          }
        } else {
          // ── Moneyline / other: use team abbrs or player name abbrs from cell 0 ──
          // Cell 0 has div[aria-label] entries like "DIJ"/"CHO" or "A.Jecan / B.Pavel"
          const cell0Labels = Array.from(cell0.querySelectorAll('div[aria-label]'))
            .map(el => el.getAttribute('aria-label') ?? '')
            .filter(s => s.length > 0)
          if (cell0Labels.length >= 2) {
            const reordered = cell0Labels.map(cell0Label =>
              sideLabels.find(sl => matchCell0LabelToSideLabel(cell0Label, sl)) ?? null
            )
            // Only apply if all positions resolved to distinct side labels
            const allResolved = reordered.length >= 2 && reordered.every(l => l !== null)
            const allDistinct = new Set(reordered).size === reordered.length
            if (allResolved && allDistinct) {
              orderedSideLabels = reordered
              console.log('[FoggleBet] scrapeBookOdds — reordered sideLabels for ML:', orderedSideLabels)
            } else {
              console.warn('[FoggleBet] scrapeBookOdds — ML cell0 reorder failed, keeping leg order', { cell0Labels, sideLabels, reordered })
            }
          }
        }
      }
    }

    for (const bookName of booksToCapture) {
      const colIndex = colMap[bookName]
      if (colIndex === undefined) {
        console.log(`[FoggleBet] scrapeBookOdds — "${bookName}" not in colMap`)
        continue
      }

      const sides = {}

      for (const dataRow of dataRows) {
        const oddsCell = dataRow.cells[colIndex]
        if (!oddsCell) continue

        // Each cell has one div[role="button"] per side, in order (btn[0]=side0, btn[1]=side1).
        // Buttons showing "-" have no odds span — skip them but preserve index for side mapping.
        const sideButtons = Array.from(oddsCell.querySelectorAll('div[role="button"]'))
        sideButtons.forEach((btn, sideIdx) => {
          const oddsSpan = btn.querySelector('span.MuiTypography-oddsRobotoMono')
          if (!oddsSpan) return

          const sideKey = orderedSideLabels[sideIdx] ?? `side_${sideIdx}`
          const oddsText = oddsSpan.textContent?.trim()
          const odds = oddsText ? parseInt(oddsText.replace('+', ''), 10) : null
          const entry = { odds }

          const liqSpan = Array.from(btn.querySelectorAll('span'))
            .find(s => s !== oddsSpan && s.textContent.trim().startsWith('$'))
          if (liqSpan) {
            const liquidity = parseDollarAmount(liqSpan.textContent.trim())
            if (liquidity !== null) entry.liquidity = liquidity
          }

          sides[sideKey] = entry
        })
      }

      if (Object.keys(sides).length > 0) result[bookName] = sides
    }

    return result
  }

  // ─── UI helpers ────────────────────────────────────────────────────────────

  const ROW_ATTR = 'data-fogglebet-injected'
  const rowButtons = new Map()

  // rAF loop: only needed to clean up buttons whose rows have been removed from the DOM
  function updateAllPositions() {
    for (const [row, btn] of rowButtons.entries()) {
      if (!document.body.contains(row) && !btn.disabled) {
        btn.remove()
        rowButtons.delete(row)
      }
    }
    requestAnimationFrame(updateAllPositions)
  }
  updateAllPositions()

  function injectButton(row) {
    if (row.hasAttribute(ROW_ATTR)) return
    row.setAttribute(ROW_ATTR, 'true')

    // Button lives inside the row so it scrolls with it naturally
    if (getComputedStyle(row).position === 'static') row.style.position = 'relative'

    const btn = document.createElement('button')
    btn.textContent = 'Log Bet'
    btn.style.cssText = `
      position: absolute;
      left: 50%;
      top: 5px;
      transform: translateX(-50%);
      z-index: 99998;
      background: linear-gradient(135deg, #060e2b 0%, #0f1f5c 100%);
      color: #fff;
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 8px;
      padding: 6px 14px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      font-family: system-ui, sans-serif;
      line-height: 1.4;
      letter-spacing: 0.02em;
      box-shadow: 0 2px 8px rgba(37,99,235,0.35);
      white-space: nowrap;
    `
    btn.addEventListener('mouseenter', () => {
      if (!btn.disabled) btn.style.background = 'linear-gradient(135deg, #0a1435 0%, #0f1f5c 100%)'
    })
    btn.addEventListener('mouseleave', () => {
      if (!btn.disabled) btn.style.background = 'linear-gradient(135deg, #060e2b 0%, #0f1f5c 100%)'
    })
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      handleLogClick(row, btn).catch(err => {
        console.error('[FoggleBet] handleLogClick error:', err)
        setButtonState(btn, 'error')
      })
    })

    row.appendChild(btn)
    rowButtons.set(row, btn)
  }

  function setButtonState(btn, state) {
    if (state === 'loading') {
      btn.textContent = '...'
      btn.style.background = '#4b5563'
      btn.style.borderColor = 'rgba(255,255,255,0.15)'
      btn.style.boxShadow = 'none'
      btn.disabled = true
    } else if (state === 'success') {
      btn.textContent = '✓ Logged'
      btn.style.background = '#16a34a'
      btn.style.borderColor = 'rgba(255,255,255,0.2)'
      btn.style.boxShadow = '0 2px 8px rgba(22,163,74,0.35)'
      btn.disabled = false
      setTimeout(() => resetButton(btn), 3000)
    } else if (state === 'error') {
      btn.textContent = '✗ Error'
      btn.style.background = 'linear-gradient(135deg, #1f0a0a 0%, #5c0f0f 100%)'
      btn.style.borderColor = '#ef4444'
      btn.style.boxShadow = '0 2px 8px rgba(239,68,68,0.35)'
      btn.disabled = false
      setTimeout(() => resetButton(btn), 4000)
    } else if (state === 'duplicate') {
      btn.textContent = 'Already Logged'
      btn.style.background = 'linear-gradient(135deg, #1a1000 0%, #5c3800 100%)'
      btn.style.borderColor = '#f59e0b'
      btn.style.boxShadow = '0 2px 8px rgba(245,158,11,0.35)'
      btn.disabled = false
      setTimeout(() => resetButton(btn), 4000)
    }
  }

  function resetButton(btn) {
    btn.textContent = 'Log Bet'
    btn.style.background = 'linear-gradient(135deg, #060e2b 0%, #0f1f5c 100%)'
    btn.style.borderColor = 'rgba(255,255,255,0.2)'
    btn.style.boxShadow = '0 2px 8px rgba(37,99,235,0.35)'
    btn.disabled = false
  }

  // ─── Purpose picker modal (taken vs training) ─────────────────────────────

  function showPurposePicker(arbData, onPurpose) {
    const overlay = document.createElement('div')
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
    `

    const modal = document.createElement('div')
    modal.style.cssText = `
      background: #1a1a2e;
      border: 1px solid #2d2d4e;
      border-radius: 8px;
      padding: 20px 24px;
      width: 340px;
      font-family: system-ui, sans-serif;
      color: #e5e5e5;
    `

    const title = document.createElement('h3')
    title.textContent = 'How are you logging this?'
    title.style.cssText = 'margin: 0 0 6px; font-size: 15px; color: #fff;'

    const subtitle = document.createElement('p')
    const market = arbData.market ?? ''
    subtitle.textContent = market || (arbData.legs[0]?.bet_name?.split('—')[0]?.trim() ?? '')
    subtitle.style.cssText = 'margin: 0 0 16px; font-size: 12px; color: #9ca3af;'

    const btnRow = document.createElement('div')
    btnRow.style.cssText = 'display: flex; gap: 10px;'

    const choices = [
      { label: 'Taking this bet', sub: 'Pick which side you\'re on', value: 'taken', color: '#2563eb' },
      { label: 'Log for training', sub: 'Record both sides for the model', value: 'training', color: '#059669' },
    ]

    choices.forEach(({ label, sub, value, color }) => {
      const btn = document.createElement('button')
      btn.style.cssText = `
        flex: 1;
        background: #0f172a;
        border: 1px solid #334155;
        border-radius: 6px;
        padding: 12px 8px;
        cursor: pointer;
        color: #e5e5e5;
        font-family: system-ui, sans-serif;
        text-align: left;
      `

      const labelEl = document.createElement('div')
      labelEl.textContent = label
      labelEl.style.cssText = 'font-size: 13px; font-weight: 600; margin-bottom: 4px;'

      const subEl = document.createElement('div')
      subEl.textContent = sub
      subEl.style.cssText = 'font-size: 11px; color: #9ca3af; line-height: 1.4;'

      btn.appendChild(labelEl)
      btn.appendChild(subEl)

      btn.addEventListener('mouseenter', () => { btn.style.borderColor = color })
      btn.addEventListener('mouseleave', () => { btn.style.borderColor = '#334155' })
      btn.addEventListener('click', () => {
        document.body.removeChild(overlay)
        onPurpose(value)
      })

      btnRow.appendChild(btn)
    })

    const cancelBtn = document.createElement('button')
    cancelBtn.textContent = 'Cancel'
    cancelBtn.style.cssText = `
      margin-top: 12px;
      background: none;
      border: none;
      color: #6b7280;
      font-size: 12px;
      cursor: pointer;
      width: 100%;
      font-family: system-ui, sans-serif;
    `
    cancelBtn.addEventListener('click', () => { document.body.removeChild(overlay) })

    modal.appendChild(title)
    modal.appendChild(subtitle)
    modal.appendChild(btnRow)
    modal.appendChild(cancelBtn)
    overlay.appendChild(modal)
    document.body.appendChild(overlay)
  }

  // ─── Side-picker modal ────────────────────────────────────────────────────

  // onSelect(sideIndex)
  function showSidePicker(arbData, onSelect) {
    const overlay = document.createElement('div')
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
    `

    const modal = document.createElement('div')
    modal.style.cssText = `
      background: #1a1a2e;
      border: 1px solid #2d2d4e;
      border-radius: 8px;
      padding: 20px 24px;
      width: 380px;
      font-family: system-ui, sans-serif;
      color: #e5e5e5;
    `

    const title = document.createElement('h3')
    title.textContent = 'Which side are you taking?'
    title.style.cssText = 'margin: 0 0 6px; font-size: 15px; color: #fff;'

    const subtitle = document.createElement('p')
    subtitle.textContent = arbData.legs[0]?.bet_name?.split('—')[0]?.trim() ?? ''
    subtitle.style.cssText = 'margin: 0 0 16px; font-size: 12px; color: #9ca3af;'

    const btnRow = document.createElement('div')
    btnRow.style.cssText = 'display: flex; gap: 10px;'

    arbData.legs.forEach((leg, i) => {
      const sideBtn = document.createElement('button')
      sideBtn.style.cssText = `
        flex: 1;
        background: #0f172a;
        border: 1px solid #334155;
        border-radius: 6px;
        padding: 10px 8px;
        cursor: pointer;
        color: #e5e5e5;
        font-family: system-ui, sans-serif;
        text-align: left;
      `

      const bookLine = document.createElement('div')
      bookLine.textContent = leg.book ?? `Side ${i + 1}`
      bookLine.style.cssText = 'font-size: 13px; font-weight: 600; margin-bottom: 3px;'

      const sideLine = document.createElement('div')
      sideLine.textContent = leg.side_label ?? '—'
      sideLine.style.cssText = 'font-size: 12px; color: #9ca3af; margin-bottom: 3px;'

      const oddsLine = document.createElement('div')
      oddsLine.textContent = leg.odds != null ? (leg.odds > 0 ? `+${leg.odds}` : `${leg.odds}`) : '—'
      oddsLine.style.cssText = 'font-size: 14px; font-weight: 700; color: #60a5fa;'

      sideBtn.appendChild(bookLine)
      sideBtn.appendChild(sideLine)
      sideBtn.appendChild(oddsLine)

      sideBtn.addEventListener('mouseenter', () => { sideBtn.style.borderColor = '#2563eb' })
      sideBtn.addEventListener('mouseleave', () => { sideBtn.style.borderColor = '#334155' })
      sideBtn.addEventListener('click', () => {
        document.body.removeChild(overlay)
        onSelect(i)
      })

      btnRow.appendChild(sideBtn)
    })

    const cancelBtn = document.createElement('button')
    cancelBtn.textContent = 'Cancel'
    cancelBtn.style.cssText = `
      margin-top: 12px;
      background: none;
      border: none;
      color: #6b7280;
      font-size: 12px;
      cursor: pointer;
      width: 100%;
      font-family: system-ui, sans-serif;
    `
    cancelBtn.addEventListener('click', () => { document.body.removeChild(overlay) })

    modal.appendChild(title)
    modal.appendChild(subtitle)
    modal.appendChild(btnRow)
    modal.appendChild(cancelBtn)
    overlay.appendChild(modal)
    document.body.appendChild(overlay)
  }

  // ─── Stake picker modal ───────────────────────────────────────────────────

  function showStakePicker(leg, defaultStake, onConfirm) {
    const overlay = document.createElement('div')
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
    `

    const modal = document.createElement('div')
    modal.style.cssText = `
      background: #1a1a2e;
      border: 1px solid #2d2d4e;
      border-radius: 8px;
      padding: 20px 24px;
      width: 300px;
      font-family: system-ui, sans-serif;
      color: #e5e5e5;
    `

    const title = document.createElement('h3')
    title.textContent = 'How much are you taking?'
    title.style.cssText = 'margin: 0 0 4px; font-size: 15px; color: #fff;'

    const subtitle = document.createElement('p')
    subtitle.textContent = `${leg.book ?? ''} · ${leg.side_label ?? ''} · ${leg.odds > 0 ? '+' : ''}${leg.odds ?? '—'}`
    subtitle.style.cssText = 'margin: 0 0 16px; font-size: 12px; color: #9ca3af;'

    const inputRow = document.createElement('div')
    inputRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 14px;'

    const prefix = document.createElement('span')
    prefix.textContent = '$'
    prefix.style.cssText = 'font-size: 14px; color: #9ca3af;'

    const input = document.createElement('input')
    input.type = 'number'
    input.min = '1'
    input.max = '100'
    input.value = String(defaultStake)
    input.style.cssText = `
      flex: 1;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 4px;
      padding: 6px 10px;
      font-size: 15px;
      font-family: system-ui, sans-serif;
      color: #fff;
      outline: none;
      text-align: center;
    `
    input.addEventListener('focus', () => { input.style.borderColor = '#2563eb'; input.select() })
    input.addEventListener('blur', () => { input.style.borderColor = '#334155' })

    inputRow.appendChild(prefix)
    inputRow.appendChild(input)

    const confirmBtn = document.createElement('button')
    confirmBtn.textContent = 'Log Bet'
    confirmBtn.style.cssText = `
      width: 100%;
      background: linear-gradient(135deg, #060e2b 0%, #0f1f5c 100%);
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 6px;
      padding: 9px;
      font-size: 13px;
      font-weight: 600;
      color: #fff;
      cursor: pointer;
      font-family: system-ui, sans-serif;
    `
    confirmBtn.addEventListener('mouseenter', () => { confirmBtn.style.background = 'linear-gradient(135deg, #0a1435 0%, #0f1f5c 100%)' })
    confirmBtn.addEventListener('mouseleave', () => { confirmBtn.style.background = 'linear-gradient(135deg, #060e2b 0%, #0f1f5c 100%)' })

    const submit = () => {
      const raw = parseFloat(input.value)
      const stake = isNaN(raw) || raw <= 0 ? 100 : Math.min(raw, 100)
      document.body.removeChild(overlay)
      onConfirm(stake)
    }

    confirmBtn.addEventListener('click', submit)
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit() })

    const cancelBtn = document.createElement('button')
    cancelBtn.textContent = 'Cancel'
    cancelBtn.style.cssText = `
      margin-top: 8px;
      background: none;
      border: none;
      color: #6b7280;
      font-size: 12px;
      cursor: pointer;
      width: 100%;
      font-family: system-ui, sans-serif;
    `
    cancelBtn.addEventListener('click', () => { document.body.removeChild(overlay) })

    modal.appendChild(title)
    modal.appendChild(subtitle)
    modal.appendChild(inputRow)
    modal.appendChild(confirmBtn)
    modal.appendChild(cancelBtn)
    overlay.appendChild(modal)
    document.body.appendChild(overlay)

    // Auto-focus and select so user can type immediately
    setTimeout(() => { input.focus(); input.select() }, 50)
  }

  // ─── Cell 0 spread extractor ─────────────────────────────────────────────
  // Fallback for spread bets where sideLine is null in the compact leg view
  // (e.g. NCAAB). Cell 0 aria-labels like "ARI+6.5" encode team + spread.

  function extractSpreadsFromCell0(row, sideLabels) {
    const result = sideLabels.map(() => null)

    // Find the header table (same heuristic as scrapeBookOdds)
    const tables = Array.from(row.querySelectorAll('table'))
    let headerTable = null
    for (const table of tables) {
      const firstRow = table.querySelector('tr')
      if (firstRow && firstRow.querySelectorAll('div[aria-label]').length > 1) {
        headerTable = table
        break
      }
    }
    if (!headerTable) return result

    const dataRows = Array.from(row.querySelectorAll('tr'))
      .filter(tr => !headerTable.contains(tr))
    if (dataRows.length === 0) return result

    const cell0 = dataRows[0].cells[0]
    if (!cell0) return result

    // Plain divs in cell 0 have aria-labels like "ARI+6.5" or "PUR-4.5"
    const parsed = Array.from(cell0.querySelectorAll('div[aria-label]'))
      .map(el => {
        const raw = el.getAttribute('aria-label') ?? ''
        const m = raw.match(/^([A-Za-z]+)([+-]\d+(?:\.\d+)?)$/)
        return m ? { abbr: m[1].toLowerCase(), spread: m[2] } : null
      })
      .filter(Boolean)

    if (parsed.length < 2) return result

    // Match each sideLabel to a parsed entry by abbreviation prefix
    // "ARI" → "Arizona" (arizona.startsWith("ari"))
    // "PUR" → "Purdue"  (purdue.startsWith("pur"))
    sideLabels.forEach((label, i) => {
      const lNorm = label.toLowerCase()
      for (const { abbr, spread } of parsed) {
        if (lNorm.startsWith(abbr) || lNorm.split(/\s+/).some(w => w.startsWith(abbr))) {
          result[i] = spread
          break
        }
      }
    })

    return result
  }

  // ─── Book-odds side-order validator ──────────────────────────────────────
  // For moneylines the expanded table renders buttons in game order (home/away),
  // which can differ from the compact leg DOM order. Spreads are corrected by the
  // cell-0 aria-label reorder logic; moneylines have no equivalent. This function
  // uses the compact odds (captured before enrichment) as ground truth: if
  // book_odds[leg0.book][leg0.side] doesn't match compact0 but [leg1.side] does,
  // the sides are swapped — swap the side keys across all books.

  function fixBookOddsSideOrder(book_odds, legs, compactOdds) {
    if (legs.length < 2) return book_odds
    const side0 = legs[0].side_label
    const side1 = legs[1].side_label
    if (!side0 || !side1 || side0 === side1) return book_odds

    const refBook = legs[0].book
    if (!refBook || !book_odds[refBook]) return book_odds

    const compact0 = compactOdds[0]
    if (compact0 == null) return book_odds

    const refOdds0 = book_odds[refBook][side0]?.odds
    const refOdds1 = book_odds[refBook][side1]?.odds

    if (refOdds0 == null) return book_odds
    if (refOdds0 === compact0) return book_odds      // already correct
    if (refOdds1 !== compact0) return book_odds      // swap wouldn't fix it

    console.log('[FoggleBet] fixBookOddsSideOrder — swapping sides', { side0, side1, compact0, refOdds0 })

    const fixed = {}
    for (const [book, sides] of Object.entries(book_odds)) {
      fixed[book] = {}
      if (sides[side1] !== undefined) fixed[book][side0] = sides[side1]
      if (sides[side0] !== undefined) fixed[book][side1] = sides[side0]
      for (const [s, v] of Object.entries(sides)) {
        if (s !== side0 && s !== side1) fixed[book][s] = v
      }
    }
    return fixed
  }

  // ─── Log click handler ────────────────────────────────────────────────────

  async function handleLogClick(row, btn) {
    const arbData = scrapeRow(row)

    if (arbData.legs.length < 2) {
      console.error('[FoggleBet] Could not find 2 legs in this row')
      setButtonState(btn, 'error')
      return
    }

    // Scrape book odds before showing any modal
    const takenBooks = arbData.legs.map(l => l.book).filter(Boolean)
    const sideLabels = arbData.legs.map((l, i) => l.side_label ?? `side_${i}`)
    const sideLines = arbData.legs.map(l => l.side_line ?? null)
    const bookAltMap = Object.fromEntries(
      arbData.legs.filter(l => l.bookImgAlt && l.book).map(l => [l.bookImgAlt, l.book])
    )

    // Fallback: for spread bets where sideLine is absent in the compact leg view
    // (e.g. NCAAB), extract spread from expanded table cell 0 aria-labels.
    // Must happen before scrapeBookOdds so it can reorder sides correctly.
    if (arbData.market?.toLowerCase().includes('spread') && !sideLines.some(Boolean)) {
      const tableSpreads = extractSpreadsFromCell0(row, sideLabels)
      if (tableSpreads.some(Boolean)) {
        tableSpreads.forEach((spread, i) => {
          if (spread) {
            sideLines[i] = spread
            arbData.legs[i].side_line = spread
          }
        })
        console.log('[FoggleBet] extracted sideLines from cell0:', sideLines)
      }
    }

    arbData.book_odds = scrapeBookOdds(row, takenBooks, sideLabels, bookAltMap, sideLines)
    console.log('[FoggleBet] book_odds:', JSON.stringify(arbData.book_odds))

    // Validate and fix book_odds side ordering using compact odds as ground truth.
    // Must run before enrichment so we don't overwrite correct compact odds with swapped values.
    const compactOdds = arbData.legs.map(l => l.odds)
    arbData.book_odds = fixBookOddsSideOrder(arbData.book_odds, arbData.legs, compactOdds)

    // Enrich each leg's odds + liquidity from book_odds
    arbData.legs = arbData.legs.map((leg, i) => {
      const bookSides = arbData.book_odds[leg.book] ?? {}
      const sideData = bookSides[leg.side_label] ?? null
      return {
        ...leg,
        odds: sideData?.odds ?? leg.odds,
        liquidity: sideData?.liquidity ?? null,
      }
    })

    // Step 1: ask taken vs training
    showPurposePicker(arbData, (purpose) => {
      if (purpose === 'training') {
        postBets(btn, arbData, /* takenIndex */ null, /* isTraining */ true)
      } else {
        // Step 2: pick which side, then confirm stake for that side
        showSidePicker(arbData, (takenIndex) => {
          const takenLeg = arbData.legs[takenIndex]
          const defaultStake = takenLeg.liquidity ? Math.min(takenLeg.liquidity, 100) : 100
          showStakePicker(takenLeg, defaultStake, (stake) => {
            postBets(btn, arbData, takenIndex, /* isTraining */ true, stake)
          })
        })
      }
    })
  }

  function postBets(btn, arbData, takenIndex, isTraining, takenStake) {
    setButtonState(btn, 'loading')

    const arb_id = crypto.randomUUID()
    const source_url = window.location.href

    const payload = arbData.legs.map((leg, i) => {
      const fullOdds = arbData.book_odds ?? {}
      const legSideLabel = leg.side_label ?? `side_${i}`
      const legBookOdds = Object.fromEntries(
        Object.entries(fullOdds)
          .map(([book, sides]) => {
            const sideData = sides[legSideLabel] ?? null
            return sideData ? [book, { [legSideLabel]: sideData }] : null
          })
          .filter(Boolean)
      )

      return {
        arb_id,
        is_taken: takenIndex !== null ? i === takenIndex : false,
        is_training: isTraining,
        game_time: arbData.game_time,
        bet_name: leg.bet_name,
        sport: arbData.sport,
        market: arbData.market,
        // For spread bets: combine "Purdue" + "-4.5" → "Purdue -4.5" so the cron can resolve it.
        // For totals/props/moneylines: side_line is null, so just use side_label ("Over 220.5", "Warriors").
        line: leg.side_line
          ? `${leg.side_label ?? ''} ${leg.side_line}`.trim()
          : leg.side_label ?? null,
        book: leg.book ?? 'Unknown',
        odds: leg.odds ?? 0,
        liquidity: leg.liquidity ?? null,
        ev_percent: null,
        arb_percent: arbData.arb_percent,
        book_odds: Object.keys(legBookOdds).length > 0 ? legBookOdds : null,
        stake: takenIndex !== null && i === takenIndex ? (takenStake ?? 100) : 1,
        source_url,
      }
    })

    chrome.runtime.sendMessage({ type: 'POST_BETS', payload }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[FoggleBet] Runtime error:', chrome.runtime.lastError.message)
        setButtonState(btn, 'error')
        return
      }
      if (response?.ok) {
        setButtonState(btn, 'success')
      } else if (response?.duplicate) {
        setButtonState(btn, 'duplicate')
      } else {
        console.error('[FoggleBet] API error:', response?.error)
        setButtonState(btn, 'error')
      }
    })
  }

  // ─── Row detection ────────────────────────────────────────────────────────

  function findArbRows() {
    const seen = new Set()
    const rows = []
    document.querySelectorAll('span.MuiTypography-navHeader').forEach(el => {
      let node = el.parentElement
      for (let i = 0; i < 12; i++) {
        if (!node || node === document.body) break
        if (node.querySelectorAll('div[aria-label]').length >= 2) {
          if (!seen.has(node)) {
            seen.add(node)
            rows.push(node)
          }
          break
        }
        node = node.parentElement
      }
    })
    return rows
  }

  // ─── Row injection + MutationObserver ─────────────────────────────────────

  function injectAllRows() {
    for (const row of findArbRows()) {
      if (isRowExpanded(row)) {
        injectButton(row)
      }
    }
  }

  injectAllRows()

  setInterval(injectAllRows, 500)

  const observer = new MutationObserver(injectAllRows)
  observer.observe(document.body, { childList: true, subtree: true })
})()
