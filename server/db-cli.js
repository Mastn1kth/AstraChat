import { db, migrateDatabase } from './db.js'
import { getMigrationStatus, rollbackMigrations } from './migrations.js'

function printStatus(status) {
  for (const migration of status) {
    const marker = migration.applied ? 'applied' : 'pending'
    console.log(`${marker.padEnd(8)} ${migration.id}`)
  }
}

async function main() {
  const command = process.argv[2] || 'status'

  if (command === 'status') {
    printStatus(await getMigrationStatus(db))
    return
  }

  if (command === 'migrate') {
    await migrateDatabase()
    printStatus(await getMigrationStatus(db))
    return
  }

  if (command === 'rollback') {
    const count = Math.max(1, Number.parseInt(process.argv[3] || '1', 10) || 1)
    const rolledBack = await rollbackMigrations(db, count)
    if (!rolledBack.length) {
      console.log('No applied migrations to roll back')
      return
    }
    for (const id of rolledBack) {
      console.log(`rolled back ${id}`)
    }
    return
  }

  console.error(`Unknown db command: ${command}`)
  console.error('Usage: node server/db-cli.js status|migrate|rollback [count]')
  process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await db.close?.()
  })
