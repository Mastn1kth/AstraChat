import { createReadStream, createWriteStream } from 'node:fs'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { config } from './config.js'

const multipartThreshold = 16 * 1024 * 1024
const multipartPartSize = 8 * 1024 * 1024

const s3Client =
  config.storageDriver === 's3'
    ? new S3Client({
        endpoint: config.s3.endpoint,
        region: config.s3.region,
        forcePathStyle: config.s3.forcePathStyle,
        credentials: {
          accessKeyId: config.s3.accessKeyId,
          secretAccessKey: config.s3.secretAccessKey,
        },
      })
    : null

function objectKey(name) {
  return config.s3.prefix ? `${config.s3.prefix}/${name}` : name
}

async function streamToBuffer(stream) {
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function saveMediaObject(name, buffer) {
  if (config.storageDriver === 'local') {
    await writeFile(resolve(config.mediaDir, name), buffer, { mode: 0o600 })
    return
  }

  if (buffer.length >= multipartThreshold) {
    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: config.s3.bucket,
        Key: objectKey(name),
        Body: buffer,
        ContentType: 'application/octet-stream',
        CacheControl: 'private, max-age=31536000, immutable',
      },
      queueSize: 3,
      partSize: multipartPartSize,
      leavePartsOnError: false,
    })
    await upload.done()
    return
  }

  await s3Client.send(
    new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: objectKey(name),
      Body: buffer,
      ContentType: 'application/octet-stream',
      CacheControl: 'private, max-age=31536000, immutable',
    }),
  )
}

export async function saveMediaObjectStream(name, stream, { contentLength } = {}) {
  if (config.storageDriver === 'local') {
    const targetPath = resolve(config.mediaDir, name)
    const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`
    try {
      await pipeline(stream, createWriteStream(temporaryPath, { mode: 0o600 }))
      await rename(temporaryPath, targetPath)
    } catch (error) {
      await rm(temporaryPath, { force: true })
      throw error
    }
    return
  }

  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: config.s3.bucket,
      Key: objectKey(name),
      Body: stream,
      ContentLength: contentLength,
      ContentType: 'application/octet-stream',
      CacheControl: 'private, max-age=31536000, immutable',
    },
    queueSize: 3,
    partSize: multipartPartSize,
    leavePartsOnError: false,
  })
  await upload.done()
}

export async function getMediaObject(name) {
  if (config.storageDriver === 'local') {
    return readFile(resolve(config.mediaDir, name))
  }

  const result = await s3Client.send(
    new GetObjectCommand({
      Bucket: config.s3.bucket,
      Key: objectKey(name),
    }),
  )
  return streamToBuffer(result.Body)
}

export async function getMediaObjectStream(name) {
  if (config.storageDriver === 'local') {
    return createReadStream(resolve(config.mediaDir, name))
  }

  const result = await s3Client.send(
    new GetObjectCommand({
      Bucket: config.s3.bucket,
      Key: objectKey(name),
    }),
  )
  return result.Body || Readable.from([])
}

export async function deleteMediaObject(name) {
  if (config.storageDriver === 'local') {
    await rm(resolve(config.mediaDir, name), { force: true })
    return
  }

  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: config.s3.bucket,
      Key: objectKey(name),
    }),
  )
}

export async function checkStorage() {
  if (config.storageDriver === 'local') {
    await saveMediaObject('.healthcheck', Buffer.from('ok'))
    await deleteMediaObject('.healthcheck')
    return 'local'
  }

  await s3Client.send(new HeadBucketCommand({ Bucket: config.s3.bucket }))
  return 's3'
}
