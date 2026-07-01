// Client-side voice message transcription via the browser's native Web Speech
// API (SpeechRecognition / webkitSpeechRecognition). No server changes, no
// API keys, and plaintext audio never leaves the device.
//
// IMPORTANT CONSTRAINT: the Web Speech API's SpeechRecognition interface is
// built to listen to the microphone (a live MediaStream from getUserMedia)
// — it has no API for transcribing an arbitrary pre-recorded audio Blob/File
// directly. There is no `recognition.transcribeBlob(...)` or equivalent in
// any shipping browser. To transcribe an already-recorded (and, in Onda's
// case, already-decrypted) voice message, the only way to feed it into
// SpeechRecognition is to play the audio back out loud through the device's
// speakers/output while recognition is listening on the microphone input —
// effectively an "over-the-air" replay. This is inherently best-effort:
// - Quality depends on speaker volume, microphone sensitivity, and ambient
//   noise; results are noticeably worse than transcribing a live mic feed.
// - It requires microphone permission even though the "input" is really
//   another piece of audio already on the device.
// - It only works in browsers that implement SpeechRecognition at all
//   (Chrome/Edge desktop, Chrome on Android). Firefox and Safari/iOS do not
//   implement this API.
// This module implements exactly that best-effort approach and is exposed
// as an explicit opt-in "Transcribe" action so users understand it is not
// guaranteed to be accurate.

export function isSpeechTranscriptionSupported() {
  return typeof window !== 'undefined'
    && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
}

function getRecognitionCtor() {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

// Transcribes a decrypted voice message by playing it through an <audio>
// element while a SpeechRecognition session listens for speech. Resolves
// with the recognized text (may be an empty string if nothing was
// recognized) or rejects with an Error on failure/unsupported browsers.
export function transcribeAudioUrl(url, { lang } = {}) {
  const Recognition = getRecognitionCtor()
  if (!Recognition) {
    return Promise.reject(new Error('SpeechRecognition is not supported in this browser'))
  }
  if (!url) {
    return Promise.reject(new Error('No audio URL to transcribe'))
  }

  return new Promise((resolve, reject) => {
    const recognition = new Recognition()
    recognition.lang = lang || (typeof navigator !== 'undefined' ? navigator.language : 'en-US') || 'en-US'
    recognition.interimResults = false
    recognition.continuous = true
    recognition.maxAlternatives = 1

    const audio = new Audio(url)
    let finished = false
    const transcripts = []

    const cleanup = () => {
      audio.removeEventListener('ended', onAudioEnded)
      audio.removeEventListener('error', onAudioError)
      audio.pause()
    }

    const finish = (err) => {
      if (finished) return
      finished = true
      cleanup()
      try { recognition.stop() } catch { /* ignore */ }
      if (err) reject(err)
      else resolve(transcripts.join(' ').trim())
    }

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        if (result.isFinal) transcripts.push(result[0].transcript)
      }
    }

    recognition.onerror = (event) => {
      // 'no-speech' just means silence was heard; treat as a normal end
      // rather than a hard failure so short/quiet clips don't error out.
      if (event.error === 'no-speech') return
      finish(new Error(`Speech recognition error: ${event.error}`))
    }

    recognition.onend = () => finish()

    function onAudioEnded() {
      // Give recognition a brief moment to flush any trailing result.
      setTimeout(() => finish(), 400)
    }

    function onAudioError() {
      finish(new Error('Failed to play audio for transcription'))
    }

    audio.addEventListener('ended', onAudioEnded)
    audio.addEventListener('error', onAudioError)

    try {
      recognition.start()
    } catch (err) {
      finish(err instanceof Error ? err : new Error('Failed to start speech recognition'))
      return
    }

    audio.play().catch((err) => {
      finish(err instanceof Error ? err : new Error('Failed to play audio for transcription'))
    })
  })
}
