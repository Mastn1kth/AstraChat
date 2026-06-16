import multer from 'multer'
import sharp from 'sharp'
import ffmpegPath from 'ffmpeg-static'
import { mkdirSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
])

const VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
])

const AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/webm',
  'audio/wav',
  'audio/x-wav',
])

const ENCRYPTED_TYPES = new Set(['application/octet-stream'])

export const mediaUploadMaxBytes = Number(process.env.MEDIA_UPLOAD_MAX_BYTES || 1024 * 1024 * 1024)
const uploadTempDir = process.env.MEDIA_UPLOAD_TMP_DIR || join(tmpdir(), 'astrachat-uploads')
mkdirSync(uploadTempDir, { recursive: true })

export const mediaUpload = multer({
  storage: multer.diskStorage({
    destination(_request, _file, callback) {
      callback(null, uploadTempDir)
    },
    filename(_request, file, callback) {
      callback(null, `${Date.now()}-${randomUUID()}-${file.originalname.replace(/[^\w.-]+/g, '_')}`)
    },
  }),
  limits: {
    fileSize: mediaUploadMaxBytes,
    files: 1,
    fields: 16,
    parts: 18,
  },
  fileFilter(_request, file, callback) {
    if (IMAGE_TYPES.has(file.mimetype) || VIDEO_TYPES.has(file.mimetype) || AUDIO_TYPES.has(file.mimetype) || ENCRYPTED_TYPES.has(file.mimetype)) {
      callback(null, true)
      return
    }
    callback(new Error('Only image, video, audio and encrypted files are supported'))
  },
})

export async function readUploadedFile(file) {
  return readFile(file.path)
}

export async function cleanupUploadedFile(file) {
  if (!file?.path) return
  await rm(file.path, { force: true })
}

export function getMediaKind(mimeType) {
  if (IMAGE_TYPES.has(mimeType)) return 'image'
  if (VIDEO_TYPES.has(mimeType)) return 'video'
  if (AUDIO_TYPES.has(mimeType)) return 'audio'
  return null
}

export async function compressImage(buffer) {
  const pipeline = sharp(buffer, { animated: false })
    .rotate()
    .resize({
      width: 1920,
      height: 1920,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({
      quality: 80,
      effort: 5,
      smartSubsample: true,
    })

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })
  return {
    data,
    mimeType: 'image/webp',
    width: info.width,
    height: info.height,
  }
}

export async function compressAvatar(buffer) {
  const { data, info } = await sharp(buffer, { animated: false })
    .rotate()
    .resize({ width: 320, height: 320, fit: 'cover', position: 'centre' })
    .webp({ quality: 82, effort: 5 })
    .toBuffer({ resolveWithObject: true })
  return { data, mimeType: 'image/webp', width: info.width, height: info.height }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const process = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let errorOutput = ''
    process.stderr.on('data', (chunk) => {
      errorOutput += chunk.toString()
      if (errorOutput.length > 8000) errorOutput = errorOutput.slice(-8000)
    })
    process.on('error', reject)
    process.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`Video compression failed: ${errorOutput.trim() || `ffmpeg exit ${code}`}`))
    })
  })
}

export async function compressVideo(buffer) {
  if (!ffmpegPath) throw new Error('FFmpeg binary is unavailable')
  const directory = await mkdtemp(join(tmpdir(), 'astrachat-video-'))
  const inputPath = join(directory, 'input')
  const outputPath = join(directory, 'output.mp4')

  try {
    await writeFile(inputPath, buffer)
    await runFfmpeg([
      '-y',
      '-i',
      inputPath,
      '-map_metadata',
      '-1',
      '-vf',
      "scale='min(1280,iw)':-2:force_original_aspect_ratio=decrease",
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '28',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      outputPath,
    ])
    return {
      data: await readFile(outputPath),
      mimeType: 'video/mp4',
      width: null,
      height: null,
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
