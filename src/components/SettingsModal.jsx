import { Moon, RotateCcw, Sun, X } from 'lucide-react'

const CHAT_BACKGROUNDS = [
  { id: 'default', label: 'Default' },
  { id: 'plain', label: 'Plain' },
  { id: 'lavender', label: 'Lavender' },
  { id: 'mint', label: 'Mint' },
  { id: 'peach', label: 'Peach' },
  { id: 'night', label: 'Night' },
]

export default function SettingsModal({ user, settings, onUpdateSettings, onUpdateUser, onReset, onClose }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="modal settings-modal">
        <header>
          <div>
            <strong>Settings</strong>
            <p>Local user preferences for this browser.</p>
          </div>
          <button onClick={onClose} aria-label="Close settings">
            <X size={20} />
          </button>
        </header>

        <label className="field-block">
          <span>Name</span>
          <input value={user.name} onChange={(event) => onUpdateUser({ name: event.target.value })} />
        </label>
        <label className="field-block">
          <span>Username</span>
          <input value={user.username} onChange={(event) => onUpdateUser({ username: event.target.value })} />
        </label>

        <div className="setting-row">
          <span>Theme</span>
          <div className="segmented">
            <button
              className={settings.theme === 'light' ? 'active' : ''}
              onClick={() => onUpdateSettings({ theme: 'light' })}
            >
              <Sun size={16} /> Light
            </button>
            <button
              className={settings.theme === 'dark' ? 'active' : ''}
              onClick={() => onUpdateSettings({ theme: 'dark' })}
            >
              <Moon size={16} /> Dark
            </button>
          </div>
        </div>

        <label className="toggle-row">
          <span>Desktop notifications</span>
          <input
            type="checkbox"
            checked={settings.notifications}
            onChange={(event) => onUpdateSettings({ notifications: event.target.checked })}
          />
        </label>

        <label className="toggle-row">
          <span>Message sound</span>
          <input
            type="checkbox"
            checked={settings.sound !== false}
            onChange={(event) => onUpdateSettings({ sound: event.target.checked })}
          />
        </label>

        <div className="setting-row setting-row--column">
          <span>Chat wallpaper</span>
          <div className="wallpaper-grid">
            {CHAT_BACKGROUNDS.map((bg) => (
              <button
                key={bg.id}
                type="button"
                className={`wallpaper-swatch wallpaper-${bg.id} ${
                  (settings.chatBackground || 'default') === bg.id ? 'active' : ''
                }`}
                onClick={() => onUpdateSettings({ chatBackground: bg.id })}
                aria-label={bg.label}
                title={bg.label}
              />
            ))}
          </div>
        </div>

        <div className="settings-grid">
          <button onClick={() => onUpdateSettings({ toast: 'Privacy matrix is UI-only: phone, last seen, profile photo and calls.' })}>
            Privacy and security
          </button>
          <button onClick={() => onUpdateSettings({ toast: 'Active sessions are available in the left Privacy and security menu.' })}>
            Devices and sessions
          </button>
          <button onClick={() => onUpdateSettings({ toast: 'Folders can be represented locally; backend sync is not connected.' })}>
            Chat folders
          </button>
          <button onClick={() => onUpdateSettings({ toast: 'Payments, gifts and internal balance are UI/API contracts only.' })}>
            Payments and gifts
          </button>
          <button onClick={() => onUpdateSettings({ toast: 'Secret chats require real end-to-end encryption and are not implemented here.' })}>
            Secret chats
          </button>
          <button onClick={() => onUpdateSettings({ toast: 'Stories are local UI mock states in this MVP.' })}>
            Stories archive
          </button>
        </div>

        <button className="reset-button" onClick={onReset}>
          <RotateCcw size={17} /> Reset local MVP data
        </button>
      </section>
    </div>
  )
}
