import { useState } from 'react'
import {
  ArrowRight,
  Eye,
  EyeOff,
  FlaskConical,
  Globe,
  LockKeyhole,
  QrCode,
  ShieldCheck,
  UserCircle2,
  Waves,
} from 'lucide-react'
import { useT, useLang, setLang, LANGUAGES } from '../i18n'

const PREVIEW_BUBBLES = [
  { own: false, name: 'Нина Парк', color: '#7C5CBF', text: 'Профиль причёсан — глянешь?' },
  { own: true,  name: 'Вы',        color: '#8B4035', text: 'Уже бегу. Обожаю, как тут тихо.' },
  { own: false, name: 'Гильдия дизайна', color: '#3A7D8B', text: 'Спокойная палитра влита ✦ 5 новых в треде' },
]

export default function AuthScreen({
  pending,
  error,
  totpRequired,
  onLogin,
  onTotpLogin,
  onCancelTotp,
  onRegister,
  onTestLogin,
}) {
  const t = useT()
  const lang = useLang()
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [totpCode, setTotpCode] = useState('')
  const [showRegister, setShowRegister] = useState(false)

  function handleModeSwitch(m) {
    setMode(m)
    setShowRegister(m === 'register')
    setUsername('')
    setPassword('')
    setName('')
    setTotpCode('')
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (mode === 'login') {
      onLogin({ login: username, password })
    } else {
      onRegister({ login: username, username, name, password })
    }
  }

  function handleTotpSubmit(e) {
    e.preventDefault()
    onTotpLogin({ code: totpCode })
  }

  return (
    <main className="astra-auth">
      {/* ── Left panel ── */}
      <div className="astra-left">
        {/* Top bar */}
        <div className="astra-topbar">
          <div className="astra-logo">
            <div className="astra-logo-icon">
              <Waves size={18} />
            </div>
            <span>Onda</span>
          </div>
        </div>

        {/* Headline */}
        <h1 className="astra-headline">
          {t('auth.headline1')}<br />{t('auth.headline2')}<br />
          <em className="astra-em">{t('auth.headlineEm')}</em> {t('auth.headline3')}<br />
          {t('auth.headline4')}
        </h1>
        <p className="astra-sub">{t('auth.sub')}</p>

        {totpRequired ? (
          /* ── TOTP form ── */
          <form className="astra-form" onSubmit={handleTotpSubmit}>
            <div className="astra-form-title">
              <ShieldCheck size={20} /> {t('auth.totpTitle')}
            </div>
            <div className="astra-field">
              <ShieldCheck size={18} className="astra-field-icon" />
              <input
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                placeholder={t('auth.totpCode')}
              />
            </div>
            {error && <p className="astra-error">{error}</p>}
            <button className="astra-cta" type="submit" disabled={pending || totpCode.length !== 6}>
              <span>{pending ? t('auth.checking') : t('auth.verify')}</span>
              <ArrowRight size={18} />
            </button>
            <button type="button" className="astra-link" onClick={() => { setTotpCode(''); onCancelTotp() }}>
              ← {t('auth.back')}
            </button>
          </form>
        ) : (
          /* ── Main form ── */
          <form className="astra-form" onSubmit={handleSubmit}>
            {/* Language cards */}
            <div className="astra-lang-section">
              <div className="astra-lang-label"><Globe size={14} /> {t('set.language')}</div>
              <div className="astra-lang-cards">
                {LANGUAGES.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    className={`astra-lang-card ${lang === l.id ? 'active' : ''}`}
                    onClick={() => setLang(l.id)}
                  >
                    <span className="astra-lang-name">{l.id === 'ru' ? 'Русский' : 'English'}</span>
                    <span className="astra-lang-eng">{l.id === 'ru' ? 'Russian' : 'English'}</span>
                  </button>
                ))}
              </div>
            </div>

            {showRegister && (
              <div className="astra-field">
                <UserCircle2 size={18} className="astra-field-icon" />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('auth.name')}
                  autoComplete="name"
                  minLength={1}
                  maxLength={64}
                  required
                />
              </div>
            )}

            <div className="astra-field">
              <UserCircle2 size={18} className="astra-field-icon" />
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/^@/, '').replace(/\s/g, ''))}
                placeholder={t('auth.loginPlaceholder')}
                autoComplete="username"
                minLength={3}
                maxLength={32}
                required
              />
            </div>

            <div className="astra-field">
              <LockKeyhole size={18} className="astra-field-icon" />
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type={showPassword ? 'text' : 'password'}
                placeholder={t('auth.password')}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={mode === 'login' ? 1 : 10}
                maxLength={128}
                required
              />
              <button
                type="button"
                className="astra-eye"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>

            {error && <p className="astra-error">{error}</p>}

            <button className="astra-cta" type="submit" disabled={pending}>
              <span>{pending ? t('auth.wait') : mode === 'register' ? t('auth.createAccount') : t('auth.next')}</span>
              <ArrowRight size={18} />
            </button>

            <div className="astra-mode-row">
              {mode === 'login' ? (
                <button type="button" className="astra-link" onClick={() => handleModeSwitch('register')}>
                  {t('auth.register')}
                </button>
              ) : (
                <button type="button" className="astra-link" onClick={() => handleModeSwitch('login')}>
                  {t('auth.signin')}
                </button>
              )}
            </div>

            <div className="astra-divider"><span>{t('auth.or')}</span></div>

            <button type="button" className="astra-qr-row" onClick={() => onTestLogin(1)} disabled={pending}>
              <FlaskConical size={20} className="astra-qr-icon" />
              <span>{t('auth.testLogin')}</span>
            </button>
            <button type="button" className="astra-qr-row" onClick={() => onTestLogin(2)} disabled={pending}>
              <QrCode size={20} className="astra-qr-icon" />
              <span>{t('auth.testLogin2')}</span>
            </button>

            <a className="astra-privacy-link" href="/privacy.html" target="_blank" rel="noreferrer">
              {t('auth.privacy')}
            </a>
          </form>
        )}
      </div>

      {/* ── Right panel (decorative) ── */}
      <div className="astra-right">
        <div className="astra-preview">
          {PREVIEW_BUBBLES.map((b, i) => (
            <div key={i} className={`astra-bubble ${b.own ? 'own' : ''}`}>
              {!b.own && (
                <div className="astra-bubble-avatar" style={{ background: b.color }}>
                  {b.name[0]}
                </div>
              )}
              <div className="astra-bubble-body" style={b.own ? { background: b.color } : {}}>
                {!b.own && <span className="astra-bubble-name" style={{ color: b.color }}>{b.name}</span>}
                <span className="astra-bubble-text">{b.text}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
