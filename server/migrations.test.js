import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { getMigrationStatus, migrations, rollbackMigrations, runMigrations } from './migrations.js'

async function createBaseSchema(db) {
  await db.exec(`
    CREATE TABLE users (
      id UUID PRIMARY KEY,
      login TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT '',
      password_salt TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE chats (
      id UUID PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'private',
      title TEXT NOT NULL DEFAULT '',
      created_by UUID NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE chat_members (
      chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chat_id, user_id)
    );

    CREATE TABLE messages (
      id UUID PRIMARY KEY,
      chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      sender_id UUID NOT NULL REFERENCES users(id),
      ciphertext TEXT NOT NULL DEFAULT '',
      iv TEXT NOT NULL DEFAULT '',
      auth_tag TEXT NOT NULL DEFAULT '',
      encryption_version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      edited_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ
    );

    CREATE TABLE media_files (
      id UUID PRIMARY KEY,
      owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'image',
      original_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      storage_name TEXT NOT NULL UNIQUE,
      encrypted_size BIGINT NOT NULL DEFAULT 0,
      plain_size BIGINT NOT NULL DEFAULT 0,
      original_size BIGINT NOT NULL DEFAULT 0,
      iv TEXT NOT NULL DEFAULT '',
      auth_tag TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE calls (
      id UUID PRIMARY KEY,
      chat_id UUID REFERENCES chats(id) ON DELETE SET NULL,
      initiator_id UUID NOT NULL REFERENCES users(id),
      recipient_id UUID NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL DEFAULT 'audio',
      status TEXT NOT NULL DEFAULT 'ringing',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      answered_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ
    );
  `)
}

describe('database migrations', () => {
  it('reports pending migrations before the migration table exists', async () => {
    const db = new PGlite()
    try {
      const status = await getMigrationStatus(db)
      assert.equal(status.length, migrations.length)
      assert.equal(status.every((migration) => !migration.applied), true)
    } finally {
      await db.close()
    }
  })

  it('applies migrations and rolls back the target migration marker and schema', async () => {
    const db = new PGlite()
    try {
      await createBaseSchema(db)
      await runMigrations(db)

      const applied = await getMigrationStatus(db)
      assert.equal(applied.every((migration) => migration.applied), true)

      // Roll back to (and including) the migration that made sender_id
      // nullable for system messages, whichever position it's in — later
      // migrations may be appended after it, so don't assume it's last.
      const targetId = '20260701_system_message_columns_nullable'
      const targetIndex = migrations.findIndex((migration) => migration.id === targetId)
      assert.notEqual(targetIndex, -1)
      const stepsToRollback = migrations.length - targetIndex

      const rolledBack = await rollbackMigrations(db, stepsToRollback)
      assert.deepEqual(rolledBack, migrations.slice(targetIndex).map((migration) => migration.id).reverse())

      const afterRollback = await getMigrationStatus(db)
      assert.equal(afterRollback.slice(targetIndex).every((migration) => !migration.applied), true)
      assert.equal(afterRollback.slice(0, targetIndex).every((migration) => migration.applied), true)

      // The target migration's downSql must actually revert its schema change,
      // not just flip the applied marker: sender_id should be NOT NULL again.
      await db.query(
        `INSERT INTO users (id, login, username, name) VALUES (gen_random_uuid(), 'rb_user', 'rb_user', 'RB User') RETURNING id`,
      )
      const { rows: [{ id: rbUserId }] } = await db.query(`SELECT id FROM users WHERE login = 'rb_user'`)
      await db.query(
        `INSERT INTO chats (id, type, title, created_by) VALUES (gen_random_uuid(), 'private', '', $1) RETURNING id`,
        [rbUserId],
      )
      const { rows: [{ id: rbChatId }] } = await db.query(`SELECT id FROM chats WHERE created_by = $1`, [rbUserId])
      await assert.rejects(
        () => db.query(
          `INSERT INTO messages (id, chat_id, sender_id, is_system, ciphertext, iv, auth_tag)
           VALUES (gen_random_uuid(), $1, NULL, TRUE, NULL, NULL, NULL)`,
          [rbChatId],
        ),
        /null value|not-null|violates/i,
      )
    } finally {
      await db.close()
    }
  })
})
