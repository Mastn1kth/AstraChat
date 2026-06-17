import { useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  FlaskConical,
  Globe,
  Hash,
  LockKeyhole,
  QrCode,
  ShieldCheck,
  Smartphone,
  UserCircle2,
  Waves,
} from 'lucide-react'
import { useT, useLang, setLang, LANGUAGES } from '../i18n'

const COUNTRIES = [
  { code: '+7', label: 'Russia / Kazakhstan' },
  { code: '+1', label: 'United States' },
  { code: '+44', label: 'United Kingdom' },
  { code: '+49', label: 'Germany' },
  { code: '+33', label: 'France' },
  { code: '+90', label: 'Turkey' },
  { code: '+971', label: 'UAE' },
]

const PREVIEW_BUBBLES = [
  { own: false, name: 'Nina Park', color: '#7C5CBF', text: 'Profile is ready. Check it?' },
  { own: true, name: 'You', color: '#8B4035', text: 'Already here. Quiet and clean.' },
  { own: false, name: 'Design guild', color: '#3A7D8B', text: 'New thread is live.' },
]

function cleanPhone(value) {
  return value.replace(/[^\d\s()-]/g, '').slice(0, 24)
}

function cleanUsername(value) {
  return value.replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32)
}

export default function AuthScreen({
  pending,
  error,
  totpRequired,
  cloudPasswordRequired,
  cloudPasswordHint,
  onLogin,
  onTotpLogin,
  onCloudPasswordLogin,
  onCancelTotp,
  onPhoneStart,
  onPhoneVerify,
  onTestLogin,
  prefillLogin,
}) {
  const t = useT()
  const lang = useLang()
  const [step, setStep] = useState('phone')
  const [countryCode, setCountryCode] = useState('+7')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [devCode, setDevCode] = useState('')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [legacyOpen, setLegacyOpen] = useState(!!prefillLogin)
  const [legacyLogin, setLegacyLogin] = useState(prefillLogin || '')
  const [legacyPassword, setLegacyPassword] = useState('')
  const [cloudPassword, setCloudPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')

  async function submitPhone(event) {
    event.preventDefault()
    const result = await onPhoneStart({ countryCode, phone })
    setDevCode(result?.devCode || '')
    setCode(result?.devCode || '')
    setStep('code')
  }

  async function submitCode(event) {
    event.preventDefault()
    const result = await onPhoneVerify({ countryCode, phone, code })
    if (result?.profileRequired) setStep('profile')
  }

  async function submitProfile(event) {
    event.preventDefault()
    await onPhoneVerify({ countryCode, phone, code, name, username })
  }

  function goBackToPhone() {
    setStep('phone')
    setCode('')
    setDevCode('')
    setName('')
    setUsername('')
  }

  if (cloudPasswordRequired) {
    return (
      <main className="astra-auth">
        <div className="astra-left">
          <div className="astra-logo"><div className="astra-logo-icon"><Waves size={18} /></div><span>Onda</span></div>
          <form className="astra-form" onSubmit={(event) => { event.preventDefault(); onCloudPasswordLogin({ cloudPassword }) }}>
            <div className="astra-form-title"><LockKeyhole size={20} /> Two-step verification</div>
            {cloudPasswordHint && <p className="astra-hint">Hint: <em>{cloudPasswordHint}</em></p>}
            <div className="astra-field">
              <LockKeyhole size={18} className="astra-field-icon" />
              <input value={cloudPassword} onChange={(event) => setCloudPassword(event.target.value)} type="password" autoFocus placeholder="Cloud password" />
            </div>
            {error && <p className="astra-error">{error}</p>}
            <button className="astra-cta" type="submit" disabled={pending || !cloudPassword}>
              <span>{pending ? t('auth.checking') : t('auth.verify')}</span><ArrowRight size={18} />
            </button>
            <button type="button" className="astra-link" onClick={onCancelTotp}>Back</button>
          </form>
        </div>
      </main>
    )
  }

  if (totpRequired) {
    return (
      <main className="astra-auth">
        <div className="astra-left">
          <div className="astra-logo"><div className="astra-logo-icon"><Waves size={18} /></div><span>Onda</span></div>
          <form className="astra-form" onSubmit={(event) => { event.preventDefault(); onTotpLogin({ code: totpCode }) }}>
            <div className="astra-form-title"><ShieldCheck size={20} /> {t('auth.totpTitle')}</div>
            <div className="astra-field">
              <ShieldCheck size={18} className="astra-field-icon" />
              <input value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoFocus placeholder={t('auth.totpCode')} />
            </div>
            {error && <p className="astra-error">{error}</p>}
            <button className="astra-cta" type="submit" disabled={pending || totpCode.length !== 6}>
              <span>{pending ? t('auth.checking') : t('auth.verify')}</span><ArrowRight size={18} />
            </button>
            <button type="button" className="astra-link" onClick={onCancelTotp}>Back</button>
          </form>
        </div>
      </main>
    )
  }

  return (
    <main className="astra-auth">
      <div className="astra-left">
        <div className="astra-topbar">
          <div className="astra-logo">
            <div className="astra-logo-icon"><Waves size={18} /></div>
            <span>Onda</span>
          </div>
        </div>

        <h1 className="astra-headline">
          Onda<br />
          <em className="astra-em">phone-first</em><br />
          messenger.
        </h1>
        <p className="astra-sub">Enter your phone number. Onda will give you a login code.</p>

        <form
          className="astra-form"
          onSubmit={step === 'phone' ? submitPhone : step === 'code' ? submitCode : submitProfile}
        >
          <div className="astra-lang-section">
            <div className="astra-lang-label"><Globe size={14} /> {t('set.language')}</div>
            <div className="astra-lang-cards">
              {LANGUAGES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`astra-lang-card ${lang === item.id ? 'active' : ''}`}
                  onClick={() => setLang(item.id)}
                >
                  <span className="astra-lang-name">{item.id === 'ru' ? 'Русский' : 'English'}</span>
                  <span className="astra-lang-eng">{item.id === 'ru' ? 'Russian' : 'English'}</span>
                </button>
              ))}
            </div>
          </div>

          {step === 'phone' && (
            <>
              <div className="astra-field">
                <Smartphone size={18} className="astra-field-icon" />
                <select value={countryCode} onChange={(event) => setCountryCode(event.target.value)} aria-label="Country code">
                  {COUNTRIES.map((country) => (
                    <option key={country.code} value={country.code}>{country.code} {country.label}</option>
                  ))}
                </select>
              </div>
              <div className="astra-field">
                <Smartphone size={18} className="astra-field-icon" />
                <input
                  value={phone}
                  onChange={(event) => setPhone(cleanPhone(event.target.value))}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="Phone number"
                  minLength={4}
                  required
                  autoFocus
                />
              </div>
            </>
          )}

          {step === 'code' && (
            <>
              <button type="button" className="astra-link" onClick={goBackToPhone}>
                <ArrowLeft size={14} /> Change phone
              </button>
              <div className="astra-form-title"><ShieldCheck size={20} /> Enter code</div>
              <p className="astra-hint">Code for {countryCode} {phone}</p>
              {devCode && <p className="astra-hint">Local dev code: <strong>{devCode}</strong></p>}
              <div className="astra-field">
                <ShieldCheck size={18} className="astra-field-icon" />
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  maxLength={6}
                  required
                  autoFocus
                />
              </div>
            </>
          )}

          {step === 'profile' && (
            <>
              <button type="button" className="astra-link" onClick={() => setStep('code')}>
                <ArrowLeft size={14} /> Back to code
              </button>
              <div className="astra-form-title"><UserCircle2 size={20} /> Create profile</div>
              <div className="astra-field">
                <UserCircle2 size={18} className="astra-field-icon" />
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value.slice(0, 64))}
                  autoComplete="name"
                  placeholder="Nickname"
                  required
                  autoFocus
                />
              </div>
              <div className="astra-field">
                <Hash size={18} className="astra-field-icon" />
                <input
                  value={username}
                  onChange={(event) => setUsername(cleanUsername(event.target.value))}
                  autoComplete="username"
                  placeholder="username"
                  minLength={3}
                  required
                />
              </div>
            </>
          )}

          {error && <p className="astra-error">{error}</p>}

          <button
            className="astra-cta"
            type="submit"
            disabled={
              pending ||
              (step === 'phone' && phone.replace(/\D/g, '').length < 4) ||
              (step === 'code' && code.length !== 6) ||
              (step === 'profile' && (!name.trim() || username.length < 3))
            }
          >
            <span>
              {pending
                ? t('auth.wait')
                : step === 'phone'
                  ? 'Send code'
                  : step === 'code'
                    ? 'Continue'
                    : 'Create account'}
            </span>
            <ArrowRight size={18} />
          </button>

          <button type="button" className="astra-link" onClick={() => setLegacyOpen((value) => !value)}>
            Login with password
          </button>

          {legacyOpen && (
            <div className="astra-legacy-login">
              <div className="astra-field">
                <UserCircle2 size={18} className="astra-field-icon" />
                <input value={legacyLogin} onChange={(event) => setLegacyLogin(event.target.value)} placeholder="login or username" />
              </div>
              <div className="astra-field">
                <LockKeyhole size={18} className="astra-field-icon" />
                <input value={legacyPassword} onChange={(event) => setLegacyPassword(event.target.value)} type="password" placeholder="password" />
              </div>
              <button
                type="button"
                className="astra-link"
                disabled={pending || !legacyLogin || !legacyPassword}
                onClick={() => onLogin({ login: legacyLogin, password: legacyPassword })}
              >
                Password login
              </button>
            </div>
          )}

          <div className="astra-divider"><span>{t('auth.or')}</span></div>

          <button type="button" className="astra-qr-row" onClick={() => onTestLogin(1)} disabled={pending}>
            <FlaskConical size={20} className="astra-qr-icon" />
            <span>{t('auth.testLogin')}</span>
          </button>
          <button type="button" className="astra-qr-row" onClick={() => onTestLogin(2)} disabled={pending}>
            <QrCode size={20} className="astra-qr-icon" />
            <span>{t('auth.testLogin2')}</span>
          </button>
        </form>
      </div>

      <div className="astra-right">
        <div className="astra-preview">
          {PREVIEW_BUBBLES.map((bubble, index) => (
            <div key={index} className={`astra-bubble ${bubble.own ? 'own' : ''}`}>
              {!bubble.own && (
                <div className="astra-bubble-avatar" style={{ background: bubble.color }}>
                  {bubble.name[0]}
                </div>
              )}
              <div className="astra-bubble-body" style={bubble.own ? { background: bubble.color } : {}}>
                {!bubble.own && <span className="astra-bubble-name" style={{ color: bubble.color }}>{bubble.name}</span>}
                <span className="astra-bubble-text">{bubble.text}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
