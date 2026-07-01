import { afterEach, describe, expect, it } from 'vitest'
import { isSpeechTranscriptionSupported } from './speechTranscription'

// This test environment runs plain Node (no jsdom), so `window` does not
// exist as a global by default. Simulate both the "no window at all" case
// (e.g. SSR) and the browser feature-detection cases by stubbing a global
// `window` object for the duration of each test.

describe('isSpeechTranscriptionSupported', () => {
  const hadWindow = 'window' in globalThis
  const originalWindow = globalThis.window

  afterEach(() => {
    if (hadWindow) globalThis.window = originalWindow
    else delete globalThis.window
  })

  it('returns false when window is not defined at all', () => {
    delete globalThis.window
    expect(isSpeechTranscriptionSupported()).toBe(false)
  })

  it('returns false when neither SpeechRecognition nor webkitSpeechRecognition exist', () => {
    globalThis.window = {}
    expect(isSpeechTranscriptionSupported()).toBe(false)
  })

  it('returns true when SpeechRecognition exists', () => {
    globalThis.window = { SpeechRecognition: function SpeechRecognition() {} }
    expect(isSpeechTranscriptionSupported()).toBe(true)
  })

  it('returns true when webkitSpeechRecognition exists', () => {
    globalThis.window = { webkitSpeechRecognition: function webkitSpeechRecognition() {} }
    expect(isSpeechTranscriptionSupported()).toBe(true)
  })
})
