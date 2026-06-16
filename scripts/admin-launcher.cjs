// Onda Admin — standalone launcher.
// Compiled into Onda-Admin.exe (Node SEA). Place the exe in the project root:
// it starts the server when needed and opens the admin panel in the browser.
const { spawn, exec } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const path = require('node:path')

const SERVER_URL = process.env.ONDA_SERVER_URL || 'http://127.0.0.1:3001'

function findRoot() {
  // The exe sits in the project root; when run via `node scripts/...` use cwd.
  const candidates = [path.dirname(process.execPath), process.cwd()]
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'server', 'index.js'))) return dir
  }
  return process.cwd()
}

const root = findRoot()

function readToken() {
  const dataDir = process.env.DATA_DIR || 'server-data-v5'
  const tokenPath = path.join(root, dataDir, '.admin-token')
  try {
    return readFileSync(tokenPath, 'utf8').trim()
  } catch {
    return ''
  }
}

function ping() {
  return fetch(`${SERVER_URL}/api/live`, { signal: AbortSignal.timeout(1500) })
    .then((response) => response.ok)
    .catch(() => false)
}

function startServer() {
  console.log('Сервер не запущен — запускаю…')
  const child = spawn('node', ['server/index.js'], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    shell: true,
  })
  child.unref()
}

function openBrowser(url) {
  exec(`start "" "${url}"`)
}

async function main() {
  console.log('Onda Admin — панель управления мессенджером')
  console.log('Проект: ' + root)

  let alive = await ping()
  if (!alive) {
    startServer()
    for (let attempt = 0; attempt < 30 && !alive; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      alive = await ping()
    }
  }

  if (!alive) {
    console.error('Не удалось запустить сервер. Проверьте, что установлен Node.js,')
    console.error('и запустите вручную: npm run server:start')
    process.exitCode = 1
    return
  }

  const token = readToken()
  const url = `${SERVER_URL}/admin${token ? `#token=${encodeURIComponent(token)}` : ''}`
  console.log('Сервер работает. Открываю панель: ' + SERVER_URL + '/admin')
  if (!process.env.ONDA_ADMIN_NO_OPEN) openBrowser(url)
}

main()
