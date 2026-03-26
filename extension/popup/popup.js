const apiKeyInput = document.getElementById('apiKey')
const apiUrlInput = document.getElementById('apiUrl')
const saveBtn = document.getElementById('save')
const status = document.getElementById('status')

chrome.storage.local.get(['apiKey', 'apiUrl'], (result) => {
  if (result.apiKey) apiKeyInput.value = result.apiKey
  if (result.apiUrl) apiUrlInput.value = result.apiUrl
})

saveBtn.addEventListener('click', () => {
  const apiKey = apiKeyInput.value.trim()
  const apiUrl = apiUrlInput.value.trim().replace(/\/$/, '')
  if (!apiKey || !apiUrl) {
    status.textContent = 'Both fields are required.'
    return
  }
  chrome.storage.local.set({ apiKey, apiUrl }, () => {
    status.textContent = 'Saved!'
    setTimeout(() => { status.textContent = '' }, 2000)
  })
})
