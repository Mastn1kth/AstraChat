// Client-side voice message transcription via Whisper running fully
// in-browser (WASM, through @huggingface/transformers — the actively
// maintained successor package to the old @xenova/transformers name) inside
// a dedicated Web Worker. This replaces the previous "over the air" hack
// that played decrypted audio through the speaker while the browser's
// SpeechRecognition API listened via the microphone: that approach worked
// only in Chrome/Edge/Android, was noticeably lossy (speaker/mic round trip),
// and needed live microphone access just to transcribe an already-decrypted
// audio file already on the device.
//
// This module instead:
// - decodes the (already client-side-decrypted) voice message audio to
//   16kHz mono Float32 PCM using the Web Audio API,
// - ships that PCM buffer to a Worker (src/workers/whisperWorker.js) that
//   runs Whisper (whisper-tiny, multilingual) via transformers.js/WASM,
// - never sends any audio or text over the network to our own backend —
//   the only network activity is the one-time Whisper model weight download
//   from the Hugging Face CDN, which the browser caches (Cache Storage) so
//   subsequent transcriptions are fully offline. This mirrors the existing
//   "nothing plaintext leaves the browser" stance used for message
//   translation (src/utils/translate.js).
//
// Feature detection: requires Web Worker support, WebAssembly, and the Web
// Audio API (OfflineAudioContext/AudioContext) to decode+resample audio.
// These are supported in every modern evergreen browser (Chrome, Edge,
// Firefox, Safari 14.1+), which is broader support than the old
// SpeechRecognition-only approach (Firefox/Safari never implemented that
// API at all).

let worker = null
let requestId = 0
const pending = new Map()

export function isSpeechTranscriptionSupported() {
  return typeof window !== 'undefined'
    && typeof Worker !== 'undefined'
    && typeof WebAssembly !== 'undefined'
    && (typeof window.OfflineAudioContext !== 'undefined' || typeof window.AudioContext !== 'undefined')
}

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('../workers/whisperWorker.js', import.meta.url), { type: 'module' })
  worker.onmessage = (event) => {
    const { id, type } = event.data || {}
    const entry = pending.get(id)
    if (!entry) return

    if (type === 'progress') {
      entry.onProgress?.(event.data.info)
      return
    }
    if (type === 'result') {
      pending.delete(id)
      entry.resolve(event.data.text)
      return
    }
    if (type === 'ready') {
      pending.delete(id)
      entry.resolve()
      return
    }
    if (type === 'error') {
      pending.delete(id)
      entry.reject(new Error(event.data.message || 'Transcription failed'))
    }
  }
  worker.onerror = (event) => {
    // Worker-level failure (e.g. failed to even load the module, WASM
    // instantiation error). Reject every in-flight request since we can't
    // tell which one it was for, then reset so the next call gets a fresh
    // worker instead of a permanently broken one.
    const error = new Error(event?.message || 'Transcription worker failed to load')
    pending.forEach((entry) => entry.reject(error))
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

function callWorker(message, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const id = ++requestId
    pending.set(id, { resolve, reject, onProgress })
    try {
      getWorker().postMessage({ id, ...message })
    } catch (error) {
      pending.delete(id)
      reject(error instanceof Error ? error : new Error('Failed to reach transcription worker'))
    }
  })
}

// Decodes an audio URL (already-decrypted blob: URL or same-origin URL) into
// 16kHz mono Float32 PCM samples, the input format Whisper/transformers.js
// expects.
async function decodeAudioTo16kMono(url) {
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('Failed to load audio for transcription')
  const arrayBuffer = await response.arrayBuffer()

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext
  const probeContext = new AudioContextCtor()
  let decoded
  try {
    decoded = await probeContext.decodeAudioData(arrayBuffer.slice(0))
  } finally {
    await probeContext.close().catch(() => {})
  }

  const targetSampleRate = 16000
  const OfflineCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext
  if (!OfflineCtor) {
    // No offline resampling available: fall back to using the decoded
    // buffer's first channel as-is. Whisper's feature extractor expects
    // 16kHz input, so quality degrades if the source isn't already 16kHz,
    // but this keeps the feature working rather than hard-failing.
    return decoded.getChannelData(0).slice()
  }

  const offlineContext = new OfflineCtor(
    1,
    Math.ceil(decoded.duration * targetSampleRate),
    targetSampleRate,
  )
  const source = offlineContext.createBufferSource()
  source.buffer = decoded
  source.connect(offlineContext.destination)
  source.start(0)
  const rendered = await offlineContext.startRendering()
  return rendered.getChannelData(0).slice()
}

// Transcribes a decrypted voice message. Resolves with the recognized text
// (may be an empty string if nothing was recognized) or rejects with an
// Error on failure/unsupported browsers.
export async function transcribeAudioUrl(url, { lang, onProgress } = {}) {
  if (!isSpeechTranscriptionSupported()) {
    return Promise.reject(new Error('Speech transcription is not supported in this browser'))
  }
  if (!url) {
    return Promise.reject(new Error('No audio URL to transcribe'))
  }

  const samples = await decodeAudioTo16kMono(url)
  // Whisper language codes are plain ISO codes ('en', 'ru'); the app's i18n
  // getLang() already returns exactly that, so pass it straight through.
  const language = lang ? lang.split('-')[0] : undefined

  return callWorker(
    { type: 'transcribe', samples, language },
    { onProgress },
  )
}

// Pre-warms the worker/model so the first real transcription in a session
// doesn't pay the full model-download+load latency. Safe to call speculatively
// (e.g. once a voice message is visible); failures are swallowed by the
// caller's own error handling on the next real transcribeAudioUrl call.
export function warmupTranscription({ onProgress } = {}) {
  if (!isSpeechTranscriptionSupported()) return Promise.resolve()
  return callWorker({ type: 'warmup' }, { onProgress }).catch(() => {})
}
