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
  totpCode: z.string().optional(),
  cloudPassword: z.string().optional(),
})

export const phoneAuthStartSchema = z.object({
  countryCode: z.string().trim().regex(/^\+[1-9]\d{0,3}$/),
  phone: z.string().trim().min(4).max(24),
})

export const phoneAuthVerifySchema = z.object({
  countryCode: z.string().trim().regex(/^\+[1-9]\d{0,3}$/),
  phone: z.string().trim().min(4).max(24),
  code: z.string().trim().regex(/^\d{6}$/),
  username: z.string().trim().min(3).max(32).regex(usernamePattern).optional(),
  name: z.string().trim().min(1).max(64).optional(),
  encryptionPublicKey: publicKeySchema.optional(),
})

export const createChatSchema = z.object({
  type: z.enum(['private', 'group', 'channel']).default('private'),
  title: z.string().trim().max(100).default(''),
  memberIds: z.array(z.string().uuid()).max(200).default([]),
})

const linkPreviewSchema = z.object({
  url: z.string().url().max(2048),
  title: z.string().max(512).optional(),
  description: z.string().max(1024).optional(),
  image: z.string().max(2048).optional(),
  site: z.string().max(128).optional(),
}).optional()

const pollSchema = z.object({
  question: z.string().trim().min(1).max(255),
  options: z.array(z.string().trim().min(1).max(100)).min(2).max(10),
  multipleChoice: z.boolean().default(false),
  anonymous: z.boolean().default(true),
  quiz: z.boolean().default(false),
  correctOption: z.number().int().min(0).nullable().optional(),
}).optional()

export const messageSchema = z.object({
  text: z.string().max(64000).default(''),
  searchText: z.string().trim().max(64000).default(''),
  mediaId: z.string().uuid().optional(),
  replyToId: z.string().uuid().optional(),
  forwardedFromMessageId: z.string().uuid().optional(),
  topicId: z.string().uuid().optional(),
  silent: z.boolean().default(false),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  linkPreview: linkPreviewSchema,
  poll: pollSchema,
}).refine((message) => message.text.trim().length > 0 || message.mediaId || message.poll, {
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

export const pinMessageSchema = z.object({
  messageId: z.string().uuid().nullable(),
})

export const encryptionKeySchema = z.object({
  encryptionPublicKey: publicKeySchema,
})

export const profileSchema = z.object({
  name: z.string().trim().min(1).max(64),
  username: z.string().trim().min(3).max(32).regex(usernamePattern),
  bio: z.string().trim().max(240).default(''),
  status: z.string().trim().max(80).default(''),
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

export const totpVerifySchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Code must be 6 digits'),
})

export const pushSubscriptionSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(2048),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({
      p256dh: z.string().min(1).max(512),
      auth: z.string().min(1).max(512),
    }),
  }),
})

export const fcmTokenSchema = z.object({
  token: z.string().trim().min(10).max(4096),
})

export const deletePushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048).optional(),
})

export const reportSchema = z.object({
  targetUserId: z.string().uuid().optional(),
  chatId: z.string().uuid().optional(),
  targetMessageId: z.string().uuid().optional(),
  reason: z.enum(['spam', 'abuse', 'fraud', 'illegal', 'other']).default('other'),
  details: z.string().trim().max(2000).default(''),
})

export const memberRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'moderator', 'member']),
})

export const memberPermissionsSchema = z.object({
  permissions: z.record(z.string().max(64), z.boolean()).default({}),
})

export const banMemberSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().max(500).default(''),
  durationSeconds: z.number().int().positive().max(10 * 365 * 24 * 60 * 60).optional(),
})

export const chatModerationSettingsSchema = z.object({
  slowModeSeconds: z.number().int().min(0).max(24 * 60 * 60).optional(),
  defaultPermissions: z.record(z.string().max(64), z.boolean()).optional(),
})

export const inviteLinkSchema = z.object({
  name: z.string().trim().max(64).default(''),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  usageLimit: z.number().int().positive().max(100000).optional(),
  requireApproval: z.boolean().default(false),
})

export const joinInviteSchema = z.object({
  message: z.string().trim().max(500).default(''),
})

export const reviewJoinRequestSchema = z.object({
  approved: z.boolean(),
})

export const topicSchema = z.object({
  title: z.string().trim().min(1).max(100),
})

export const updateTopicSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  pinned: z.boolean().optional(),
  closed: z.boolean().optional(),
})

export const pollVoteSchema = z.object({
  optionIds: z.array(z.string().uuid()).min(0).max(10).default([]),
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
