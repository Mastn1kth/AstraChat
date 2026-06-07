export const migrations = [
  {
    id: '20260607_messenger_foundation',
    sql: `
      CREATE TABLE IF NOT EXISTS chat_user_settings (
        chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pinned BOOLEAN NOT NULL DEFAULT FALSE,
        pinned_at TIMESTAMPTZ,
        muted_until TIMESTAMPTZ,
        archived BOOLEAN NOT NULL DEFAULT FALSE,
        archived_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (chat_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS chat_user_settings_user_idx
        ON chat_user_settings(user_id, archived, pinned_at);

      CREATE TABLE IF NOT EXISTS chat_folders (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        normalized_title TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, normalized_title)
      );

      CREATE INDEX IF NOT EXISTS chat_folders_user_idx
        ON chat_folders(user_id, sort_order, title);

      CREATE TABLE IF NOT EXISTS chat_folder_chats (
        folder_id UUID NOT NULL REFERENCES chat_folders(id) ON DELETE CASCADE,
        chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pinned BOOLEAN NOT NULL DEFAULT FALSE,
        pinned_at TIMESTAMPTZ,
        added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (folder_id, chat_id)
      );

      CREATE INDEX IF NOT EXISTS chat_folder_chats_user_idx
        ON chat_folder_chats(user_id, folder_id, pinned_at);

      CREATE TABLE IF NOT EXISTS message_user_deletions (
        message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (message_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS message_user_deletions_user_idx
        ON message_user_deletions(user_id, deleted_at);

      CREATE TABLE IF NOT EXISTS chat_history_clears (
        chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        cleared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (chat_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS chat_history_clears_user_idx
        ON chat_history_clears(user_id, cleared_at);

      ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS forwarded_from_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;

      ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS forwarded_from_chat_id UUID REFERENCES chats(id) ON DELETE SET NULL;

      ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS search_text TEXT NOT NULL DEFAULT '';
    `,
  },
]

export async function runMigrations(database) {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  const appliedResult = await database.query('SELECT id FROM schema_migrations')
  const applied = new Set(appliedResult.rows.map((row) => row.id))

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue
    await database.exec(migration.sql)
    await database.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id])
  }
}
