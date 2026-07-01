import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createServerCall, getCallIceServers } from '../api/client'

const fallbackIceServers = [{ urls: 'stun:stun.l.google.com:19302' }]

function mediaErrorMessage(error) {
  if (error?.name === 'NotAllowedError') return 'Camera or microphone access was denied.'
  if (error?.name === 'NotFoundError') return 'No suitable camera or microphone was found.'
  if (error?.status === 409) return 'The user is already in another call.'
  return error?.message || 'The call could not be started.'
}

function normalizeParticipant(participant, currentUserId) {
  return {
    id: participant.id,
    login: participant.login || '',
    username: participant.username || '',
    name: participant.name || 'Onda user',
    avatar: participant.avatar || participant.name?.slice(0, 2).toUpperCase() || 'A',
    state: participant.state || 'invited',
    muted: Boolean(participant.muted),
    cameraOff: Boolean(participant.cameraOff),
    sharingScreen: Boolean(participant.sharingScreen),
    self: participant.self || participant.id === currentUserId,
  }
}

function uniqueParticipants(participants, currentUserId) {
  const byId = new Map()
  for (const participant of participants || []) {
    if (!participant?.id) continue
    byId.set(participant.id, {
      ...(byId.get(participant.id) || {}),
      ...normalizeParticipant(participant, currentUserId),
    })
  }
  return [...byId.values()]
}

