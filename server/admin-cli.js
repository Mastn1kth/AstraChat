// Onda server administration CLI.
//
// Usage: node server/admin-cli.js <command> [args]
//
//   status                    server health + database counts
//   stats                     detailed usage statistics
//   backup                    snapshot DB + media into backups/<timestamp>/
//   restore <name>            restore a snapshot (stop the server first!)
//   backups                   list available snapshots
//   prune-backups [keep=5]    delete old snapshots, keep the newest N
//   users                     list registered users
//   wall-clear [days=30]      delete wall messages older than N days
//   cleanup                   remove expired sessions and stale data
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { db, cleanupExpiredSessions } from './db.js'
import { config } from './config.js'

const backupsDir = resolve(config.rootDir, 'backups')

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function directorySize(path) {
  if (!existsSync(path)) return 0
  let total = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const entryPath = resolve(path, entry.name)
    total += entry.isDirectory() ? directorySize(entryPath) : statSync(entryPath).size
  }
  return total
}

async function count(sql) {
  const result = await db.query(sql)
  return Number(result.rows[0]?.count || 0)
}

async function commandStatus() {
  await db.query('SELECT 1')
  console.log('database     ok (' + (config.databaseUrl ? 'postgres' : 'pglite') + ')')
  console.log('storage      ' + (config.storageDriver || 'local'))
  console.log('data dir     ' + config.dataDir + ' (' + formatBytes(directorySize(config.dataDir)) + ')')
  console.log('users        ' + (await count('SELECT COUNT(*)::integer AS count FROM users')))
  console.log('chats        ' + (await count('SELECT COUNT(*)::integer AS count FROM chats')))
  console.log('messages     ' + (await count('SELECT COUNT(*)::integer AS count FROM messages')))
  console.log('wall posts   ' + (await count('SELECT COUNT(*)::integer AS count FROM wall_messages')))
}

async function commandStats() {
  await commandStatus()
  console.log('')
  console.log('sessions     ' + (await count('SELECT COUNT(*)::integer AS count FROM sessions WHERE expires_at > NOW()')))
  console.log('media files  ' + (await count('SELECT COUNT(*)::integer AS count FROM media_files')))
  console.log('groups       ' + (await count("SELECT COUNT(*)::integer AS count FROM chats WHERE type = 'group'")))
  console.log('channels     ' + (await count("SELECT COUNT(*)::integer AS count FROM chats WHERE type = 'channel'")))
  console.log('calls        ' + (await count('SELECT COUNT(*)::integer AS count FROM calls')))
  const recent = await db.query(
    "SELECT COUNT(*)::integer AS count FROM messages WHERE created_at > NOW() - INTERVAL '24 hours'",
  )
  console.log('msgs/24h     ' + Number(recent.rows[0]?.count || 0))
  const topUsers = await db.query(
    `SELECT u.username, COUNT(m.id)::integer AS messages
     FROM users u LEFT JOIN messages m ON m.sender_id = u.id
     GROUP BY u.id, u.username ORDER BY messages DESC LIMIT 5`,
  )
  console.log('')
  console.log('top senders:')
  for (const row of topUsers.rows) {
    console.log('  ' + String(row.username).padEnd(20) + row.messages)
  }
}

async function commandBackup() {
  mkdirSync(backupsDir, { recursive: true })
  const name = `onda-${timestamp()}`
  const target = resolve(backupsDir, name)
  mkdirSync(target, { recursive: true })

  if (config.databaseUrl) {
    // Managed Postgres: use pg_dump (must be on PATH).
    const dumpFile = resolve(target, 'database.sql')
    console.log('Running pg_dump…')
    execFileSync('pg_dump', ['--no-owner', '--format=plain', `--file=${dumpFile}`, config.databaseUrl], {
      stdio: 'inherit',
    })
  } else {
    // PGlite + local media live inside the data dir: snapshot the whole dir.
    // For a consistent snapshot stop the server first.
    console.log('Copying data dir (stop the server first for a consistent snapshot)…')
    cpSync(config.dataDir, resolve(target, 'data'), { recursive: true })
  }

  writeFileSync(
    resolve(target, 'manifest.json'),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        database: config.databaseUrl ? 'postgres' : 'pglite',
        storage: config.storageDriver || 'local',
        dataDir: config.dataDir,
      },
      null,
      2,
    ),
  )
  console.log(`Backup created: backups/${name} (${formatBytes(directorySize(target))})`)
}

