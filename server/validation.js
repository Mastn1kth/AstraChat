import { z } from 'zod'

const loginPattern = /^[a-zA-Z0-9@+._-]+$/
const usernamePattern = /^[a-zA-Z0-9_]+$/
const publicKeySchema = z.object({
  kty: z.string(),
  n: z.string(),
  e: z.string(),
}).passthrough()

export const registerSchema = z.object({
  login: z.string().trim().min(3).max(64).regex(loginPattern),
  username: z.string().trim().min(3).max(32).regex(usernamePattern),
  name: z.string().trim().min(1).max(64),
  password: z.string().min(10).max(128),
  encryptionPublicKey: publicKeySchema.optional(),
})

export const loginSchema = z.object({
  login: z.string().trim().min(3).max(64),
  password: z.string().min(1).max(128),
})

export const createChatSchema = z.object({
  type: z.enum(['private', 'group', 'channel']).default('private'),
  title: z.string().trim().max(100).default(''),
  memberIds: z.array(z.string().uuid()).max(200).default([]),
})

export const messageSchema = z.object({
  text: z.string().max(64000).default(''),
  searchText: z.string().trim().max(64000).default(''),
  mediaId: z.string().uuid().optional(),
  replyToId: z.string().uuid().optional(),
  forwardedFromMessageId: z.string().uuid().optional(),
}).refine((message) => message.text.trim().length > 0 || message.mediaId, {
  message: 'Message text or media is required',
})

export const editMessageSchema = z.object({
  text: z.string().trim().min(1).max(64000),
  searchText: z.string().trim().max(64000).default(''),
})

export const chatSettingsSchema = z.object({
  pinned: z.boolean().optional(),
  muted: z.boolean().optional(),
  mutedUntil: z.string().datetime().nullable().optional(),
  archived: z.boolean().optional(),
})

export const chatFolderSchema = z.object({
  title: z.string().trim().min(1).max(48),
  icon: z.string().trim().max(32).default(''),
  chatIds: z.array(z.string().uuid()).max(200).default([]),
})

export const updateChatFolderSchema = z.object({
  title: z.string().trim().min(1).max(48).optional(),
  icon: z.string().trim().max(32).optional(),
  chatIds: z.array(z.string().uuid()).max(200).optional(),
})

export const chatFolderChatSettingsSchema = z.object({
  pinned: z.boolean(),
})

export const encryptionKeySchema = z.object({
  encryptionPublicKey: publicKeySchema,
})

export const profileSchema = z.object({
  name: z.string().trim().min(1).max(64),
  username: z.string().trim().min(3).max(32).regex(usernamePattern),
  bio: z.string().trim().max(240).default(''),
})

export const reactionSchema = z.object({
  emoji: z.string().trim().min(1).max(16),
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(10).max(128),
})

export const callSchema = z.object({
  recipientId: z.string().uuid(),
  chatId: z.string().uuid().optional(),
  kind: z.enum(['audio', 'video']),
})

export function parseBody(schema, body) {
  const result = schema.safeParse(body)
  if (!result.success) {
    const error = new Error('Invalid request data')
    error.status = 400
    error.details = result.error.flatten()
    throw error
  }
  return result.data
}
