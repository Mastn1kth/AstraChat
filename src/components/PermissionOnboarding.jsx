import { Bell, Camera, CheckCircle2, Mic, ShieldCheck, X } from 'lucide-react'
import { useState } from 'react'
import {
  markPermissionOnboardingComplete,
  requestCorePermissions,
} from '../utils/permissions'

const PERMISSIONS = [
  {
    key: 'notifications',
    icon: Bell,
    title: 'Push notifications',
    text: 'Login codes, new messages and call alerts.',
  },
  {
    key: 'microphone',
    icon: Mic,
    title: 'Microphone',
    text: 'Voice calls, video calls and voice messages.',
  },
  {
    key: 'camera',
    icon: Camera,
    title: 'Camera',
    text: 'Video calls and quick photo sharing.',
  },
]

const STATUS_LABELS = {
  granted: 'Allowed',
  denied: 'Blocked',
  permission: 'Blocked',
  unsupported: 'Not supported',
  server: 'Server setup needed',
  unavailable: 'Unavailable',
  'missing-device': 'No device',
  register: 'Registration failed',
}

function statusLabel(value) {
  if (!value) return 'Not asked'
  return STATUS_LABELS[value] || value
}

export default function PermissionOnboarding({ onClose }) {
  const [busy, setBusy] = useState(false)
  const [statuses, setStatuses] = useState({})

  const finish = () => {
    markPermissionOnboardingComplete()
    onClose()
  }

  const allowAll = async () => {
    setBusy(true)
    const nextStatuses = await requestCorePermissions()
    setStatuses(nextStatuses)
    setBusy(false)
    markPermissionOnboardingComplete()
  }

  return (
    <div className="permission-onboarding" role="dialog" aria-modal="true" aria-labelledby="permission-title">
      <section className="permission-sheet">
        <header>
          <div className="permission-mark">
            <ShieldCheck size={24} />
          </div>
          <button className="permission-close" type="button" onClick={finish} aria-label="Close permissions">
            <X size={18} />
          </button>
          <h2 id="permission-title">Set up Onda access</h2>
          <p>Allow the permissions the messenger needs for codes, messages, photos and calls.</p>
        </header>

        <div className="permission-list">
          {PERMISSIONS.map((item) => {
            const Icon = item.icon
            const status = statuses[item.key]
            return (
              <div className="permission-row" key={item.key}>
                <div className="permission-icon">
                  <Icon size={20} />
                </div>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.text}</span>
                </div>
                <small className={status === 'granted' ? 'allowed' : ''}>
                  {status === 'granted' && <CheckCircle2 size={14} />}
                  {statusLabel(status)}
                </small>
              </div>
            )
          })}
        </div>

        <div className="permission-actions">
          <button type="button" onClick={finish} disabled={busy}>
            Later
          </button>
          <button className="primary-button" type="button" onClick={allowAll} disabled={busy}>
            {busy ? 'Requesting...' : 'Allow all'}
          </button>
        </div>
      </section>
    </div>
  )
}