function listBackups() {
  if (!existsSync(backupsDir)) return []
  return readdirSync(backupsDir)
    .filter((name) => name.startsWith('onda-'))
    .sort()
}

function commandListBackups() {
  const backups = listBackups()
  if (!backups.length) {
    console.log('No backups yet. Run: node server/admin-cli.js backup')
    return
  }
  for (const name of backups) {
    console.log(name.padEnd(28) + formatBytes(directorySize(resolve(backupsDir, name))))
  }
}

function commandRestore(name) {
  if (!name) {
    console.error('Usage: node server/admin-cli.js restore <backup-name>')
    process.exitCode = 1
    return
  }
  const source = resolve(backupsDir, name)
  if (!existsSync(source)) {
    console.error(`Backup not found: ${name}`)
    process.exitCode = 1
    return
  }
  if (config.databaseUrl) {
    console.error('Postgres restore: psql "$DATABASE_URL" < backups/' + name + '/database.sql')
    process.exitCode = 1
    return
  }
  const dataSource = resolve(source, 'data')
  if (!existsSync(dataSource)) {
    console.error('Snapshot has no data dir — nothing to restore.')
    process.exitCode = 1
    return
  }
  console.log('Restoring data dir (the server must be stopped)…')
  rmSync(config.dataDir, { recursive: true, force: true })
  cpSync(dataSource, config.dataDir, { recursive: true })
  console.log('Restored from backups/' + name)
}

function commandPruneBackups(keepRaw) {
  const keep = Math.max(1, Number.parseInt(keepRaw || '5', 10) || 5)
  const backups = listBackups()
  const stale = backups.slice(0, Math.max(0, backups.length - keep))
  for (const name of stale) {
    rmSync(resolve(backupsDir, name), { recursive: true, force: true })
    console.log('Deleted ' + name)
  }
  console.log(`Kept ${Math.min(keep, backups.length)} newest backup(s).`)
}

async function commandUsers() {
  const result = await db.query(
    `SELECT username, name, created_at, last_seen_at
     FROM users ORDER BY created_at DESC LIMIT 100`,
  )
  for (const row of result.rows) {
    const created = new Date(row.created_at).toISOString().slice(0, 10)
    const seen = row.last_seen_at ? new Date(row.last_seen_at).toISOString().slice(0, 16) : 'never'
    console.log(String(row.username).padEnd(22) + created.padEnd(12) + 'last seen ' + seen)
  }
  console.log(`\n${result.rows.length} user(s) shown (max 100).`)
}

async function commandWallClear(daysRaw) {
  const days = Math.max(0, Number.parseInt(daysRaw || '30', 10) || 30)
  const result = await db.query(
    `DELETE FROM wall_messages WHERE created_at < NOW() - ($1 || ' days')::interval RETURNING id`,
    [String(days)],
  )
  console.log(`Deleted ${result.rows.length} wall message(s) older than ${days} day(s).`)
}

async function commandCleanup() {
  await cleanupExpiredSessions()
  const wall = await db.query(
    `DELETE FROM wall_messages
     WHERE id NOT IN (SELECT id FROM wall_messages ORDER BY created_at DESC LIMIT 500)
     RETURNING id`,
  )
  console.log('Expired sessions removed.')
  console.log(`Wall trimmed to the latest 500 (${wall.rows.length} removed).`)
}

async function main() {
  const [command, arg] = process.argv.slice(2)
  switch (command) {
    case 'status': await commandStatus(); break
    case 'stats': await commandStats(); break
    case 'backup': await commandBackup(); break
    case 'backups': commandListBackups(); break
    case 'restore': commandRestore(arg); break
    case 'prune-backups': commandPruneBackups(arg); break
    case 'users': await commandUsers(); break
    case 'wall-clear': await commandWallClear(arg); break
    case 'cleanup': await commandCleanup(); break
    default:
      console.log('Commands: status | stats | backup | backups | restore <name> | prune-backups [keep] | users | wall-clear [days] | cleanup')
  }
}

main()
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  .finally(() => db.close?.())