export default function useWebRTCCall({ sendSignal, currentUser }) {
  const currentUserId = currentUser?.id || ''
  const [call, setCall] = useState(null)
  const [localStream, setLocalStream] = useState(null)
  const [remoteStreams, setRemoteStreams] = useState({})
  const [connectionStats, setConnectionStats] = useState(null)
  const callRef = useRef(null)
  const peersRef = useRef(new Map())
  const localStreamRef = useRef(null)
  const screenTrackRef = useRef(null)
  const screenStreamRef = useRef(null)
  const pendingOffersRef = useRef(new Map())
  const pendingCandidatesRef = useRef(new Map())
  const iceServersRef = useRef(fallbackIceServers)
  const iceRestartedRef = useRef(new Set())
  const closeTimerRef = useRef()

  const remoteStream = useMemo(() => Object.values(remoteStreams)[0] || null, [remoteStreams])

  const replaceCall = useCallback((next) => {
    callRef.current = next
    setCall(next)
  }, [])

  const patchCall = useCallback((patch) => {
    const current = callRef.current
    if (!current) return
    const next = {
      ...current,
      ...(typeof patch === 'function' ? patch(current) : patch),
    }
    callRef.current = next
    setCall(next)
  }, [])

  const patchParticipant = useCallback((userId, patch) => {
    if (!userId) return
    patchCall((current) => ({
      participants: uniqueParticipants(
        (current.participants || []).map((participant) =>
          participant.id === userId
            ? { ...participant, ...(typeof patch === 'function' ? patch(participant) : patch) }
            : participant,
        ),
        currentUserId,
      ),
    }))
  }, [currentUserId, patchCall])

  const emitParticipantState = useCallback((patch) => {
    const current = callRef.current
    if (!current?.id) return
    sendSignal({
      type: 'call:participant-state',
      callId: current.id,
      ...patch,
    })
  }, [sendSignal])

  const stopMedia = useCallback(() => {
    screenTrackRef.current?.stop()
    screenTrackRef.current = null
    screenStreamRef.current?.getTracks().forEach((track) => track.stop())
    screenStreamRef.current = null
    localStreamRef.current?.getTracks().forEach((track) => track.stop())
    localStreamRef.current = null
    peersRef.current.forEach((peer) => peer.close())
    peersRef.current.clear()
    iceRestartedRef.current.clear()
    pendingOffersRef.current.clear()
    pendingCandidatesRef.current.clear()
    setLocalStream(null)
    setRemoteStreams({})
    setConnectionStats(null)
  }, [])

  const dismissCall = useCallback(() => {
    window.clearTimeout(closeTimerRef.current)
    stopMedia()
    replaceCall(null)
  }, [replaceCall, stopMedia])

  const closeAfterStatus = useCallback((status, error = '') => {
    patchCall({ status, error })
    window.clearTimeout(closeTimerRef.current)
    if (status === 'failed' || status === 'unavailable' || status === 'reconnecting') return
    closeTimerRef.current = window.setTimeout(dismissCall, 2200)
  }, [dismissCall, patchCall])

  const loadIceServers = useCallback(async (provided) => {
    if (provided?.length) {
      iceServersRef.current = provided
      return provided
    }
    try {
      const { iceServers } = await getCallIceServers()
      iceServersRef.current = iceServers?.length ? iceServers : fallbackIceServers
    } catch {
      iceServersRef.current = fallbackIceServers
    }
    return iceServersRef.current
  }, [])

  const getLocalMedia = useCallback(async (kind) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser does not support audio and video calls.')
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: kind === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    })
    localStreamRef.current = stream
    setLocalStream(stream)
    return stream
  }, [])

  const flushCandidates = useCallback(async (userId) => {
    const peer = peersRef.current.get(userId)
    if (!peer?.remoteDescription) return
    const candidates = pendingCandidatesRef.current.get(userId) || []
    pendingCandidatesRef.current.delete(userId)
    for (const candidate of candidates) {
      await peer.addIceCandidate(candidate)
    }
  }, [])

  const createPeer = useCallback((userId, stream) => {
    const existing = peersRef.current.get(userId)
    if (existing) return existing

    const peer = new RTCPeerConnection({ iceServers: iceServersRef.current })
    peersRef.current.set(userId, peer)

    stream.getTracks().forEach((track) => {
      if (track.kind === 'video' && screenTrackRef.current) {
        peer.addTrack(screenTrackRef.current, screenStreamRef.current || stream)
        return
      }
      peer.addTrack(track, stream)
    })
    peer.addEventListener('icecandidate', (event) => {
      const current = callRef.current
      if (!event.candidate || !current?.id) return
      sendSignal({
        type: 'call:ice',
        callId: current.id,
        targetUserId: userId,
        candidate: event.candidate.toJSON(),
      })
    })
    async function restartIceOnce() {
      const current = callRef.current
      if (!current?.id || !peersRef.current.has(userId)) return
      if (iceRestartedRef.current.has(userId)) {
        patchParticipant(userId, { state: 'disconnected' })
        closeAfterStatus('failed', 'Call connection failed. Check network or TURN server settings.')
        return
      }

      iceRestartedRef.current.add(userId)
      patchParticipant(userId, { state: 'disconnected' })
      patchCall({ status: 'reconnecting', error: 'Connection dropped. Trying to reconnect...' })
      try {
        peer.restartIce?.()
        const offer = await peer.createOffer({ iceRestart: true })
        await peer.setLocalDescription(offer)
        sendSignal({
          type: 'call:offer',
          callId: current.id,
          targetUserId: userId,
          description: peer.localDescription,
        })
      } catch {
        closeAfterStatus('failed', 'Call reconnection failed.')
      }
    }

    peer.addEventListener('iceconnectionstatechange', () => {
      if (peer.iceConnectionState === 'connected' || peer.iceConnectionState === 'completed') {
        iceRestartedRef.current.delete(userId)
        patchParticipant(userId, { state: 'connected' })
      }
      if (peer.iceConnectionState === 'disconnected') {
        patchParticipant(userId, { state: 'disconnected' })
      }
      if (peer.iceConnectionState === 'failed') {
        void restartIceOnce()
      }
    })
    peer.addEventListener('track', (event) => {
      const streamFromPeer = event.streams[0]
      if (streamFromPeer) {
        setRemoteStreams((current) => ({ ...current, [userId]: streamFromPeer }))
        return
      }
      setRemoteStreams((current) => {
        const nextStream = current[userId] || new MediaStream()
        nextStream.addTrack(event.track)
        return { ...current, [userId]: nextStream }
      })
    })
    peer.addEventListener('connectionstatechange', () => {
      if (peer.connectionState === 'connected') {
        patchParticipant(userId, { state: 'connected' })
        patchCall({ status: 'active', connectedAt: callRef.current?.connectedAt || Date.now(), error: '' })
      }
      if (peer.connectionState === 'failed') {
        void restartIceOnce()
      }
    })
    return peer
  }, [closeAfterStatus, patchCall, patchParticipant, sendSignal])

  const createOfferFor = useCallback(async (userId) => {
    const current = callRef.current
    const stream = localStreamRef.current
    if (!current || !stream || userId === currentUserId) return
    const peer = createPeer(userId, stream)
    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    sendSignal({
      type: 'call:offer',
      callId: current.id,
      targetUserId: userId,
      description: peer.localDescription,
    })
  }, [createPeer, currentUserId, sendSignal])

  const answerOffer = useCallback(async (userId, description) => {
    const current = callRef.current
    const stream = localStreamRef.current
    if (!current || !stream || !description || userId === currentUserId) return
    const peer = createPeer(userId, stream)
    await peer.setRemoteDescription(description)
    await flushCandidates(userId)
    const answer = await peer.createAnswer()
    await peer.setLocalDescription(answer)
    sendSignal({
      type: 'call:answer',
      callId: current.id,
      targetUserId: userId,
      description: peer.localDescription,
    })
    patchCall({ status: 'connecting' })
  }, [createPeer, currentUserId, flushCandidates, patchCall, sendSignal])

  const shouldOfferTo = useCallback((userId) => {
    const current = callRef.current
    if (!current || userId === currentUserId || peersRef.current.has(userId)) return false
    if (current.direction === 'outgoing') return true
    return currentUserId && userId && currentUserId < userId
  }, [currentUserId])

  const startCall = useCallback(async ({ contact, chat, chatId, kind }) => {
    if (callRef.current) return
    const preparingCall = {
      id: '',
      chatId,
      kind,
      direction: 'outgoing',
      mode: chat?.serverType === 'group' || contact?.type === 'group' ? 'group' : 'private',
      peer: contact,
      participants: uniqueParticipants([
        { ...currentUser, state: 'connected', self: true, cameraOff: kind !== 'video' },
        ...(chat?.members || []).filter((member) => member.id !== currentUserId),
      ], currentUserId),
      status: 'preparing',
      muted: false,
      cameraOff: kind !== 'video',
      speakerMuted: false,
      sharingScreen: false,
      error: '',
    }
    replaceCall(preparingCall)

    try {
      await getLocalMedia(kind)
      const { call: createdCall } = await createServerCall({
        recipientId: preparingCall.mode === 'private' ? contact.id : undefined,
        chatId,
        kind,
      })
      await loadIceServers(createdCall.iceServers)
      const activeCall = {
        ...preparingCall,
        id: createdCall.id,
        status: 'ringing',
        mediaServer: createdCall.mediaServer || null,
        participants: uniqueParticipants(createdCall.participants, currentUserId),
      }
      replaceCall(activeCall)
      if (!createdCall.online) {
        sendSignal({
          type: 'call:hangup',
          callId: createdCall.id,
        })
        stopMedia()
        closeAfterStatus('unavailable', 'No participant is online.')
        return
      }

      const targets = createdCall.onlineParticipantIds?.length
        ? createdCall.onlineParticipantIds
        : activeCall.participants.filter((participant) => !participant.self).map((participant) => participant.id)
      await Promise.all(targets.map((userId) => createOfferFor(userId)))
    } catch (error) {
      stopMedia()
      closeAfterStatus('failed', mediaErrorMessage(error))
    }
  }, [
    closeAfterStatus,
    createOfferFor,
    currentUser,
    currentUserId,
    getLocalMedia,
    loadIceServers,
    replaceCall,
    sendSignal,
    stopMedia,
  ])

  const acceptCall = useCallback(async () => {
    const current = callRef.current
    if (!current || current.direction !== 'incoming') return
    patchCall({ status: 'connecting', error: '' })
    try {
      const stream = await getLocalMedia(current.kind)
      sendSignal({ type: 'call:join', callId: current.id })
      patchParticipant(currentUserId, { state: 'connected' })
      const pendingOffers = [...pendingOffersRef.current.entries()]
      pendingOffersRef.current.clear()
      await Promise.all(pendingOffers.map(([userId, description]) => answerOffer(userId, description)))
      const connectedParticipants = current.participants.filter(
        (participant) => !participant.self && participant.state === 'connected',
      )
      await Promise.all(
        connectedParticipants
          .filter((participant) => shouldOfferTo(participant.id))
          .map((participant) => {
            createPeer(participant.id, stream)
            return createOfferFor(participant.id)
          }),
      )
    } catch (error) {
      sendSignal({
        type: 'call:decline',
        callId: current.id,
      })
      stopMedia()
      closeAfterStatus('failed', mediaErrorMessage(error))
    }
  }, [
    answerOffer,
    closeAfterStatus,
    createOfferFor,
    createPeer,
    currentUserId,
    getLocalMedia,
    patchCall,
    patchParticipant,
    sendSignal,
    shouldOfferTo,
    stopMedia,
  ])

  const endCall = useCallback(() => {
    const current = callRef.current
    if (!current) return
    if (current.id) {
      sendSignal({
        type: current.direction === 'incoming' && current.status === 'ringing'
          ? 'call:decline'
          : 'call:hangup',
        callId: current.id,
      })
    }
    dismissCall()
  }, [dismissCall, sendSignal])

  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    const muted = !track.enabled
    patchCall({ muted })
    patchParticipant(currentUserId, { muted })
    emitParticipantState({ muted })
  }, [currentUserId, emitParticipantState, patchCall, patchParticipant])

  const toggleCamera = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    const cameraOff = !track.enabled
    patchCall({ cameraOff })
    patchParticipant(currentUserId, { cameraOff })
    emitParticipantState({ cameraOff })
  }, [currentUserId, emitParticipantState, patchCall, patchParticipant])

  const toggleSpeaker = useCallback(() => {
    patchCall((current) => ({ speakerMuted: !current.speakerMuted }))
  }, [patchCall])

  const patchScreenShareState = useCallback((sharingScreen) => {
    patchCall({ sharingScreen })
    patchParticipant(currentUserId, { sharingScreen })
    emitParticipantState({ sharingScreen })
  }, [currentUserId, emitParticipantState, patchCall, patchParticipant])

  const replaceOutgoingVideo = useCallback(async (track) => {
    const replacements = []
    peersRef.current.forEach((peer) => {
      const sender = peer.getSenders().find((item) => item.track?.kind === 'video')
      if (sender) replacements.push(sender.replaceTrack(track))
    })
    await Promise.all(replacements)
  }, [])

  const stopScreenShare = useCallback(async () => {
    const displayTrack = screenTrackRef.current
    const displayStream = screenStreamRef.current
    if (!displayTrack && !displayStream) return

    screenTrackRef.current = null
    screenStreamRef.current = null
    const cameraTrack = localStreamRef.current?.getVideoTracks()[0] || null
    await replaceOutgoingVideo(cameraTrack)
    displayStream?.getTracks().forEach((track) => track.stop())
    if (displayTrack && !displayStream?.getTracks().includes(displayTrack)) displayTrack.stop()
    setLocalStream(localStreamRef.current)
    patchScreenShareState(false)
  }, [patchScreenShareState, replaceOutgoingVideo])

  const toggleScreenShare = useCallback(async () => {
    const current = callRef.current
    if (!current || !navigator.mediaDevices?.getDisplayMedia) return

    if (screenTrackRef.current) {
      await stopScreenShare()
      return
    }

    let displayStream = null
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true })
      const displayTrack = displayStream.getVideoTracks()[0]
      if (!displayTrack) {
        displayStream.getTracks().forEach((track) => track.stop())
        return
      }
      await replaceOutgoingVideo(displayTrack)
      screenTrackRef.current = displayTrack
      screenStreamRef.current = displayStream
      setLocalStream(new MediaStream([
        displayTrack,
        ...(localStreamRef.current?.getAudioTracks() || []),
      ]))
      patchScreenShareState(true)
      displayTrack.addEventListener('ended', () => {
        if (screenTrackRef.current !== displayTrack) return
        void stopScreenShare()
      }, { once: true })
    } catch {
      displayStream?.getTracks().forEach((track) => track.stop())
      patchScreenShareState(false)
    }
  }, [patchScreenShareState, replaceOutgoingVideo, stopScreenShare])

  const handleSignal = useCallback(async (payload) => {
    if (payload.type === 'call:incoming') {
      if (callRef.current) {
        sendSignal({
          type: 'call:decline',
          callId: payload.callId,
        })
        return
      }
      await loadIceServers(payload.iceServers)
      replaceCall({
        id: payload.callId,
        chatId: payload.chatId,
        kind: payload.kind,
        direction: 'incoming',
        mode: (payload.participants || []).length > 2 ? 'group' : 'private',
        peer: payload.from,
        mediaServer: payload.mediaServer || null,
        participants: uniqueParticipants(payload.participants, currentUserId),
        status: 'ringing',
        muted: false,
        cameraOff: payload.kind !== 'video',
        speakerMuted: false,
        sharingScreen: false,
        error: '',
      })
      return
    }

    const current = callRef.current
    if (!current || current.id !== payload.callId) return
    const fromUserId = payload.fromUserId || payload.userId

    try {
      if (payload.type === 'call:offer') {
        if (!fromUserId) return
        if (!localStreamRef.current || current.status === 'ringing') {
          pendingOffersRef.current.set(fromUserId, payload.description)
          return
        }
        await answerOffer(fromUserId, payload.description)
        return
      }
      if (payload.type === 'call:answer' && fromUserId) {
        const peer = peersRef.current.get(fromUserId)
        if (peer) {
          await peer.setRemoteDescription(payload.description)
          await flushCandidates(fromUserId)
          patchParticipant(fromUserId, { state: 'connected' })
          patchCall({ status: 'connecting' })
        }
        return
      }
      if (payload.type === 'call:ice' && fromUserId) {
        const peer = peersRef.current.get(fromUserId)
        if (peer?.remoteDescription) {
          await peer.addIceCandidate(payload.candidate)
        } else {
          pendingCandidatesRef.current.set(fromUserId, [
            ...(pendingCandidatesRef.current.get(fromUserId) || []),
            payload.candidate,
          ])
        }
        return
      }
      if (payload.type === 'call:participant-state' && fromUserId) {
        patchParticipant(fromUserId, {
          ...(typeof payload.muted === 'boolean' ? { muted: payload.muted } : {}),
          ...(typeof payload.cameraOff === 'boolean' ? { cameraOff: payload.cameraOff } : {}),
          ...(typeof payload.sharingScreen === 'boolean' ? { sharingScreen: payload.sharingScreen } : {}),
        })
        return
      }
      if (payload.type === 'call:participant' && payload.userId) {
        if (payload.participants?.length) {
          patchCall({ participants: uniqueParticipants(payload.participants, currentUserId) })
        } else {
          patchParticipant(payload.userId, { state: payload.state || 'connected' })
        }
        if (
          payload.userId !== currentUserId &&
          payload.state === 'connected' &&
          localStreamRef.current &&
          shouldOfferTo(payload.userId)
        ) {
          await createOfferFor(payload.userId)
        }
        return
      }
      if (payload.type === 'call:decline') {
        if (current.mode === 'group' && fromUserId) {
          patchParticipant(fromUserId, { state: 'declined' })
          return
        }
        stopMedia()
        closeAfterStatus('declined')
        return
      }
      if (payload.type === 'call:hangup') {
        stopMedia()
        closeAfterStatus('ended')
      }
    } catch (error) {
      stopMedia()
      closeAfterStatus('failed', mediaErrorMessage(error))
    }
  }, [
    answerOffer,
    closeAfterStatus,
    createOfferFor,
    currentUserId,
    flushCandidates,
    loadIceServers,
    patchCall,
    patchParticipant,
    replaceCall,
    sendSignal,
    shouldOfferTo,
    stopMedia,
  ])

  const handleSocketClose = useCallback(() => {
    if (!callRef.current) return
    patchParticipant(currentUserId, { state: 'disconnected' })
    closeAfterStatus('reconnecting', 'Connection to the call server was lost. Reconnecting...')
  }, [closeAfterStatus, currentUserId, patchParticipant])

  const handleSocketReady = useCallback(() => {
    const current = callRef.current
    if (!current?.id || !localStreamRef.current) return
    sendSignal({ type: 'call:join', callId: current.id })
    patchCall({ status: 'connecting', error: '' })
    current.participants
      .filter((participant) => !participant.self && ['connected', 'disconnected'].includes(participant.state))
      .filter((participant) => shouldOfferTo(participant.id))
      .forEach((participant) => {
        createOfferFor(participant.id).catch(() => {})
      })
  }, [createOfferFor, patchCall, sendSignal, shouldOfferTo])

  useEffect(() => {
    if (call?.status !== 'ringing') return undefined
    const timer = window.setTimeout(() => {
      const current = callRef.current
      if (!current || current.status !== 'ringing') return
      sendSignal({
        type: 'call:hangup',
        callId: current.id,
      })
      stopMedia()
      closeAfterStatus('unavailable', 'No answer.')
    }, 45000)
    return () => window.clearTimeout(timer)
  }, [call?.id, call?.status, closeAfterStatus, sendSignal, stopMedia])

  useEffect(() => {
    if (call?.status !== 'active') {
      return undefined
    }

    let cancelled = false

    async function collectStats() {
      const peers = [...peersRef.current.values()].filter(
        (peer) => !['closed', 'failed'].includes(peer.connectionState),
      )
      if (!peers.length) {
        if (!cancelled) {
          setConnectionStats({
            level: 'unknown',
            label: 'Measuring',
            packetsLost: 0,
            packetsReceived: 0,
            lossRate: 0,
            jitterMs: 0,
          })
        }
        return
      }

      const totals = {
        packetsLost: 0,
        packetsReceived: 0,
        jitterMs: 0,
        inboundReports: 0,
      }

      await Promise.all(peers.map(async (peer) => {
        const report = await peer.getStats()
        report.forEach((item) => {
          if (item.type !== 'inbound-rtp' || item.isRemote) return
          if (typeof item.packetsLost === 'number') totals.packetsLost += Math.max(0, item.packetsLost)
          if (typeof item.packetsReceived === 'number') totals.packetsReceived += Math.max(0, item.packetsReceived)
          if (typeof item.jitter === 'number') totals.jitterMs = Math.max(totals.jitterMs, item.jitter * 1000)
          totals.inboundReports += 1
        })
      }))

      const packetTotal = totals.packetsReceived + totals.packetsLost
      const lossRate = packetTotal > 0 ? totals.packetsLost / packetTotal : 0
      const jitterMs = Math.round(totals.jitterMs)
      const level = lossRate >= 0.08 || jitterMs >= 80
        ? 'poor'
        : lossRate >= 0.03 || jitterMs >= 40
          ? 'fair'
          : totals.inboundReports > 0
            ? 'good'
            : 'unknown'
      const label = {
        good: 'Good',
        fair: 'Unstable',
        poor: 'Poor',
        unknown: 'Measuring',
      }[level]

      if (!cancelled) {
        setConnectionStats({
          level,
          label,
          packetsLost: totals.packetsLost,
          packetsReceived: totals.packetsReceived,
          lossRate,
          jitterMs,
        })
      }
    }

    collectStats().catch(() => {
      if (!cancelled) setConnectionStats(null)
    })
    const timer = window.setInterval(() => {
      collectStats().catch(() => {
        if (!cancelled) setConnectionStats(null)
      })
    }, 2500)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [call?.status])

  useEffect(() => () => {
    window.clearTimeout(closeTimerRef.current)
    stopMedia()
  }, [stopMedia])

  return {
    call,
    localStream,
    remoteStream,
    remoteStreams,
    connectionStats: call?.status === 'active' ? connectionStats : null,
    startCall,
    acceptCall,
    endCall,
    dismissCall,
    toggleMute,
    toggleCamera,
    toggleSpeaker,
    toggleScreenShare,
    handleSignal,
    handleSocketClose,
    handleSocketReady,
  }
}
