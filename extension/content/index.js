// FoggleBet content script — picktheodds.app overlay
// Injects "Log Arb" buttons on each [rowtype="ARBITRAGE"] row

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

    // Legs — each leg is an <a> tag
    const legs = row.querySelectorAll('a[href]')
    if (legs.length < 2) warn(`expected 2 leg <a> tags, found ${legs.length}`)

    const legData = []
    for (let i = 0; i < Math.min(legs.length, 2); i++) {
      const leg = legs[i]

      // Book name from div[aria-label] inside the <a>
      const bookDiv = leg.querySelector('div[aria-label]')
      const book = bookDiv?.getAttribute('aria-label')?.trim() ?? null
      if (!book) warn(`leg ${i}: book name not found`)

      // Side + line from span.MuiTypography-label
      const sideEl = leg.querySelector('span.MuiTypography-label')
      const sideLabel = sideEl?.textContent?.trim() ?? null

      // Leg href (sportsbook URL)
      const href = leg.getAttribute('href') ?? null

      legData.push({ book, sideLabel, href })
    }

    // Liquidity — input[type="number"] labelled for exchanges (TBD selector)
    // Leg odds — spans are siblings to the <a> tags, not inside them
    const oddsSpans = row.querySelectorAll('span.MuiTypography-oddsRobotoMono')
    const oddsValues = Array.from(oddsSpans).map(el => {
      const text = el.textContent?.trim()
      return text ? parseInt(text.replace('+', ''), 10) : null
    })
    if (oddsValues.length < 2) warn(`expected 2 odds spans, found ${oddsValues.length}`)

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

  // ─── UI helpers ────────────────────────────────────────────────────────────

  const ROW_ATTR = 'data-fogglebet-injected'

  function injectButton(row) {
    if (row.hasAttribute(ROW_ATTR)) return // already injected
    row.setAttribute(ROW_ATTR, 'true')
    console.log('[FoggleBet] injecting button into row')

    // Button lives inside the row so it moves with it — no JS position tracking needed
    if (getComputedStyle(row).position === 'static') row.style.position = 'relative'

    const btn = document.createElement('button')
    btn.textContent = 'Log Arb'
    btn.style.cssText = `
      position: absolute;
      top: 5px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 99998;
      background: linear-gradient(135deg, #0f1f5c 0%, #1e3a8a 100%);
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
    `
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'linear-gradient(135deg, #172554 0%, #1e3a8a 100%)'
    })
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'linear-gradient(135deg, #0f1f5c 0%, #1e3a8a 100%)'
    })
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      handleLogClick(row, btn)
    })

    row.appendChild(btn)
  }

  // Check for new rows every 500ms (new arbs appearing, layout changes)
  setInterval(injectAllRows, 500)

  function setButtonState(btn, state) {
    if (state === 'loading') {
      btn.textContent = '...'
      btn.style.background = '#4b5563'
      btn.disabled = true
    } else if (state === 'success') {
      btn.textContent = '✓ Logged'
      btn.style.background = '#16a34a'
      btn.disabled = false
      setTimeout(() => resetButton(btn), 3000)
    } else if (state === 'error') {
      btn.textContent = '✗ Error'
      btn.style.background = '#dc2626'
      btn.disabled = false
      setTimeout(() => resetButton(btn), 4000)
    }
  }

  function resetButton(btn) {
    btn.textContent = 'Log Arb'
    btn.style.background = 'linear-gradient(135deg, #0f1f5c 0%, #1e3a8a 100%)'
    btn.disabled = false
  }

  // ─── Side-picker modal ────────────────────────────────────────────────────

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
        onSelect(i) // index of taken side
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

  // ─── Log click handler ────────────────────────────────────────────────────

  function handleLogClick(row, btn) {
    const arbData = scrapeRow(row)

    if (arbData.legs.length < 2) {
      console.error('[FoggleBet] Could not find 2 legs in this row')
      setButtonState(btn, 'error')
      return
    }

    showSidePicker(arbData, async (takenIndex) => {
      setButtonState(btn, 'loading')

      const arb_id = crypto.randomUUID()
      const source_url = window.location.href

      const payload = arbData.legs.map((leg, i) => ({
        arb_id,
        is_taken: i === takenIndex,
        game_time: arbData.game_time,
        bet_name: leg.bet_name,
        sport: arbData.sport,
        market: arbData.market,
        line: leg.side_label ?? null,
        book: leg.book ?? 'Unknown',
      odds: leg.odds ?? 0,
        liquidity: leg.liquidity ?? null,
        ev_percent: null, // not scraped at row level
        arb_percent: arbData.arb_percent,
        stake: 1,
        source_url,
      }))

      chrome.runtime.sendMessage({ type: 'POST_BETS', payload }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[FoggleBet] Runtime error:', chrome.runtime.lastError.message)
          setButtonState(btn, 'error')
          return
        }
        if (response?.ok) {
          setButtonState(btn, 'success')
        } else {
          console.error('[FoggleBet] API error:', response?.error)
          setButtonState(btn, 'error')
        }
      })
    })
  }

  // ─── Row detection (works in both narrow and wide layouts) ───────────────

  function findArbRows() {
    // Identify rows by content: nearest ancestor of the arb %/$ header
    // that contains at least 2 book name elements. Works in all layouts.
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
    const rows = findArbRows()
    rows.forEach(injectButton)
  }

  // Initial injection
  injectAllRows()

  // Watch for SPA re-renders — picktheodds dynamically adds/removes rows
  const observer = new MutationObserver(() => {
    injectAllRows()
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  })
})()
