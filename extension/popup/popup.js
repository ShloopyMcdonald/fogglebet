const apiKeyInput = document.getElementById('apiKey')
const apiUrlInput = document.getElementById('apiUrl')
const bankrollInput = document.getElementById('bankroll')
const saveBtn = document.getElementById('save')
const status = document.getElementById('status')

chrome.storage.local.get(['apiKey', 'apiUrl', 'bankroll'], (result) => {
  if (result.apiKey) apiKeyInput.value = result.apiKey
  if (result.apiUrl) apiUrlInput.value = result.apiUrl
  bankrollInput.value = typeof result.bankroll === 'number' ? result.bankroll : 50000
})

saveBtn.addEventListener('click', () => {
  const apiKey = apiKeyInput.value.trim()
  const apiUrl = apiUrlInput.value.trim().replace(/\/$/, '')
  if (!apiKey || !apiUrl) {
    status.textContent = 'API key and URL are required.'
    return
  }
  const settings = { apiKey, apiUrl }
  const bankroll = parseFloat(bankrollInput.value)
  if (!isNaN(bankroll) && bankroll > 0) settings.bankroll = bankroll
  chrome.storage.local.set(settings, () => {
    status.textContent = 'Saved!'
    setTimeout(() => { status.textContent = '' }, 2000)
  })
})
