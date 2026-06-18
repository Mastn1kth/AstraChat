import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Globe,
  Hash,
  LockKeyhole,
  QrCode,
  RefreshCw,
  ShieldCheck,
  UserCircle2,
  Waves,
} from 'lucide-react'
import QRCodeLib from 'qrcode'
import { useT, useLang, setLang, LANGUAGES } from '../i18n'
import { startQrLogin, pollQrStatus } from '../api/client'

function QrLoginPanel({ onBack, onSuccess }) {
  const t = useT()
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [token, setToken] = useState('')
  const [status, setStatus] = useState('loading')
  const [retryKey, setRetryKey] = useState(0)
  const pollRef = useRef(null)

  function handleRetry() {
    setStatus('loading')
    setQrDataUrl('')
    setToken('')
    setRetryKey((k) => k + 1)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { token: t } = await startQrLogin()
        if (cancelled) return
        const url = `${window.location.origin}/qr-login?token=${encodeURIComponent(t)}`
        const dataUrl = await QRCodeLib.toDataURL(url, { width: 200, margin: 2, color: { dark: '#1a1a2e', light: '#ffffff' } })
        if (cancelled) return
        setToken(t)
        setQrDataUrl(dataUrl)
        setStatus('pending')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
      clearInterval(pollRef.current)
    }
  }, [retryKey])

  useEffect(() => {
    if (status !== 'pending' || !token) return
    clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const data = await pollQrStatus(token)
        if (data.status === 'confirmed') {
          clearInterval(pollRef.current)
          setStatus('confirmed')
          onSuccess?.(data.user)
        } else if (data.status === 'expired') {
          clearInterval(pollRef.current)
          setStatus('expired')
        }
      } catch {
        // keep polling on transient errors
      }
    }, 2000)
    return () => clearInterval(pollRef.current)
  }, [status, token, onSuccess])

  return (
    <main className="astra-auth">
      <div className="astra-left">
        <div className="astra-logo"><div className="astra-logo-icon"><Waves size={18} /></div><span>Onda</span></div>
        <div className="astra-form">
          <button type="button" className="astra-link" onClick={onBack} style={{ alignSelf: 'flex-start' }}>
            <ArrowLeft size={14} /> {t('auth.back')}
          </button>
          <div className="astra-form-title"><QrCode size={20} /> {t('auth.qrScanTitle')}</div>
          <p className="astra-hint">{t('auth.qrScanHint')}</p>

          <div className="qr-box">
            {status === 'loading' && <div className="qr-placeholder">{t('auth.qrGenerating')}</div>}
            {status === 'error' && <div className="qr-placeholder qr-error">{t('auth.qrFailed')}</div>}
            {status === 'expired' && <div className="qr-placeholder qr-error">{t('auth.qrExpired')}</div>}
            {status === 'confirmed' && <div className="qr-placeholder qr-ok">{t('auth.qrConfirmed')}</div>}
            {status === 'pending' && qrDataUrl && (
              <img src={qrDataUrl} alt="QR code" className="qr-image" />
            )}
          </div>

          {(status === 'expired' || status === 'error') && (
            <button type="button" className="astra-link" onClick={handleRetry}>
              <RefreshCw size={14} /> {t('auth.qrRefresh')}
            </button>
          )}
          {status === 'pending' && (
            <p className="astra-hint" style={{ textAlign: 'center' }}>{t('auth.qrWaiting')}</p>
          )}
        </div>
      </div>
    </main>
  )
}

const COUNTRIES = [
  { code: '+7', label: 'Russia / Kazakhstan', labelRu: 'Россия / Казахстан', flag: '🇷🇺' },
  { code: '+1', label: 'United States', labelRu: 'США', flag: '🇺🇸' },
  { code: '+44', label: 'United Kingdom', labelRu: 'Великобритания', flag: '🇬🇧' },
  { code: '+49', label: 'Germany', labelRu: 'Германия', flag: '🇩🇪' },
  { code: '+33', label: 'France', labelRu: 'Франция', flag: '🇫🇷' },
  { code: '+90', label: 'Turkey', labelRu: 'Турция', flag: '🇹🇷' },
  { code: '+971', label: 'UAE', labelRu: 'ОАЭ', flag: '🇦🇪' },
]

function countryLabel(country, lang) {
  return lang === 'ru' ? country.labelRu : country.label
}

const PREVIEW_BUBBLES = [
  { own: false, nameKey: 'auth.previewName1', textKey: 'auth.previewText1', color: '#7C5CBF' },
  { own: true, nameKey: 'auth.previewName2', textKey: 'auth.previewText2', color: '#8B4035' },
  { own: false, nameKey: 'auth.previewName3', textKey: 'auth.previewText3', color: '#3A7D8B' },
]

