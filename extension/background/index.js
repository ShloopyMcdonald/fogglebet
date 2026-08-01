// Service worker — brokers API calls from the content script to the FoggleBet
// web app (avoids CORS and keeps the API key out of page context).

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'TAKE_KALSHI') {
    handleTakeKalshi(message.payload).then(sendResponse)
    return true // keep channel open for async response
  }
})

async function handleTakeKalshi(payload) {
  try {
    const { apiKey, apiUrl } = await chrome.storage.local.get(['apiKey', 'apiUrl'])

    if (!apiKey || !apiUrl) {
      return { ok: false, error: 'API key or URL not configured. Open the FoggleBet extension popup to set them.' }
    }

    const res = await fetch(`${apiUrl}/api/kalshi/take`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    })

    let data = null
    try {
      data = await res.json()
    } catch {
      // non-JSON error body — fall through with data = null
    }

    if (res.status === 201 && data) {
      return { ok: true, data }
    }

    // 422 = deliberate block (side mismatch, no liquidity, market closed…)
    if (res.status === 422 && data?.blocked) {
      return { ok: false, blocked: data.blocked, data }
    }

    return { ok: false, error: `Server error ${res.status}: ${data ? JSON.stringify(data) : 'no body'}` }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
