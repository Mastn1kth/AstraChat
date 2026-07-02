import { afterEach, describe, expect, it } from 'vitest'
import { isSpeechTranscriptionSupported } from './speechTranscription'

// This test environment runs plain Node (no jsdom), so `window`, `Worker`,
// `WebAssembly` do not exist as globals by default. Simulate both the
// "nothing available at all" case (e.g. SSR) and the browser
// feature-detection cases by stubbing globals for the duration of each test.
// Real Whisper inference (via the Worker + @huggingface/transformers) is
// intentionally not exercised here — it requires a real browser Worker/WASM
// runtime and a multi-hundred-MB model download, which is not something to
// run in a unit test suite. That path was verified manually against real
// English and Russian speech samples (see PR notes).

describe('isSpeechTranscriptionSupported', () => {
  const hadWindow = 'window' in globalThis
  const originalWindow = globalThis.window
  const hadWorker = 'Worker' in globalThis
  const originalWorker = globalThis.Worker
  const hadWasm = 'WebAssembly' in globalThis
  const originalWasm = globalThis.WebAssembly

  afterEach(() => {
    if (hadWindow) globalThis.window = originalWindow
    else delete globalThis.window
    if (hadWorker) globalThis.Worker = originalWorker
    else delete globalThis.Worker
    if (hadWasm) globalThis.WebAssembly = originalWasm
    else delete globalThis.WebAssembly
  })

  function stubSupportedEnvironment(windowOverrides = {}) {
    globalThis.Worker = function Worker() {}
    globalThis.WebAssembly = {}
    globalThis.window = { AudioContext: function AudioContext() {}, ...windowOverrides }
  }

  it('returns false when window is not defined at all', () => {
    delete globalThis.window
    expect(isSpeechTranscriptionSupported()).toBe(false)
  })

  it('returns false when Worker is unavailable', () => {
    delete globalThis.Worker
    globalThis.WebAssembly = {}
    globalThis.window = { AudioContext: function AudioContext() {} }
    expect(isSpeechTranscriptionSupported()).toBe(false)
  })

  it('returns false when WebAssembly is unavailable', () => {
    globalThis.Worker = function Worker() {}
    delete globalThis.WebAssembly
    globalThis.window = { AudioContext: function AudioContext() {} }
    expect(isSpeechTranscriptionSupported()).toBe(false)
  })

  it('returns false when neither AudioContext nor OfflineAudioContext exist', () => {
    globalThis.Worker = function Worker() {}
    globalThis.WebAssembly = {}
    globalThis.window = {}
    expect(isSpeechTranscriptionSupported()).toBe(false)
  })

  it('returns true when Worker, WebAssembly and AudioContext all exist', () => {
    stubSupportedEnvironment()
    expect(isSpeechTranscriptionSupported()).toBe(true)
  })

  it('returns true when OfflineAudioContext is present instead of AudioContext', () => {
    globalThis.Worker = function Worker() {}
    globalThis.WebAssembly = {}
    globalThis.window = { OfflineAudioContext: function OfflineAudioContext() {} }
    expect(isSpeechTranscriptionSupported()).toBe(true)
  })

  // Simulates a pre-16.4 WKWebView (iOS 15.0-16.3): WebAssembly exists but
  // has no SIMD support, which is what the shipped ort-wasm-simd-threaded
  // build requires. WebAssembly.validate is real in that environment (it's
  // been part of WASM since the MVP), it just correctly reports the SIMD
  // test module as invalid.
  it('returns false when WebAssembly has no SIMD support', () => {
    globalThis.Worker = function Worker() {}
    globalThis.WebAssembly = { validate: () => false }
    globalThis.window = { AudioContext: function AudioContext() {} }
    expect(isSpeechTranscriptionSupported()).toBe(false)
  })

  it('returns true when WebAssembly.validate reports SIMD support', () => {
    globalThis.Worker = function Worker() {}
    globalThis.WebAssembly = { validate: () => true }
    globalThis.window = { AudioContext: function AudioContext() {} }
    expect(isSpeechTranscriptionSupported()).toBe(true)
  })
})
