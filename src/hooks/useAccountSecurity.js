import {
  disableTotp,
  getBlockedUsers,
  getPrivacySettings,
  getSecurityEvents,
  getSessions,
  getTotpStatus,
  markAllSecurityEventsRead,
  markSecurityEventRead,
  startTotpSetup,
  terminateOtherSessions,
  updatePrivacySettings,
  verifyTotpSetup,
} from '../api/client'

export default function useAccountSecurity({ applyServerUser, showToast }) {
  async function loadSessions() {
    const { sessions } = await getSessions()
    return sessions
  }

  async function loadTotpStatus() {
    return getTotpStatus()
  }

  async function beginTotpSetup() {
    return startTotpSetup()
  }

  async function confirmTotpSetup(code) {
    const { user } = await verifyTotpSetup(code)
    applyServerUser(user)
    showToast('Two-factor authentication enabled.')
    return user
  }

  async function turnOffTotp(code) {
    const { user } = await disableTotp(code)
    applyServerUser(user)
    showToast('Two-factor authentication disabled.')
    return user
  }

  async function loadSecurityAlerts(unread = false) {
    const { events } = await getSecurityEvents({ unread })
    return events
  }

  async function markSecurityAlertRead(eventId) {
    await markSecurityEventRead(eventId)
  }

  async function markAllSecurityAlertsRead() {
    await markAllSecurityEventsRead()
    showToast('Security alerts marked as read.')
  }

  async function loadBlockedContacts() {
    const { users } = await getBlockedUsers()
    return users
  }

  async function loadPrivacySettings() {
    return getPrivacySettings()
  }

  async function savePrivacySettings(updates) {
    return updatePrivacySettings(updates)
  }

  async function endOtherSessions() {
    await terminateOtherSessions()
    showToast('Other sessions terminated.')
  }

  return {
    loadSessions,
    loadTotpStatus,
    beginTotpSetup,
    confirmTotpSetup,
    turnOffTotp,
    loadSecurityAlerts,
    markSecurityAlertRead,
    markAllSecurityAlertsRead,
    loadBlockedContacts,
    loadPrivacySettings,
    savePrivacySettings,
    endOtherSessions,
  }
}