function CountryPicker({ value, onChange }) {
  const lang = useLang()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const selected = COUNTRIES.find((country) => country.code === value) || COUNTRIES[0]

  useEffect(() => {
    if (!open) return undefined
    function handleClick(event) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div className="astra-country" ref={ref}>
      <button
        type="button"
        className="astra-country-btn"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="astra-country-flag">{selected.flag}</span>
        <span className="astra-country-code">{selected.code}</span>
        <ChevronDown size={15} className={`astra-country-chev ${open ? 'open' : ''}`} />
      </button>
      {open && (
        <ul className="astra-country-menu" role="listbox">
          {COUNTRIES.map((country) => (
            <li key={country.code}>
              <button
                type="button"
                role="option"
                aria-selected={country.code === value}
                className={`astra-country-item ${country.code === value ? 'active' : ''}`}
                onClick={() => { onChange(country.code); setOpen(false) }}
              >
                <span className="astra-country-flag">{country.flag}</span>
                <span className="astra-country-name">{countryLabel(country, lang)}</span>
                <span className="astra-country-dial">{country.code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function cleanPhone(value) {
  return value.replace(/[^\d\s()-]/g, '').slice(0, 24)
}

function matchDialCode(value) {
  const normalized = String(value || '').replace(/[^\d+]/g, '')
  if (!normalized.startsWith('+')) return null
  return [...COUNTRIES]
    .sort((a, b) => b.code.length - a.code.length)
    .find((country) => normalized.startsWith(country.code)) || null
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
  onQrSuccess,
  prefillLogin,
}) {
  const t = useT()
  const lang = useLang()
  const [step, setStep] = useState('phone')
  const [countryCode, setCountryCode] = useState('+7')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [devCode, setDevCode] = useState('')
  const [codeDelivery, setCodeDelivery] = useState('')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [formError, setFormError] = useState('')
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
    setCodeDelivery(result?.delivery || '')
    setStep('code')
  }

  function handlePhoneChange(value) {
    const country = matchDialCode(value)
    if (country) {
      setCountryCode(country.code)
      setPhone(cleanPhone(value.slice(country.code.length)))
      return
    }
    setPhone(cleanPhone(value))
  }

  async function submitCode(event) {
    event.preventDefault()
    const result = await onPhoneVerify({ countryCode, phone, code })
    if (result?.profileRequired) setStep('profile')
  }

  async function submitProfile(event) {
    event.preventDefault()
    if (password.length < 10) {
      setFormError(t('auth.passwordMin'))
      return
    }
    if (password !== confirmPassword) {
      setFormError(t('auth.passwordMismatch'))
      return
    }
    setFormError('')
    await onPhoneVerify({ countryCode, phone, code, name, username, password })
  }

  function goBackToPhone() {
    setStep('phone')
    setCode('')
    setDevCode('')
    setCodeDelivery('')
    setName('')
    setUsername('')
    setPassword('')
    setConfirmPassword('')
    setFormError('')
  }

  if (step === 'qr') {
    return <QrLoginPanel onBack={() => setStep('phone')} onSuccess={onQrSuccess} />
  }

  if (cloudPasswordRequired) {
    return (
      <main className="astra-auth">
        <div className="astra-left">
          <div className="astra-logo"><div className="astra-logo-icon"><Waves size={18} /></div><span>Onda</span></div>
          <form className="astra-form" onSubmit={(event) => { event.preventDefault(); onCloudPasswordLogin({ cloudPassword }) }}>
            <div className="astra-form-title"><LockKeyhole size={20} /> {t('auth.cloudTitle')}</div>
            {cloudPasswordHint && <p className="astra-hint">{t('auth.cloudHint')} <em>{cloudPasswordHint}</em></p>}
            <div className="astra-field">
              <LockKeyhole size={18} className="astra-field-icon" />
              <input value={cloudPassword} onChange={(event) => setCloudPassword(event.target.value)} type="password" autoFocus placeholder={t('auth.cloudPlaceholder')} />
            </div>
            {error && <p className="astra-error">{error}</p>}
            <button className="astra-cta" type="submit" disabled={pending || !cloudPassword}>
              <span>{pending ? t('auth.checking') : t('auth.verify')}</span><ArrowRight size={18} />
            </button>
            <button type="button" className="astra-link" onClick={onCancelTotp}>{t('auth.back')}</button>
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
            <button type="button" className="astra-link" onClick={onCancelTotp}>{t('auth.back')}</button>
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
          <em className="astra-em">{t('auth.phoneEm')}</em><br />
          {t('auth.phoneNoun')}
        </h1>
        <p className="astra-sub">{t('auth.phoneSub')}</p>

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
            <div className="astra-field astra-phone-field">
              <CountryPicker value={countryCode} onChange={setCountryCode} />
              <span className="astra-phone-sep" />
              <input
                value={phone}
                onChange={(event) => handlePhoneChange(event.target.value)}
                inputMode="tel"
                autoComplete="tel"
                placeholder={t('auth.phonePlaceholder')}
                minLength={4}
                required
                autoFocus
              />
            </div>
          )}

          {step === 'code' && (
            <>
              <button type="button" className="astra-link" onClick={goBackToPhone}>
                <ArrowLeft size={14} /> {t('auth.changePhone')}
              </button>
              <div className="astra-form-title"><ShieldCheck size={20} /> {t('auth.enterCode')}</div>
              {codeDelivery === 'push'
                ? <p className="astra-hint">{t('auth.codePush')}</p>
                : <p className="astra-hint">{t('auth.codeForPhone', { phone: `${countryCode} ${phone}` })}</p>
              }
              {devCode && <p className="astra-hint">{t('auth.devCode')} <strong>{devCode}</strong></p>}
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
                <ArrowLeft size={14} /> {t('auth.backToCode')}
              </button>
              <div className="astra-form-title"><UserCircle2 size={20} /> {t('auth.profileTitle')}</div>
              <div className="astra-field">
                <UserCircle2 size={18} className="astra-field-icon" />
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value.slice(0, 64))}
                  autoComplete="name"
                  placeholder={t('auth.nickname')}
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
                  placeholder={t('auth.usernamePlaceholder')}
                  minLength={3}
                  required
                />
              </div>
              <div className="astra-field">
                <LockKeyhole size={18} className="astra-field-icon" />
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  autoComplete="new-password"
                  placeholder={t('auth.password')}
                  minLength={10}
                  required
                />
              </div>
              <div className="astra-field">
                <LockKeyhole size={18} className="astra-field-icon" />
                <input
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  type="password"
                  autoComplete="new-password"
                  placeholder={t('auth.confirmPassword')}
                  minLength={10}
                  required
                />
              </div>
            </>
          )}

          {(formError || error) && <p className="astra-error">{formError || error}</p>}

          <button
            className="astra-cta"
            type="submit"
            disabled={
              pending ||
              (step === 'phone' && phone.replace(/\D/g, '').length < 4) ||
              (step === 'code' && code.length !== 6) ||
              (step === 'profile' && (
                !name.trim() ||
                username.length < 3 ||
                password.length < 10 ||
                confirmPassword.length < 10 ||
                password !== confirmPassword
              ))
            }
          >
            <span>
              {pending
                ? t('auth.wait')
                : step === 'phone'
                  ? t('auth.sendCode')
                  : step === 'code'
                    ? t('auth.continue')
                    : t('auth.createAccount')}
            </span>
            <ArrowRight size={18} />
          </button>

          <button type="button" className="astra-link" onClick={() => setLegacyOpen((value) => !value)}>
            {t('auth.loginWithPassword')}
          </button>

          {legacyOpen && (
            <div className="astra-legacy-login">
              <div className="astra-field">
                <UserCircle2 size={18} className="astra-field-icon" />
                <input value={legacyLogin} onChange={(event) => setLegacyLogin(event.target.value)} placeholder={t('auth.loginOrUsername')} />
              </div>
              <div className="astra-field">
                <LockKeyhole size={18} className="astra-field-icon" />
                <input value={legacyPassword} onChange={(event) => setLegacyPassword(event.target.value)} type="password" placeholder={t('auth.password')} />
              </div>
              <button
                type="button"
                className="astra-link"
                disabled={pending || !legacyLogin || !legacyPassword}
                onClick={() => onLogin({ login: legacyLogin, password: legacyPassword })}
              >
                {t('auth.passwordLogin')}
              </button>
            </div>
          )}

          <div className="astra-divider"><span>{t('auth.or')}</span></div>

          <button type="button" className="astra-qr-row" onClick={() => setStep('qr')} disabled={pending}>
            <QrCode size={20} className="astra-qr-icon" />
            <span>{t('auth.qrLogin')}</span>
          </button>
        </form>
      </div>

      <div className="astra-right">
        <div className="astra-preview">
          {PREVIEW_BUBBLES.map((bubble, index) => {
            const name = t(bubble.nameKey)
            const text = t(bubble.textKey)
            return (
            <div key={index} className={`astra-bubble ${bubble.own ? 'own' : ''}`}>
              {!bubble.own && (
                <div className="astra-bubble-avatar" style={{ background: bubble.color }}>
                  {name[0] || '?'}
                </div>
              )}
              <div className="astra-bubble-body" style={bubble.own ? { background: bubble.color } : {}}>
                {!bubble.own && <span className="astra-bubble-name" style={{ color: bubble.color }}>{name}</span>}
                <span className="astra-bubble-text">{text}</span>
              </div>
            </div>
            )
          })}
        </div>
      </div>
    </main>
  )
}
