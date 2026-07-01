// Web Worker: runs Whisper speech-to-text inference off the main thread via
// @huggingface/transformers (transformers.js), the actively maintained
// successor to the old @xenova/transformers package name. In a browser build
// this resolves to the library's WASM (onnxruntime-web) entry point, so
// inference runs entirely client-side — no network calls other than the
// one-time model weight download, which the browser's Cache Storage keeps
// around across sessions (same "nothing plaintext leaves the browser" trust
// model as src/utils/translate.js, just with zero network calls needed once
// the model is cached).
//
// Model choice: Xenova/whisper-tiny. Verified (see PR notes) to produce
// accurate transcriptions for both English and Russian test audio in this
// environment; whisper-tiny is multilingual (not the `.en`-suffixed
// English-only variant) and is by far the smallest/fastest Whisper checkpoint
// (~39M params, ~150MB as fp32 ONNX weights — see the dtype note below for
// why fp32 rather than the smaller q8 quantized weights), which matters here
// since voice messages in this app are short clips, not long recordings, and
// this runs on arbitrary user devices including low-end/mobile.
import { pipeline } from '@huggingface/transformers'

const MODEL_ID = 'Xenova/whisper-tiny'

let transcriberPromise = null

function getTranscriber(onProgress) {
  if (!transcriberPromise) {
    transcriberPromise = pipeline('automatic-speech-recognition', MODEL_ID, {
      // NOTE: q8 (8-bit quantized) weights load and run fine through
      // onnxruntime-node, but fail at session-creation time on the
      // onnxruntime-web/WASM backend this Worker actually uses in the
      // browser ("Missing required scale ... DequantizeLinear" from a
      // MatMulNBits node in the merged decoder graph) — verified by
      // reproducing the failure in a real browser before shipping. fp32
      // is confirmed working on WASM; it's a larger download (~150MB vs
      // ~75MB for q8) but whisper-tiny is still small in absolute terms
      // and this only downloads once (browser-cached afterwards).
      dtype: 'fp32',
      progress_callback: (info) => {
        if (onProgress) onProgress(info)
      },
    }).catch((error) => {
      // Allow retrying a failed load (e.g. transient network failure while
      // fetching model weights) instead of caching the rejection forever.
      transcriberPromise = null
      throw error
    })
  }
  return transcriberPromise
}

self.onmessage = async (event) => {
  const { id, type } = event.data || {}

  if (type === 'transcribe') {
    const { samples, language } = event.data
    try {
      const transcriber = await getTranscriber((info) => {
        self.postMessage({ id, type: 'progress', info })
      })
      const pcm = samples instanceof Float32Array ? samples : new Float32Array(samples)
      const result = await transcriber(pcm, {
        language: language || undefined,
        task: 'transcribe',
      })
      const text = Array.isArray(result) ? result.map((item) => item.text).join(' ') : result.text
      self.postMessage({ id, type: 'result', text: (text || '').trim() })
    } catch (error) {
      self.postMessage({ id, type: 'error', message: error?.message || String(error) })
    }
    return
  }

  if (type === 'warmup') {
    try {
      await getTranscriber((info) => {
        self.postMessage({ id, type: 'progress', info })
      })
      self.postMessage({ id, type: 'ready' })
    } catch (error) {
      self.postMessage({ id, type: 'error', message: error?.message || String(error) })
    }
  }
}
