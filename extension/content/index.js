// FoggleBet content script — picktheodds.app overlay
// Take-only paper trading: injects "Take" buttons on Kalshi legs of expanded
// rows. Clicking one picks an edge (1/3/5/7/9%) and places a price-capped IOC
// order on Kalshi DEMO via the FoggleBet web app.

console.log(
  `[FoggleBet] content script v${chrome.runtime.getManifest().version} loaded`,
  window.location.href
)

;(function () {
  'use strict'

  // ─── Kelly settings (bankroll + fraction) ──────────────────────────────────
  // Editable from the on-page panel (bottom-right of the odds screen) and the
  // extension popup. Persisted in chrome.storage.local.

  const DEFAULT_BANKROLL = 50000
  const DEFAULT_KELLY_FRACTION = 0.25
  let bankroll = DEFAULT_BANKROLL
  let kellyFraction = DEFAULT_KELLY_FRACTION

  // Kelly fraction is stored as a fraction (0.25) but shown/edited as a
  // percentage (25%) — that's how the user thinks about it.
  // Round on the way out: 0.07 * 100 is 7.000000000000001 in floating point.
  function kellyPct() {
    return Math.round(kellyFraction * 1000) / 10
  }

  function fractionLabel() {
    const pct = kellyPct()
    return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`
  }

  function applySettings(changes) {
    let touched = false
    if (typeof changes.bankroll === 'number' && changes.bankroll > 0) {
      bankroll = changes.bankroll
      touched = true
    }
    if (typeof changes.kellyFraction === 'number' && changes.kellyFraction > 0 && changes.kellyFraction <= 1) {
      kellyFraction = changes.kellyFraction
      touched = true
    }
    if (touched) {
      updateSettingsPill()
      syncSettingsEditor()
    }
  }

  // Assigned when the settings panel is built; no-op until then.
  let syncSettingsEditor = () => {}

  chrome.storage.local.get(['bankroll', 'kellyFraction'], (stored) => {
    applySettings({ bankroll: stored.bankroll, kellyFraction: stored.kellyFraction })
  })

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    applySettings({
      bankroll: changes.bankroll?.newValue,
      kellyFraction: changes.kellyFraction?.newValue,
    })
  })

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

  function isRowExpanded(row) {
    return row.querySelectorAll('span.MuiTypography-oddsRobotoMono').length > 2
  }

  // ─── Kelly stake sizing ────────────────────────────────────────────────────
  // Only used for the confirmation subtitle; the server recomputes sizing and
  // caps by orderbook liquidity before placing.

  function kellyStake(odds, edge) {
    const b = odds > 0 ? odds / 100 : 100 / Math.abs(odds)
    const stake = (bankroll * edge * kellyFraction) / b
    return Math.max(1, Math.round(stake))
  }

  // ─── Leg + odds extraction ─────────────────────────────────────────────────

  // PTO sprinkles zero-width chars into text nodes and may use a Unicode
  // minus; neither survives a plain trim(), so odds regexes miss without this.
  function normOdds(s) {
    return (s ?? '')
      .replace(/[​-‍﻿]/g, '')
      .replace(/−/g, '-')
      .trim()
  }

  // Warn once per row per reason so the 500ms loop doesn't spam the console
  function warnOnce(row, reason) {
    const seen = row.dataset.fbWarned ?? ''
    if (seen.includes(reason)) return
    row.dataset.fbWarned = `${seen}|${reason}`
    console.warn('[FoggleBet]', reason)
  }

  // Leg containers: book-name divs → 2 levels up. Works for <a href> legs (US
  // books) and plain <div> legs (some international books).
  function findLegs(row) {
    const bookDivs = Array.from(row.querySelectorAll('div[aria-label]'))
      .filter(el => (el.getAttribute('aria-label') ?? '').length > 0)
      .filter(el => !/[+-]\d/.test(el.getAttribute('aria-label') ?? ''))
      .filter(el => !el.closest('table'))
      .slice(0, 2)
    const legs = bookDivs
      .map(div => div.parentElement?.parentElement ?? null)
      .filter(Boolean)
    if (legs.length < 2 || legs[0] === legs[1]) return null
    return { bookDivs, legs }
  }

  // Find the odds paired with a leg: the odds-shaped value whose vertical
  // center lines up with the leg box, nearest to its right edge. Search is
  // scoped to the smallest subtree containing both legs (the MONEYLINE block)
  // — an expanded row also contains the book-odds table (~6800px wide, 140+
  // odds values) which would otherwise swamp the match.
  //
  // Collapsed rows render odds as a text span; EXPANDED rows swap in an
  // <input> (PTO lets you edit odds there), whose textContent is empty — so
  // inputs must be read via .value or expanded rows find nothing.
  function legOddsFinder(legs) {
    let scope = legs[0]
    while (scope && !scope.contains(legs[1])) scope = scope.parentElement
    if (!scope) scope = document.body

    return function legOdds(leg) {
      const r = leg.getBoundingClientRect()
      let best = null
      let bestDist = Infinity
      for (const el of scope.querySelectorAll('input, span, p, div')) {
        if (legs.some(l => l.contains(el))) continue
        const isInput = el.tagName === 'INPUT'
        if (!isInput && el.childElementCount !== 0) continue
        const text = normOdds(isInput ? el.value : el.textContent)
        if (!/^[+-]\d{2,4}$/.test(text)) continue
        const c = el.getBoundingClientRect()
        if (c.width === 0) continue
        const mid = (c.top + c.bottom) / 2
        if (mid < r.top - 4 || mid > r.bottom + 4) continue
        const dist = Math.abs(c.left - r.right)
        if (dist < bestDist) {
          bestDist = dist
          best = text
        }
      }
      return best ? parseInt(best.replace('+', ''), 10) : NaN
    }
  }

  // Kalshi market ticker from the leg's sportsbook link, e.g.
  // https://kalshi.com/markets/kx/pro/KXWTAMATCH-...?marketTicker=KXWTAMATCH-...-LIN
  function kalshiTicker(leg) {
    const a = leg.tagName === 'A' ? leg : (leg.closest('a') ?? leg.querySelector('a[href]'))
    const href = a?.getAttribute('href')
    if (!href) return null
    try {
      return new URL(href, window.location.href).searchParams.get('marketTicker')
    } catch {
      return null
    }
  }

  // ─── Edge picker modal (1/3/5/7/9%) ────────────────────────────────────────

  const EDGE_OPTIONS = [1, 3, 5, 7, 9]

  function showEdgePicker(context, onEdge) {
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
      width: 400px;
      font-family: system-ui, sans-serif;
      color: #e5e5e5;
    `

    const title = document.createElement('h3')
    title.textContent = 'How confident are you?'
    title.style.cssText = 'margin: 0 0 6px; font-size: 15px; color: #fff;'

    const subtitle = document.createElement('p')
    subtitle.textContent = context
    subtitle.style.cssText = 'margin: 0 0 16px; font-size: 12px; color: #9ca3af;'

    const btnRow = document.createElement('div')
    btnRow.style.cssText = 'display: flex; gap: 6px;'

    EDGE_OPTIONS.forEach(pct => {
      const btn = document.createElement('button')
      btn.style.cssText = `
        flex: 1;
        background: #0f172a;
        border: 1px solid #334155;
        border-radius: 6px;
        padding: 10px 4px;
        cursor: pointer;
        color: #e5e5e5;
        font-family: system-ui, sans-serif;
        text-align: center;
      `
      const pctEl = document.createElement('div')
      pctEl.textContent = `${pct}%`
      pctEl.style.cssText = 'font-size: 14px; font-weight: 600;'
      const stakeEl = document.createElement('div')
      stakeEl.className = 'fb-edge-stake'
      stakeEl.dataset.fbEdge = String(pct)
      stakeEl.style.cssText = 'font-size: 10px; color: #9ca3af; margin-top: 3px; font-family: ui-monospace, monospace;'
      btn.appendChild(pctEl)
      btn.appendChild(stakeEl)

      btn.addEventListener('mouseenter', () => { btn.style.borderColor = '#2563eb' })
      btn.addEventListener('mouseleave', () => { btn.style.borderColor = '#334155' })
      btn.addEventListener('click', () => {
        document.body.removeChild(overlay)
        onEdge(pct / 100)
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
    return overlay
  }

  // ─── Take buttons ──────────────────────────────────────────────────────────

  const TAKE_STYLES = {
    idle: 'background: linear-gradient(135deg, #060e2b 0%, #0f1f5c 100%); border-color: rgba(255,255,255,0.25); color: #fff;',
    loading: 'background: #4b5563; border-color: rgba(255,255,255,0.15); color: #e5e7eb;',
    success: 'background: #14532d; border-color: #22c55e; color: #bbf7d0;',
    blocked: 'background: #451a03; border-color: #f59e0b; color: #fde68a;',
    error: 'background: #450a0a; border-color: #ef4444; color: #fecaca;',
  }

  function setTakeState(btn, state, text, tooltip) {
    btn.dataset.fbState = state
    btn.textContent = text
    btn.style.cssText = btn.dataset.fbBaseCss + TAKE_STYLES[state]
    btn.disabled = state === 'loading'
    if (tooltip != null) btn.title = tooltip
  }

  function resetTakeLater(btn, ms) {
    setTimeout(() => {
      if (btn.isConnected && btn.dataset.fbState !== 'loading') {
        setTakeState(btn, 'idle', 'Take', 'Take this side on Kalshi demo')
      }
    }, ms)
  }

  const BLOCKED_LABELS = {
    side_mismatch: '✗ wrong market',
    market_not_found: '✗ market not found',
    market_not_tradable: '✗ closed',
    no_liquidity: '✗ no liquidity',
    no_fill: '✗ no fill',
    odds_mismatch: '✗ odds differ',
  }

  function describeMarket(market) {
    if (!market) return ''
    const parts = []
    if (market.title) parts.push(market.title)
    if (market.yes_sub_title) parts.push(`YES: ${market.yes_sub_title}`)
    if (market.no_sub_title) parts.push(`NO: ${market.no_sub_title}`)
    if (market.status) parts.push(`status: ${market.status}`)
    return parts.join(' · ')
  }

  function handleTakeClick(btn, leg, legs) {
    const ticker = kalshiTicker(leg)
    if (!ticker) {
      setTakeState(btn, 'error', '✗ no ticker', 'Could not parse the Kalshi market ticker from this leg')
      resetTakeLater(btn, 6000)
      return
    }

    const sideLabel = leg.querySelector('span.MuiTypography-body3')?.textContent?.trim()
    if (!sideLabel) {
      setTakeState(btn, 'error', '✗ no side', 'Could not read the side name from this leg')
      resetTakeLater(btn, 6000)
      return
    }

    // Extract odds fresh at click time — they move constantly
    const odds = legOddsFinder(legs)(leg)
    if (isNaN(odds) || odds === 0) {
      setTakeState(btn, 'error', '✗ no odds', 'Could not read this leg’s odds')
      resetTakeLater(btn, 6000)
      return
    }

    const oddsStr = odds > 0 ? `+${odds}` : `${odds}`
    const overlay = showEdgePicker(`${sideLabel} · ${oddsStr} · ${ticker}`, (edge) => {
      setTakeState(btn, 'loading', '…', '')
      chrome.runtime.sendMessage(
        {
          type: 'TAKE_KALSHI',
          payload: {
            ticker,
            side_label: sideLabel,
            odds,
            edge,
            bankroll,
            kelly_fraction: kellyFraction,
          },
        },
        (res) => {
          if (chrome.runtime.lastError || !res) {
            setTakeState(btn, 'error', '✗ error', String(chrome.runtime.lastError?.message ?? 'no response'))
            resetTakeLater(btn, 6000)
            return
          }
          if (res.ok) {
            const d = res.data
            setTakeState(
              btn,
              'success',
              `✓ ${d.filled_count} @ ${d.avg_price_cents}¢`,
              `Bought ${d.filled_count} ${String(d.side).toUpperCase()} @ ${d.avg_price_cents}¢` +
                ` (cost $${(d.cost_dollars ?? 0).toFixed(2)}, fees $${(d.fee_dollars ?? 0).toFixed(2)})` +
                ` · ${describeMarket(d)} — verify on Kalshi demo`
            )
            // Success sticks until the page re-renders the row — the take
            // happened; the label is the receipt.
          } else if (res.blocked) {
            const label = BLOCKED_LABELS[res.blocked] ?? `✗ ${res.blocked}`
            let tooltip = describeMarket(res.data?.market)
            if (res.blocked === 'no_liquidity') {
              tooltip = `Nothing available at ≤${res.data?.cap_cents}¢ (cap from ${oddsStr}). ${tooltip}`
            }
            if (res.blocked === 'odds_mismatch') {
              const ko = res.data?.kalshi_odds
              tooltip = `PTO shows ${oddsStr} but Kalshi's real price (${res.data?.best_price_cents}¢ + fees) ` +
                `is ${ko > 0 ? '+' : ''}${ko} — stale row or wrong market. ${tooltip}`
            }
            setTakeState(btn, 'blocked', label, tooltip || res.blocked)
            resetTakeLater(btn, 8000)
          } else {
            setTakeState(btn, 'error', '✗ error', res.error ?? 'unknown error')
            resetTakeLater(btn, 8000)
            console.warn('[FoggleBet] take failed:', res.error)
          }
        }
      )
    })

    // Fill the per-edge stake preview line in the picker
    overlay.querySelectorAll('.fb-edge-stake').forEach(el => {
      const pct = parseInt(el.dataset.fbEdge, 10)
      el.textContent = `$${kellyStake(odds, pct / 100).toLocaleString()}`
    })
  }

  function injectTakeButtons(row) {
    const found = findLegs(row)
    if (!found) {
      warnOnce(row, 'Take buttons skipped: leg containers not found')
      return
    }
    const { bookDivs, legs } = found

    if (getComputedStyle(row).position === 'static') row.style.position = 'relative'
    const rowRect = row.getBoundingClientRect()
    if (rowRect.width === 0) return

    for (let i = 0; i < legs.length; i++) {
      if (bookDivs[i].getAttribute('aria-label')?.trim() !== 'Kalshi') continue
      if (!kalshiTicker(legs[i])) {
        warnOnce(row, `Take button skipped: no marketTicker in leg ${i} href`)
        continue
      }

      const legRect = legs[i].getBoundingClientRect()
      if (legRect.width === 0) continue

      let btn = row.querySelector(`:scope > .fb-take-btn[data-fb-leg="${i}"]`)
      if (!btn) {
        btn = document.createElement('button')
        btn.className = 'fb-take-btn'
        btn.dataset.fbLeg = String(i)
        btn.dataset.fbBaseCss = `
          position: absolute;
          z-index: 99996;
          border: 1px solid;
          border-radius: 6px;
          padding: 4px 10px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          font-family: system-ui, sans-serif;
          white-space: nowrap;
          box-shadow: 0 2px 6px rgba(0,0,0,0.4);
        `
        setTakeState(btn, 'idle', 'Take', 'Take this side on Kalshi demo')
        btn.addEventListener('click', (e) => {
          e.stopPropagation()
          e.preventDefault()
          if (btn.dataset.fbState === 'loading') return
          const f = findLegs(row)
          if (!f) return
          handleTakeClick(btn, f.legs[i], f.legs)
        })
        row.appendChild(btn)
      }

      // Anchor just left of the leg box, vertically centered. Recomputed every
      // tick — PTO's layout shifts as odds update.
      btn.style.top = `${legRect.top - rowRect.top + legRect.height / 2}px`
      btn.style.right = `${rowRect.right - legRect.left + 12}px`
      btn.style.transform = 'translateY(-50%)'
    }
  }

  // ─── On-page Kelly settings panel (bottom-right pill) ─────────────────────

  function fmtBankroll(n) {
    return n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `$${n}`
  }

  function updateSettingsPill() {
    const pill = document.getElementById('fb-kelly-pill')
    if (pill) pill.textContent = `${fmtBankroll(bankroll)} · ${fractionLabel()}`
  }

  // Every control writes straight to chrome.storage; the onChanged listener
  // re-renders the pill, so edits apply instantly with no Save step.
  function commitSettings(patch) {
    chrome.storage.local.set(patch)
  }

  const BANKROLL_PRESETS = [10000, 25000, 50000, 100000]
  const KELLY_PRESETS = [100, 50, 25, 12.5]

  function styleField(el) {
    el.style.cssText = `
      width: 100%;
      box-sizing: border-box;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 4px;
      color: #fff;
      padding: 5px 8px;
      font-size: 13px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      outline: none;
    `
    el.addEventListener('focus', () => { el.style.borderColor = '#2563eb'; el.select() })
    el.addEventListener('blur', () => { el.style.borderColor = '#334155' })
  }

  function makeChipRow(values, format, onPick) {
    const row = document.createElement('div')
    row.style.cssText = 'display: flex; gap: 4px; margin-top: 5px;'
    const chips = []
    for (const value of values) {
      const chip = document.createElement('button')
      chip.textContent = format(value)
      chip.dataset.fbValue = String(value)
      chip.style.cssText = `
        flex: 1;
        background: #0f172a;
        border: 1px solid #334155;
        border-radius: 4px;
        color: #cbd5e1;
        padding: 3px 0;
        font-size: 11px;
        cursor: pointer;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      `
      chip.addEventListener('click', () => onPick(value))
      row.appendChild(chip)
      chips.push(chip)
    }
    return { row, chips }
  }

  function highlightChips(chips, current) {
    for (const chip of chips) {
      const active = Math.abs(parseFloat(chip.dataset.fbValue) - current) < 1e-9
      chip.style.borderColor = active ? '#2563eb' : '#334155'
      chip.style.background = active ? '#12244d' : '#0f172a'
      chip.style.color = active ? '#fff' : '#cbd5e1'
    }
  }

  function injectSettingsPanel() {
    if (document.getElementById('fb-kelly-panel')) return

    const panel = document.createElement('div')
    panel.id = 'fb-kelly-panel'
    // Raised clear of PTO's own floating action button in the bottom-right.
    panel.style.cssText = `
      position: fixed;
      bottom: 76px;
      right: 16px;
      z-index: 99997;
      font-family: system-ui, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
    `

    const editor = document.createElement('div')
    editor.style.cssText = `
      display: none;
      background: #1a1a2e;
      border: 1px solid #2d2d4e;
      border-radius: 8px;
      padding: 11px 12px;
      width: 214px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.55);
    `

    function label(text) {
      const el = document.createElement('div')
      el.textContent = text
      el.style.cssText = 'font-size: 10px; color: #9ca3af; margin-bottom: 4px; letter-spacing: 0.03em;'
      return el
    }

    // ── Bankroll ──
    const brInput = document.createElement('input')
    brInput.type = 'number'
    brInput.min = '1'
    brInput.step = '1000'
    styleField(brInput)
    const commitBankroll = () => {
      const n = parseFloat(brInput.value)
      if (!isNaN(n) && n > 0) commitSettings({ bankroll: n })
      else brInput.value = String(bankroll)
    }
    brInput.addEventListener('change', commitBankroll)
    brInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { commitBankroll(); brInput.blur() }
      if (e.key === 'Escape') { brInput.value = String(bankroll); brInput.blur() }
    })

    const brChips = makeChipRow(
      BANKROLL_PRESETS,
      v => `$${v / 1000}k`,
      v => commitSettings({ bankroll: v })
    )

    // ── Kelly percentage ──
    const kInput = document.createElement('input')
    kInput.type = 'number'
    kInput.min = '1'
    kInput.max = '100'
    kInput.step = '5'
    styleField(kInput)
    const commitKelly = () => {
      const n = parseFloat(kInput.value)
      if (!isNaN(n) && n > 0 && n <= 100) commitSettings({ kellyFraction: n / 100 })
      else kInput.value = String(kellyPct())
    }
    kInput.addEventListener('change', commitKelly)
    kInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { commitKelly(); kInput.blur() }
      if (e.key === 'Escape') { kInput.value = String(kellyPct()); kInput.blur() }
    })

    const kChips = makeChipRow(
      KELLY_PRESETS,
      v => `${v}%`,
      v => commitSettings({ kellyFraction: v / 100 })
    )

    editor.appendChild(label('BANKROLL'))
    editor.appendChild(brInput)
    editor.appendChild(brChips.row)
    const spacer = document.createElement('div')
    spacer.style.height = '10px'
    editor.appendChild(spacer)
    editor.appendChild(label('KELLY %'))
    editor.appendChild(kInput)
    editor.appendChild(kChips.row)

    // Keep the open editor in sync when settings change from anywhere
    // (chips, popup, another tab).
    syncSettingsEditor = () => {
      if (document.activeElement !== brInput) brInput.value = String(bankroll)
      if (document.activeElement !== kInput) kInput.value = String(kellyPct())
      highlightChips(brChips.chips, bankroll)
      highlightChips(kChips.chips, kellyPct())
    }

    const pill = document.createElement('button')
    pill.id = 'fb-kelly-pill'
    pill.style.cssText = `
      background: #1a1a2e;
      border: 1px solid #2d2d4e;
      border-radius: 999px;
      color: #cbd5e1;
      padding: 5px 12px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      white-space: nowrap;
    `
    pill.title = 'FoggleBet — bankroll & Kelly %'
    pill.addEventListener('click', () => {
      const opening = editor.style.display === 'none'
      editor.style.display = opening ? 'block' : 'none'
      if (opening) { syncSettingsEditor(); brInput.focus() }
    })

    // Click outside closes the editor
    document.addEventListener('mousedown', e => {
      if (editor.style.display !== 'none' && !panel.contains(e.target)) {
        editor.style.display = 'none'
      }
    })

    panel.appendChild(editor)
    panel.appendChild(pill)
    document.body.appendChild(panel)
    updateSettingsPill()
    syncSettingsEditor()
  }

  // ─── Row injection + MutationObserver ─────────────────────────────────────

  function injectAllRows() {
    try {
      injectSettingsPanel()
    } catch (err) {
      console.warn('[FoggleBet] settings panel failed:', err)
    }
    for (const row of findArbRows()) {
      if (isRowExpanded(row)) {
        try {
          injectTakeButtons(row)
        } catch (err) {
          console.warn('[FoggleBet] take buttons failed:', err)
        }
      }
    }
  }

  injectAllRows()

  setInterval(injectAllRows, 500)

  const observer = new MutationObserver(injectAllRows)
  observer.observe(document.body, { childList: true, subtree: true })
})()
