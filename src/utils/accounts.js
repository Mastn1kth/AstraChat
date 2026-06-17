const ACCOUNTS_KEY = 'onda.accounts.v1'

export function readAccounts() {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]')
  } catch {
    return []
  }
}

export function upsertAccount(user) {
  const accounts = readAccounts()
  const idx = accounts.findIndex((a) => a.id === user.id)
  const entry = { id: user.id, name: user.name, username: user.username, avatar: user.avatar }
  if (idx >= 0) accounts[idx] = entry
  else accounts.push(entry)
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts))
}

export function removeAccount(id) {
  const accounts = readAccounts().filter((a) => a.id !== id)
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts))
}
