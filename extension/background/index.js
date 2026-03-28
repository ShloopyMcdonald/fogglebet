// Service worker — handles API calls from content script to avoid CORS issues

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'POST_BETS') {
    handlePostBets(message.payload).then(sendResponse)
    return true // keep channel open for async response
  }
})

async function handlePostBets(payload) {
  try {
    const { apiKey, apiUrl } = await chrome.storage.local.get(['apiKey', 'apiUrl'])

    if (!apiKey || !apiUrl) {
      return { ok: false, error: 'API key or URL not configured. Open the FoggleBet extension popup to set them.' }
    }

    const res = await fetch(`${apiUrl}/api/bets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const text = await res.text()
      return { ok: false, duplicate: res.status === 409, error: `Server error ${res.status}: ${text}` }
    }

    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
