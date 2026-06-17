import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { config } from './config.js'
import { runMigrations } from './migrations.js'

const { Pool } = pg

function createPostgresDatabase() {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  })

  return {
    async query(sql, params = []) {
      return pool.query(sql, params)
    },
    async exec(sql) {
      await pool.query(sql)
    },
    async transaction(callback) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await callback({
          query: (sql, params = []) => client.query(sql, params),
          exec: (sql) => client.query(sql),
        })
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },
    async close() {
      await pool.end()
    },
  }
}

function createPGliteDatabase() {
  return new PGlite(config.databasePath)
}

export const db = config.databaseUrl ? createPostgresDatabase() : createPGliteDatabase()

export async function migrateDatabase() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      login TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      phone TEXT UNIQUE,
      name TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      totp_secret TEXT,
      totp_pending_secret TEXT,
      totp_enabled_at TIMESTAMPTZ,
      encryption_public_key TEXT,
      last_seen_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      user_agent TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT '',
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS phone_login_codes (
      phone TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS phone_login_codes_expires_idx
      ON phone_login_codes(expires_at);

    CREATE TABLE IF NOT EXISTS chats (
      id UUID PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('private', 'group', 'channel', 'saved')),
      title TEXT NOT NULL DEFAULT '',
      created_by UUID NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS chat_members (
      chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chat_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS chat_members_user_id_idx ON chat_members(user_id);

    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY,
      chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      sender_id UUID NOT NULL REFERENCES users(id),
      media_id UUID,
      reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL,
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      encryption_version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      edited_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS messages_chat_created_idx ON messages(chat_id, created_at);

    CREATE TABLE IF NOT EXISTS message_reactions (
      message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (message_id, user_id, emoji)
    );

    CREATE INDEX IF NOT EXISTS message_reactions_message_idx
      ON message_reactions(message_id);

    CREATE TABLE IF NOT EXISTS message_reads (
      message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (message_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS message_reads_message_idx
      ON message_reads(message_id);

    CREATE TABLE IF NOT EXISTS calls (
      id UUID PRIMARY KEY,
      chat_id UUID REFERENCES chats(id) ON DELETE SET NULL,
      initiator_id UUID NOT NULL REFERENCES users(id),
      recipient_id UUID REFERENCES users(id),
      kind TEXT NOT NULL CHECK (kind IN ('audio', 'video')),
      status TEXT NOT NULL CHECK (status IN ('ringing', 'accepted', 'declined', 'ended', 'missed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      answered_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS calls_participants_idx ON calls(initiator_id, recipient_id, created_at);

    CREATE TABLE IF NOT EXISTS call_participants (
      call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      state TEXT NOT NULL DEFAULT 'invited',
      muted BOOLEAN NOT NULL DEFAULT FALSE,
      camera_off BOOLEAN NOT NULL DEFAULT FALSE,
      screen_sharing BOOLEAN NOT NULL DEFAULT FALSE,
      joined_at TIMESTAMPTZ,
      left_at TIMESTAMPTZ,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (call_id, user_id),
      CHECK (state IN ('invited', 'ringing', 'connected', 'left', 'declined', 'missed', 'disconnected'))
    );

    CREATE INDEX IF NOT EXISTS call_participants_user_idx
      ON call_participants(user_id, last_seen_at DESC);

    CREATE INDEX IF NOT EXISTS call_participants_call_idx
      ON call_participants(call_id, state);

    CREATE TABLE IF NOT EXISTS media_files (
      id UUID PRIMARY KEY,
      owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      storage_name TEXT NOT NULL UNIQUE,
      encrypted_size BIGINT NOT NULL,
      plain_size BIGINT NOT NULL,
      original_size BIGINT NOT NULL,
      width INTEGER,
      height INTEGER,
      client_encrypted BOOLEAN DEFAULT FALSE,
      media_envelope TEXT DEFAULT '',
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS media_files_owner_idx ON media_files(owner_id, created_at);
    CREATE INDEX IF NOT EXISTS media_files_chat_idx ON media_files(chat_id, created_at);

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS media_id UUID REFERENCES media_files(id) ON DELETE SET NULL;

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS phone TEXT;

    CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique_idx
      ON users(phone)
      WHERE phone IS NOT NULL;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS encryption_public_key TEXT;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS totp_secret TEXT;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS totp_pending_secret TEXT;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS totp_enabled_at TIMESTAMPTZ;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT '';

    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_storage_name TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_mime TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_iv TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_auth_tag TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_updated_at TIMESTAMPTZ;

    ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS user_agent TEXT;

    ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS ip_address TEXT;

    ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

    ALTER TABLE media_files
      ADD COLUMN IF NOT EXISTS client_encrypted BOOLEAN;

    ALTER TABLE media_files
      ADD COLUMN IF NOT EXISTS media_envelope TEXT;

    ALTER TABLE media_files
      ADD COLUMN IF NOT EXISTS duration_ms INTEGER;

    ALTER TABLE media_files DROP CONSTRAINT IF EXISTS media_files_kind_check;
    ALTER TABLE media_files
      ADD CONSTRAINT media_files_kind_check
      CHECK (kind IN ('image', 'video', 'voice', 'audio', 'file'));
  `)
  await runMigrations(db)
}

export async function createSavedChat(tx, userId) {
  const chatId = randomUUID()
  await tx.query(
    'INSERT INTO chats (id, type, title, created_by) VALUES ($1, $2, $3, $4)',
    [chatId, 'saved', 'Saved Messages', userId],
  )
  await tx.query(
    'INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1, $2, $3)',
    [chatId, userId, 'owner'],
  )
  await tx.query(
    `INSERT INTO chat_user_settings (chat_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (chat_id, user_id) DO NOTHING`,
    [chatId, userId],
  )
  return chatId
}

export async function cleanupExpiredSessions() {
  await db.query('DELETE FROM sessions WHERE expires_at <= NOW()')
}
