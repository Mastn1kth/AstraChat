import { db } from './db.js'
import { publishSocketMessage, isUserOnline } from './redis.js'
import { websocketConnections } from './metrics.js'
import WebSocket from 'ws'

export const socketsByUserId = new Map()

// Mutable cache of online user IDs from Redis across all instances.
// Use the `state` wrapper so presenceRefresh in index.js can reassign it.
export const state = { onlineUserIdCache: new Set() }

export function addSocket(userId, socket) {
  const sockets = socketsByUserId.get(userId) || new Set()
  sockets.add(socket)
  socketsByUserId.set(userId, sockets)
  websocketConnections.inc()
  state.onlineUserIdCache.add(userId)
  return sockets.size
}

export function removeSocket(userId, socket) {
  const sockets = socketsByUserId.get(userId)
  if (!sockets) return 0
  sockets.delete(socket)
  websocketConnections.dec()
  if (!sockets.size) {
    socketsByUserId.delete(userId)
    state.onlineUserIdCache.delete(userId)
  }
  return sockets.size
}

export function deliverToLocalUser(userId, payload) {
  const sockets = socketsByUserId.get(userId)
  if (!sockets) return false
  const message = JSON.stringify(payload)
  let delivered = false
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(message)
      delivered = true
    }
  }
  return delivered
}

export async function sendToUser(userId, payload) {
  const deliveredLocally = deliverToLocalUser(userId, payload)
  await publishSocketMessage({ kind: 'user', userId, payload })
  return deliveredLocally || (await isUserOnline(userId))
}

export function deliverLocalBroadcast(payload, excludedUserId = '') {
  const message = JSON.stringify(payload)
  socketsByUserId.forEach((sockets, userId) => {
    if (userId === excludedUserId) return
    sockets.forEach((socket) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(message)
    })
  })
}

export async function broadcast(payload, excludedUserId = '') {
  deliverLocalBroadcast(payload, excludedUserId)
  await publishSocketMessage({ kind: 'broadcast', excludedUserId, payload })
}

export async function sendToChatExcept(chatId, excludedUserId, payload) {
  const members = await db.query(
    'SELECT user_id FROM chat_members WHERE chat_id = $1 AND user_id <> $2',
    [chatId, excludedUserId],
  )
  let delivered = 0
  for (const member of members.rows) {
    if (await sendToUser(member.user_id, payload)) delivered += 1
  }
  return delivered
}

export async function sendToChat(chatId, payload) {
  const members = await db.query('SELECT user_id FROM chat_members WHERE chat_id = $1', [chatId])
  let delivered = 0
  for (const member of members.rows) {
    if (await sendToUser(member.user_id, payload)) delivered += 1
  }
  return delivered
}

export async function sendToCall(callId, payload, excludedUserId = '') {
  const participants = await db.query(
    'SELECT user_id FROM call_participants WHERE call_id = $1',
    [callId],
  )
  let delivered = 0
  for (const participant of participants.rows) {
    if (participant.user_id === excludedUserId) continue
    if (await sendToUser(participant.user_id, payload)) delivered += 1
  }
  return delivered
}
