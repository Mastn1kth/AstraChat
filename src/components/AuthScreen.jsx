import { useState } from 'react'
import { ArrowLeft, ArrowRight, Eye, EyeOff, FlaskConical, LockKeyhole, MessageCircle } from 'lucide-react'

// Step 1: enter username  Step 2: enter name+password (register) or password (login)
export default function AuthScreen({ pending, error, onLogin, onRegister, onTestLogin }) {
  const [mode, setMode] = useState('login')
  const [step, setStep] = useState(1)
  const [username, setUsername] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  function handleStep1(event) {
    event.preventDefault()
    setStep(2)
  }

  function handleBack() {
    setStep(1)
    setShowPassword(false)
  }

  function handleModeSwitch(newMode) {
    setMode(newMode)
    setStep(1)
    setUsername('')
    setShowPassword(false)
  }

  function submit(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password') || '')
    if (mode === 'login') {
      onLogin({ login: username, password })
      return
    }
    const firstName = String(form.get('firstName') || '').trim()
    const lastName = String(form.get('lastName') || '').trim()
    const name = lastName ? `${firstName} ${lastName}` : firstName
    onRegister({ login: username, username, name, password })
  }


  const isStep1 = step === 1

  return (
    <main className="auth-screen">
      <section className="auth-panel">
        <div className="auth-brand auth-brand--center">
          <div className="auth-mark">
            <MessageCircle size={30} />
          </div>
          <div>
            <h1>AstraChat</h1>
            <p>Быстро. Приватно. Зашифровано.</p>
          </div>
        </div>

        {isStep1 && (
          <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
            <button className={mode === 'login' ? 'active' : ''} onClick={() => handleModeSwitch('login')} type="button">
              Войти
            </button>
            <button className={mode === 'register' ? 'active' : ''} onClick={() => handleModeSwitch('register')} type="button">
              Регистрация
            </button>
          </div>
        )}

        {isStep1 ? (
          <form className="auth-form" onSubmit={handleStep1}>
            <label>
              <span>Имя пользователя</span>
              <div className="auth-input">
                <span>@</span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/^@/, '').replace(/\s/g, ''))}
                  autoComplete="off"
                  pattern="[A-Za-z0-9_]{3,32}"
                  title="3–32 символа: буквы, цифры, подчёркивание"
                  minLength={3}
                  maxLength={32}
                  required
                  autoFocus
                  placeholder="username"
                />
              </div>
            </label>

            <button className="auth-submit" type="submit">
              <span>Далее</span>
              <ArrowRight size={19} />
            </button>

            <div className="auth-test-row">
              <button className="auth-test-button" type="button" onClick={() => onTestLogin(1)} disabled={pending}>
                <FlaskConical size={18} />
                <span>Тестовый вход</span>
              </button>
              <button className="auth-test-button" type="button" onClick={() => onTestLogin(2)} disabled={pending}>
                <FlaskConical size={18} />
                <span>Тестовый вход 2</span>
              </button>
            </div>
          </form>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            {mode === 'register' && (
              <>
                <label>
                  <span>Имя</span>
                  <input name="firstName" autoComplete="given-name" minLength={1} maxLength={64} required autoFocus />
                </label>
                <label>
                  <span>Фамилия <span style={{ fontWeight: 400, opacity: 0.6 }}>(необязательно)</span></span>
                  <input name="lastName" autoComplete="family-name" maxLength={64} />
                </label>
              </>
            )}

            <label>
              <span>Пароль</span>
              <div className="auth-input">
                <LockKeyhole size={18} />
                <input
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  minLength={mode === 'login' ? 1 : 10}
                  maxLength={128}
                  required
                  autoFocus={mode === 'login'}
                />
                <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            {error && <p className="auth-error">{error}</p>}

            <div className="auth-step2-actions">
              <button className="auth-back" type="button" onClick={handleBack} aria-label="Назад">
                <ArrowLeft size={18} />
              </button>
              <button className="auth-submit auth-submit--grow" type="submit" disabled={pending}>
                <span>{pending ? 'Подождите...' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}</span>
                {!pending && <ArrowRight size={19} />}
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  )
}
