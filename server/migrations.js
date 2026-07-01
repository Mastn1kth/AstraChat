export const migrations = [
  {
    id: '20260607_pinned_messages',
    sql: `
      ALTER TABLE chats
        ADD COLUMN IF NOT EXISTS pinned_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;
    `,
    downSql: `
      ALTER TABLE chats
        DROP COLUMN IF EXISTS pinned_message_id;
    `,
  },
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
    downSql: `
      ALTER TABLE messages
        DROP COLUMN IF EXISTS search_text;

      ALTER TABLE messages
        DROP COLUMN IF EXISTS forwarded_from_chat_id;

      ALTER TABLE messages
        DROP COLUMN IF EXISTS forwarded_from_message_id;

      DROP TABLE IF EXISTS chat_history_clears;
      DROP TABLE IF EXISTS message_user_deletions;
      DROP TABLE IF EXISTS chat_folder_chats;
      DROP TABLE IF EXISTS chat_folders;
      DROP TABLE IF EXISTS chat_user_settings;
    `,
  },
  {
    id: '20260607_web_push_notifications',
    sql: `
      ALTER TABLE chat_user_settings
        ADD COLUMN IF NOT EXISTS push_mode TEXT NOT NULL DEFAULT 'default';

      ALTER TABLE chat_user_settings DROP CONSTRAINT IF EXISTS chat_user_settings_push_mode_check;
      ALTER TABLE chat_user_settings
        ADD CONSTRAINT chat_user_settings_push_mode_check
        CHECK (push_mode IN ('default', 'all', 'mentions', 'off'));

      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        expiration_time TIMESTAMPTZ,
        user_agent TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_success_at TIMESTAMPTZ,
        last_error TEXT NOT NULL DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
        ON push_subscriptions(user_id, updated_at DESC);
    `,
    downSql: `
      DROP TABLE IF EXISTS push_subscriptions;

      ALTER TABLE chat_user_settings DROP CONSTRAINT IF EXISTS chat_user_settings_push_mode_check;

      ALTER TABLE chat_user_settings
        DROP COLUMN IF EXISTS push_mode;
    `,
  },
  {
    id: '20260607_security_flows',
    sql: `
      CREATE TABLE IF NOT EXISTS security_events (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info',
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS security_events_user_idx
        ON security_events(user_id, read_at, created_at DESC);

      CREATE TABLE IF NOT EXISTS user_blocks (
        blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (blocker_id, blocked_id),
        CHECK (blocker_id <> blocked_id)
      );

      CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx
        ON user_blocks(blocked_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS reports (
        id UUID PRIMARY KEY,
        reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        target_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
        target_chat_id UUID REFERENCES chats(id) ON DELETE SET NULL,
        reason TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reviewed_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS reports_status_idx
        ON reports(status, created_at DESC);

      CREATE INDEX IF NOT EXISTS reports_reporter_idx
        ON reports(reporter_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS user_key_changes (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        previous_public_key TEXT NOT NULL,
        next_public_key TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS user_key_changes_user_idx
        ON user_key_changes(user_id, created_at DESC);
    `,
    downSql: `
      DROP TABLE IF EXISTS user_key_changes;
      DROP TABLE IF EXISTS reports;
      DROP TABLE IF EXISTS user_blocks;
      DROP TABLE IF EXISTS security_events;
    `,
  },
  {
    id: '20260607_groups_channels_full_management',
    sql: `
      ALTER TABLE chats
        ADD COLUMN IF NOT EXISTS slow_mode_seconds INTEGER NOT NULL DEFAULT 0;

      ALTER TABLE chats
        ADD COLUMN IF NOT EXISTS default_permissions TEXT NOT NULL DEFAULT '{}';

      ALTER TABLE chat_members
        ADD COLUMN IF NOT EXISTS permissions TEXT NOT NULL DEFAULT '{}';

      ALTER TABLE chat_members
        ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;

      ALTER TABLE chat_members DROP CONSTRAINT IF EXISTS chat_members_role_check;
      ALTER TABLE chat_members
        ADD CONSTRAINT chat_members_role_check
        CHECK (role IN ('owner', 'admin', 'moderator', 'member'));

      ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS topic_id UUID;

      ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS silent BOOLEAN NOT NULL DEFAULT FALSE;

      ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

      ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ DEFAULT NOW();

      CREATE TABLE IF NOT EXISTS chat_admin_log (
        id UUID PRIMARY KEY,
        chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS chat_admin_log_chat_idx
        ON chat_admin_log(chat_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS chat_bans (
        chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        banned_by UUID REFERENCES users(id) ON DELETE SET NULL,
        reason TEXT NOT NULL DEFAULT '',
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (chat_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS chat_bans_expiry_idx
        ON chat_bans(expires_at);

      CREATE TABLE IF NOT EXISTS chat_invite_links (
        id UUID PRIMARY KEY,
        chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        name TEXT NOT NULL DEFAULT '',
        expires_at TIMESTAMPTZ,
        usage_limit INTEGER,
        uses INTEGER NOT NULL DEFAULT 0,
        require_approval BOOLEAN NOT NULL DEFAULT FALSE,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS chat_invite_links_chat_idx
        ON chat_invite_links(chat_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS chat_join_requests (
        chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        invite_link_id UUID REFERENCES chat_invite_links(id) ON DELETE SET NULL,
        message TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (chat_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS chat_join_requests_chat_idx
        ON chat_join_requests(chat_id, status, created_at DESC);

      CREATE TABLE IF NOT EXISTS chat_topics (
        id UUID PRIMARY KEY,
        chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        pinned BOOLEAN NOT NULL DEFAULT FALSE,
        closed BOOLEAN NOT NULL DEFAULT FALSE,
        message_count INTEGER NOT NULL DEFAULT 0,
        last_message_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS chat_topics_chat_idx
        ON chat_topics(chat_id, pinned DESC, updated_at DESC);

      CREATE TABLE IF NOT EXISTS polls (
        id UUID PRIMARY KEY,
        message_id UUID NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        multiple_choice BOOLEAN NOT NULL DEFAULT FALSE,
        anonymous BOOLEAN NOT NULL DEFAULT TRUE,
        quiz BOOLEAN NOT NULL DEFAULT FALSE,
        correct_option_id UUID,
        closed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS poll_options (
        id UUID PRIMARY KEY,
        poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS poll_options_poll_idx
        ON poll_options(poll_id, sort_order);

      CREATE TABLE IF NOT EXISTS poll_votes (
        poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
        option_id UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (poll_id, option_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS poll_votes_user_idx
        ON poll_votes(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS channel_post_stats (
        message_id UUID PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
        views INTEGER NOT NULL DEFAULT 0,
        reposts INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS message_views (
        message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (message_id, user_id)
      );
    `,
    downSql: `
      DROP TABLE IF EXISTS message_views;
      DROP TABLE IF EXISTS channel_post_stats;
      DROP TABLE IF EXISTS poll_votes;
      DROP TABLE IF EXISTS poll_options;
      DROP TABLE IF EXISTS polls;
      DROP TABLE IF EXISTS chat_topics;
      DROP TABLE IF EXISTS chat_join_requests;
      DROP TABLE IF EXISTS chat_invite_links;
      DROP TABLE IF EXISTS chat_bans;
      DROP TABLE IF EXISTS chat_admin_log;

      ALTER TABLE messages
        DROP COLUMN IF EXISTS sent_at;

      ALTER TABLE messages
        DROP COLUMN IF EXISTS scheduled_at;

      ALTER TABLE messages
        DROP COLUMN IF EXISTS silent;

      ALTER TABLE messages
        DROP COLUMN IF EXISTS topic_id;

      ALTER TABLE chat_members DROP CONSTRAINT IF EXISTS chat_members_role_check;

      ALTER TABLE chat_members
        DROP COLUMN IF EXISTS last_message_at;

      ALTER TABLE chat_members
        DROP COLUMN IF EXISTS permissions;

      ALTER TABLE chats
        DROP COLUMN IF EXISTS default_permissions;

      ALTER TABLE chats
        DROP COLUMN IF EXISTS slow_mode_seconds;
    `,
  },
  {
    id: '20260607_call_participants',
    sql: `
      ALTER TABLE calls
        ALTER COLUMN recipient_id DROP NOT NULL;

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

      INSERT INTO call_participants (call_id, user_id, role, state, joined_at, left_at)
      SELECT id, initiator_id, 'initiator',
             CASE
               WHEN status IN ('accepted', 'ended') THEN 'connected'
               WHEN status = 'ringing' THEN 'connected'
               ELSE status
             END,
             created_at,
             ended_at
      FROM calls
      ON CONFLICT (call_id, user_id) DO NOTHING;

      INSERT INTO call_participants (call_id, user_id, role, state, joined_at, left_at)
      SELECT id, recipient_id, 'member',
             CASE
               WHEN status = 'accepted' THEN 'connected'
               WHEN status = 'ringing' THEN 'ringing'
               ELSE status
             END,
             answered_at,
             ended_at
      FROM calls
      WHERE recipient_id IS NOT NULL
      ON CONFLICT (call_id, user_id) DO NOTHING;
    `,
    downSql: `
      DELETE FROM call_participants
      WHERE call_id IN (SELECT id FROM calls);
    `,
  },
  {
    id: '20260607_audio_media_kind',
    sql: `
      ALTER TABLE media_files DROP CONSTRAINT IF EXISTS media_files_kind_check;
      ALTER TABLE media_files
        ADD CONSTRAINT media_files_kind_check
        CHECK (kind IN ('image', 'video', 'voice', 'audio', 'file'));
    `,
    downSql: `
      ALTER TABLE media_files DROP CONSTRAINT IF EXISTS media_files_kind_check;
      ALTER TABLE media_files
        ADD CONSTRAINT media_files_kind_check
        CHECK (kind IN ('image', 'video'));
    `,
  },
  {
    id: '20260608_totp_2fa',
    sql: `
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS totp_secret TEXT;

      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS totp_pending_secret TEXT;

      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS totp_enabled_at TIMESTAMPTZ;
    `,
    downSql: `
      ALTER TABLE users
        DROP COLUMN IF EXISTS totp_enabled_at;

      ALTER TABLE users
        DROP COLUMN IF EXISTS totp_pending_secret;

      ALTER TABLE users
        DROP COLUMN IF EXISTS totp_secret;
    `,
  },
  {
    id: '20260610_live_wall',
    sql: `
      CREATE TABLE IF NOT EXISTS wall_messages (
        id UUID PRIMARY KEY,
        text TEXT NOT NULL,
        hue SMALLINT NOT NULL DEFAULT 20,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS wall_messages_created_idx
        ON wall_messages(created_at DESC);
    `,
    downSql: `
      DROP TABLE IF EXISTS wall_messages;
    `,
  },
  {
    id: '20260612_key_backups',
    sql: `
      CREATE TABLE IF NOT EXISTS key_backups (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        payload TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
    downSql: `
      DROP TABLE IF EXISTS key_backups;
    `,
  },
  {
    id: '20260616_link_preview',
    sql: `
      ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS link_preview JSONB;
    `,
    downSql: `
      ALTER TABLE messages
        DROP COLUMN IF EXISTS link_preview;
    `,
  },
  {
    id: '20260617_discussion_groups',
    sql: `
      ALTER TABLE chats
        ADD COLUMN IF NOT EXISTS linked_group_id UUID REFERENCES chats(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS chats_linked_group_idx ON chats(linked_group_id);
    `,
    downSql: `
      ALTER TABLE chats DROP COLUMN IF EXISTS linked_group_id;
    `,
  },
  {
    id: '20260617_user_contacts',
    sql: `
      CREATE TABLE IF NOT EXISTS user_contacts (
        owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        contact_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (owner_id, contact_user_id),
        CHECK (owner_id <> contact_user_id)
      );

      CREATE INDEX IF NOT EXISTS user_contacts_contact_idx
        ON user_contacts(contact_user_id, created_at DESC);
    `,
    downSql: `
      DROP TABLE IF EXISTS user_contacts;
    `,
  },
  {
    id: '20260617_reports_review',
    sql: `
      ALTER TABLE reports
        ADD COLUMN IF NOT EXISTS admin_note TEXT,
        ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL;
    `,
    downSql: `
      ALTER TABLE reports
        DROP COLUMN IF EXISTS admin_note,
        DROP COLUMN IF EXISTS reviewed_by;
    `,
  },
  {
    id: '20260617_cloud_password',
    sql: `
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS cloud_password_hash TEXT,
        ADD COLUMN IF NOT EXISTS cloud_password_salt TEXT,
        ADD COLUMN IF NOT EXISTS cloud_password_hint TEXT,
        ADD COLUMN IF NOT EXISTS cloud_password_set_at TIMESTAMPTZ;
    `,
    downSql: `
      ALTER TABLE users
        DROP COLUMN IF EXISTS cloud_password_hash,
        DROP COLUMN IF EXISTS cloud_password_salt,
        DROP COLUMN IF EXISTS cloud_password_hint,
        DROP COLUMN IF EXISTS cloud_password_set_at;
    `,
  },
  {
    id: '20260617_phone_auth',
    sql: `
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS phone TEXT;

      CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique_idx
        ON users(phone)
        WHERE phone IS NOT NULL;

      CREATE TABLE IF NOT EXISTS phone_login_codes (
        phone TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS phone_login_codes_expires_idx
        ON phone_login_codes(expires_at);
    `,
    downSql: `
      DROP TABLE IF EXISTS phone_login_codes;
      DROP INDEX IF EXISTS users_phone_unique_idx;

      ALTER TABLE users
        DROP COLUMN IF EXISTS phone;
    `,
  },
  {
    id: '20260617_sticker_packs',
    sql: `
      CREATE TABLE IF NOT EXISTS sticker_packs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT '🎭',
        author TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sticker_pack_items (
        pack_id TEXT NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        emoji TEXT NOT NULL,
        title TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (pack_id, id)
      );

      CREATE INDEX IF NOT EXISTS sticker_pack_items_pack_idx
        ON sticker_pack_items(pack_id, sort_order);

      CREATE TABLE IF NOT EXISTS user_sticker_packs (
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pack_id TEXT NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, pack_id)
      );

      CREATE INDEX IF NOT EXISTS user_sticker_packs_user_idx
        ON user_sticker_packs(user_id, sort_order, installed_at);

      INSERT INTO sticker_packs (id, title, icon, author, sort_order, is_default) VALUES
        ('launch', 'Launch', '🚀', 'Onda', 0, TRUE),
        ('vibes',  'Vibes',  '🌊', 'Onda', 1, TRUE),
        ('feels',  'Feels',  '😊', 'Onda', 2, TRUE),
        ('work',   'Work',   '💼', 'Onda', 3, TRUE)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO sticker_pack_items (pack_id, id, emoji, title, sort_order) VALUES
        ('launch','ship','🚀','Ship it',0), ('launch','ok','👌','OK',1),
        ('launch','done','✅','Done',2),    ('launch','fire','🔥','Hot',3),
        ('launch','eyes','👀','Looking',4), ('launch','clap','👏','Nice',5),
        ('launch','think','🤔','Hmm',6),   ('launch','100','💯','Perfect',7),
        ('vibes','wave','🌊','Wave',0),     ('vibes','sun','☀️','Sunny',1),
        ('vibes','moon','🌙','Night',2),    ('vibes','star','⭐','Star',3),
        ('vibes','sparkles','✨','Magic',4),('vibes','rainbow','🌈','Rainbow',5),
        ('vibes','flower','🌸','Bloom',6),  ('vibes','leaf','🍃','Fresh',7),
        ('feels','smile','😊','Happy',0),   ('feels','laugh','😂','Lol',1),
        ('feels','love','🥰','Love',2),     ('feels','cry','😢','Sad',3),
        ('feels','angry','😤','Angry',4),   ('feels','cool','😎','Cool',5),
        ('feels','nervous','😬','Nervous',6),('feels','sleep','😴','Sleepy',7),
        ('work','laptop','💻','Working',0), ('work','coffee','☕','Coffee',1),
        ('work','meeting','📅','Meeting',2),('work','chart','📈','Growing',3),
        ('work','deadline','⏰','Deadline',4),('work','idea','💡','Idea',5),
        ('work','bug','🐛','Bug',6),        ('work','deploy','🎯','Deploy',7)
      ON CONFLICT (pack_id, id) DO NOTHING;
    `,
    downSql: `
      DROP TABLE IF EXISTS user_sticker_packs;
      DROP TABLE IF EXISTS sticker_pack_items;
      DROP TABLE IF EXISTS sticker_packs;
    `,
  },
  {
    id: '20260617_stories',
    sql: `
      CREATE TABLE IF NOT EXISTS stories (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        text TEXT NOT NULL DEFAULT '',
        bg_color TEXT NOT NULL DEFAULT '#7c3aed',
        media_url TEXT,
        media_kind TEXT,
        privacy TEXT NOT NULL DEFAULT 'contacts',
        expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS stories_user_idx
        ON stories(user_id, expires_at DESC);

      CREATE INDEX IF NOT EXISTS stories_expires_idx
        ON stories(expires_at);

      CREATE TABLE IF NOT EXISTS story_views (
        story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        viewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (story_id, viewer_id)
      );

      CREATE INDEX IF NOT EXISTS story_views_viewer_idx
        ON story_views(viewer_id, viewed_at DESC);
    `,
    downSql: `
      DROP TABLE IF EXISTS story_views;
      DROP TABLE IF EXISTS stories;
    `,
  },
  {
    id: '20260617_qr_login',
    sql: `
      CREATE TABLE IF NOT EXISTS qr_tokens (
        token TEXT PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '3 minutes',
        confirmed BOOLEAN NOT NULL DEFAULT FALSE
      );

      CREATE INDEX IF NOT EXISTS qr_tokens_expires_idx
        ON qr_tokens(expires_at);
    `,
    downSql: `DROP TABLE IF EXISTS qr_tokens;`,
  },
  {
    id: '20260617_custom_emoji',
    sql: `
      CREATE TABLE IF NOT EXISTS custom_emoji_packs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        thumbnail_url TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT 'Onda',
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_default BOOLEAN NOT NULL DEFAULT FALSE
      );

      CREATE TABLE IF NOT EXISTS custom_emoji_items (
        pack_id TEXT NOT NULL REFERENCES custom_emoji_packs(id) ON DELETE CASCADE,
        shortcode TEXT NOT NULL,
        image_url TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (pack_id, shortcode)
      );

      CREATE INDEX IF NOT EXISTS custom_emoji_items_pack_idx
        ON custom_emoji_items(pack_id, sort_order);

      CREATE TABLE IF NOT EXISTS user_custom_emoji_packs (
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pack_id TEXT NOT NULL REFERENCES custom_emoji_packs(id) ON DELETE CASCADE,
        installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, pack_id)
      );

      CREATE INDEX IF NOT EXISTS user_custom_emoji_packs_user_idx
        ON user_custom_emoji_packs(user_id, installed_at);

      INSERT INTO custom_emoji_packs (id, title, thumbnail_url, author, sort_order, is_default) VALUES
        ('reactions', 'Reactions',   'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2764.png',  'Onda', 0, TRUE),
        ('vibes',     'Vibes',       'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f30a.png', 'Onda', 1, TRUE),
        ('animals',   'Cute Animals','https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f431.png', 'Onda', 2, TRUE)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO custom_emoji_items (pack_id, shortcode, image_url, title, sort_order) VALUES
        ('reactions','heart',      'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2764.png',  'Heart',        0),
        ('reactions','fire',       'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f525.png', 'Fire',         1),
        ('reactions','thumbsup',   'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f44d.png', 'Thumbs Up',    2),
        ('reactions','joy',        'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f602.png', 'Joy',          3),
        ('reactions','sparkles',   'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2728.png',  'Sparkles',     4),
        ('reactions','rocket',     'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f680.png', 'Rocket',       5),
        ('reactions','tada',       'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f389.png', 'Party',        6),
        ('reactions','eyes',       'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f440.png', 'Eyes',         7),
        ('vibes',    'wave',       'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f30a.png', 'Wave',         0),
        ('vibes',    'blossom',    'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f338.png', 'Blossom',      1),
        ('vibes',    'dizzy',      'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f4ab.png', 'Dizzy',        2),
        ('vibes',    'butterfly',  'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f98b.png', 'Butterfly',    3),
        ('vibes',    'hundredpts', 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f4af.png', 'Hundred',      4),
        ('vibes',    'grin',       'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f60a.png', 'Grin',         5),
        ('animals',  'cat',        'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f431.png', 'Cat',          0),
        ('animals',  'dog',        'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f436.png', 'Dog',          1),
        ('animals',  'panda',      'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f43c.png', 'Panda',        2),
        ('animals',  'fox',        'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f98a.png', 'Fox',          3),
        ('animals',  'owl',        'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f989.png', 'Owl',          4),
        ('animals',  'penguin',    'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f427.png', 'Penguin',      5)
      ON CONFLICT (pack_id, shortcode) DO NOTHING;
    `,
    downSql: `
      DROP TABLE IF EXISTS user_custom_emoji_packs;
      DROP TABLE IF EXISTS custom_emoji_items;
      DROP TABLE IF EXISTS custom_emoji_packs;
    `,
  },
  {
    id: '20260618_phone_login_codes_fcm_token',
    sql: `
      ALTER TABLE phone_login_codes
        ADD COLUMN IF NOT EXISTS fcm_token TEXT;
    `,
    downSql: `
      ALTER TABLE phone_login_codes DROP COLUMN IF EXISTS fcm_token;
    `,
  },
  {
    id: '20260618_story_reactions',
    sql: `
      CREATE TABLE IF NOT EXISTS story_reactions (
        story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        user_id  UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
        emoji    TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (story_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS story_reactions_story_idx
        ON story_reactions(story_id, created_at DESC);
    `,
    downSql: `DROP TABLE IF EXISTS story_reactions;`,
  },
  {
    id: '20260618_lottie_stickers',
    sql: `
      ALTER TABLE sticker_pack_items
        ADD COLUMN IF NOT EXISTS lottie_url TEXT NOT NULL DEFAULT '';

      UPDATE sticker_pack_items
      SET lottie_url = '/stickers/wave.json'
      WHERE pack_id = 'vibes' AND id = 'wave';
    `,
    downSql: `
      ALTER TABLE sticker_pack_items
        DROP COLUMN IF EXISTS lottie_url;
    `,
  },
  {
    id: '20260630_privacy_and_disappearing',
    sql: `
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS privacy_phone TEXT NOT NULL DEFAULT 'contacts',
        ADD COLUMN IF NOT EXISTS privacy_last_seen TEXT NOT NULL DEFAULT 'contacts';

      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_privacy_phone_check;
      ALTER TABLE users
        ADD CONSTRAINT users_privacy_phone_check
        CHECK (privacy_phone IN ('everyone', 'contacts', 'nobody'));

      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_privacy_last_seen_check;
      ALTER TABLE users
        ADD CONSTRAINT users_privacy_last_seen_check
        CHECK (privacy_last_seen IN ('everyone', 'contacts', 'nobody'));

      ALTER TABLE chats
        ADD COLUMN IF NOT EXISTS auto_delete_seconds INTEGER;

      ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS disappears_at TIMESTAMPTZ;

      CREATE INDEX IF NOT EXISTS messages_disappears_idx
        ON messages(disappears_at)
        WHERE disappears_at IS NOT NULL;
    `,
    downSql: `
      DROP INDEX IF EXISTS messages_disappears_idx;

      ALTER TABLE messages
        DROP COLUMN IF EXISTS disappears_at;

      ALTER TABLE chats
        DROP COLUMN IF EXISTS auto_delete_seconds;

      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_privacy_last_seen_check;
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_privacy_phone_check;
      ALTER TABLE users
        DROP COLUMN IF EXISTS privacy_phone,
        DROP COLUMN IF EXISTS privacy_last_seen;
    `,
  },
  {
    id: '20260630_message_reads',
    sql: `
      CREATE TABLE IF NOT EXISTS message_reads (
        message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (message_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS message_reads_message_idx ON message_reads(message_id);
      CREATE INDEX IF NOT EXISTS message_reads_user_idx ON message_reads(user_id, read_at DESC);
    `,
    downSql: `DROP TABLE IF EXISTS message_reads;`,
  },
  {
    id: '20260630_unread_and_system',
    sql: `
      ALTER TABLE chat_members
        ADD COLUMN IF NOT EXISTS last_read_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;
      ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS system_type TEXT,
        ADD COLUMN IF NOT EXISTS system_data JSONB;
      CREATE INDEX IF NOT EXISTS messages_system_idx ON messages(chat_id, is_system) WHERE is_system = TRUE;
    `,
    downSql: `
      ALTER TABLE chat_members DROP COLUMN IF EXISTS last_read_message_id;
      ALTER TABLE messages DROP COLUMN IF EXISTS is_system, DROP COLUMN IF EXISTS system_type, DROP COLUMN IF EXISTS system_data;
    `,
  },
  {
    id: '20260701_video_note_media_kind',
    sql: `
      ALTER TABLE media_files DROP CONSTRAINT IF EXISTS media_files_kind_check;
      ALTER TABLE media_files
        ADD CONSTRAINT media_files_kind_check
        CHECK (kind IN ('image', 'video', 'voice', 'audio', 'video_note', 'file'));
    `,
    downSql: `
      ALTER TABLE media_files DROP CONSTRAINT IF EXISTS media_files_kind_check;
      ALTER TABLE media_files
        ADD CONSTRAINT media_files_kind_check
        CHECK (kind IN ('image', 'video', 'voice', 'audio', 'file'));
    `,
  },
  {
    id: '20260701_telegram_import',
    sql: `ALTER TABLE messages ADD COLUMN IF NOT EXISTS imported_from_name TEXT;`,
    downSql: `ALTER TABLE messages DROP COLUMN IF EXISTS imported_from_name;`,
  },
  {
    id: '20260701_avatar_privacy',
    sql: `
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS privacy_avatar TEXT NOT NULL DEFAULT 'contacts';

      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_privacy_avatar_check;
      ALTER TABLE users
        ADD CONSTRAINT users_privacy_avatar_check
        CHECK (privacy_avatar IN ('everyone', 'contacts', 'nobody'));
    `,
    downSql: `
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_privacy_avatar_check;
      ALTER TABLE users DROP COLUMN IF EXISTS privacy_avatar;
    `,
  },
  {
    id: '20260701_story_mentions_highlights',
    sql: `
      ALTER TABLE stories
        ADD COLUMN IF NOT EXISTS mentions JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS is_highlight BOOLEAN NOT NULL DEFAULT FALSE;

      CREATE INDEX IF NOT EXISTS stories_highlight_idx
        ON stories(user_id, is_highlight, created_at DESC)
        WHERE is_highlight = TRUE;
    `,
    downSql: `
      DROP INDEX IF EXISTS stories_highlight_idx;
      ALTER TABLE stories
        DROP COLUMN IF EXISTS mentions,
        DROP COLUMN IF EXISTS is_highlight;
    `,
  },
  {
    id: '20260701_system_message_columns_nullable',
    sql: `
      ALTER TABLE messages ALTER COLUMN sender_id DROP NOT NULL;
      ALTER TABLE messages ALTER COLUMN ciphertext DROP NOT NULL;
      ALTER TABLE messages ALTER COLUMN iv DROP NOT NULL;
      ALTER TABLE messages ALTER COLUMN auth_tag DROP NOT NULL;
      ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_system_or_content_check;
      ALTER TABLE messages ADD CONSTRAINT messages_system_or_content_check
        CHECK (is_system = TRUE OR (sender_id IS NOT NULL AND ciphertext IS NOT NULL AND iv IS NOT NULL AND auth_tag IS NOT NULL));
    `,
    downSql: `
      ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_system_or_content_check;
      ALTER TABLE messages ALTER COLUMN sender_id SET NOT NULL;
      ALTER TABLE messages ALTER COLUMN ciphertext SET NOT NULL;
      ALTER TABLE messages ALTER COLUMN iv SET NOT NULL;
      ALTER TABLE messages ALTER COLUMN auth_tag SET NOT NULL;
    `,
  },
  {
    id: '20260702_job_queue',
    sql: `
      CREATE TABLE IF NOT EXISTS job_queue (
        id UUID PRIMARY KEY,
        type TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_error TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (status IN ('pending', 'processing', 'done', 'dead'))
      );

      CREATE INDEX IF NOT EXISTS job_queue_claim_idx
        ON job_queue(run_at)
        WHERE status = 'pending';

      CREATE INDEX IF NOT EXISTS job_queue_status_idx
        ON job_queue(status, updated_at DESC);
    `,
    downSql: `
      DROP TABLE IF EXISTS job_queue;
    `,
  },
]

async function getAppliedMigrationIds(database) {
  try {
    const appliedResult = await database.query('SELECT id FROM schema_migrations')
    return new Set(appliedResult.rows.map((row) => row.id))
  } catch (error) {
    if (
      error.code === '42P01' ||
      String(error.message || '').includes('schema_migrations')
    ) {
      return new Set()
    }
    throw error
  }
}

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

export async function getMigrationStatus(database) {
  const applied = await getAppliedMigrationIds(database)
  return migrations.map((migration) => ({
    id: migration.id,
    applied: applied.has(migration.id),
  }))
}

export async function rollbackMigrations(database, count = 1) {
  const applied = await getAppliedMigrationIds(database)
  const targets = migrations
    .filter((migration) => applied.has(migration.id))
    .reverse()
    .slice(0, count)

  if (!targets.length) return []

  for (const migration of targets) {
    if (!migration.downSql) {
      throw new Error(`Migration ${migration.id} does not define rollback SQL`)
    }
    await database.exec(migration.downSql)
    await database.query('DELETE FROM schema_migrations WHERE id = $1', [migration.id])
  }

  return targets.map((migration) => migration.id)
}
