import { useCallback, useEffect, useRef, useState } from 'react'
import { createServerCall } from '../api/client'

const peerConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

function mediaErrorMessage(error) {
  if (error?.name === 'NotAllowedError') return 'Camera or microphone access was denied.'
  if (error?.name === 'NotFoundError') return 'No suitable camera or microphone was found.'
  if (error?.status === 409) return 'The user is already in another call.'
  return error?.message || 'The call could not be started.'
}

export default function useWebRTCCall({ sendSignal }) {
  const [call, setCall] = useState(null)
  const [localStream, setLocalStream] = useState(null)
  const [remoteStream, setRemoteStream] = useState(null)
  const callRef = useRef(null)
  const peerRef = useRef(null)
  const localStreamRef = useRef(null)
  const remoteStreamRef = useRef(null)
  const screenTrackRef = useRef(null)
  const pendingOfferRef = useRef(null)
  const pendingCandidatesRef = useRef([])
  const closeTimerRef = useRef()

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

  const stopMedia = useCallback(() => {
    screenTrackRef.current?.stop()
    screenTrackRef.current = null
    localStreamRef.current?.getTracks().forEach((track) => track.stop())
    localStreamRef.current = null
    remoteStreamRef.current?.getTracks().forEach((track) => track.stop())
    remoteStreamRef.current = null
    peerRef.current?.close()
    peerRef.current = null
    pendingOfferRef.current = null
    pendingCandidatesRef.current = []
    setLocalStream(null)
    setRemoteStream(null)
  }, [])

  const dismissCall = useCallback(() => {
    window.clearTimeout(closeTimerRef.current)
    stopMedia()
    replaceCall(null)
  }, [replaceCall, stopMedia])

  const closeAfterStatus = useCallback((status, error = '') => {
    patchCall({ status, error })
    window.clearTimeout(closeTimerRef.current)
    if (status === 'failed' || status === 'unavailable') return
    closeTimerRef.current = window.setTimeout(dismissCall, 2200)
  }, [dismissCall, patchCall])

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

  const createPeer = useCallback((stream) => {
    peerRef.current?.close()
    const peer = new RTCPeerConnection(peerConfiguration)
    peerRef.current = peer

    stream.getTracks().forEach((track) => peer.addTrack(track, stream))
    peer.addEventListener('icecandidate', (event) => {
      const current = callRef.current
      if (!event.candidate || !current?.id) return
      sendSignal({
        type: 'call:ice',
        callId: current.id,
        targetUserId: current.peer.id,
        candidate: event.candidate.toJSON(),
      })
    })
    peer.addEventListener('track', (event) => {
      const streamFromPeer = event.streams[0]
      if (streamFromPeer) {
        remoteStreamRef.current = streamFromPeer
        setRemoteStream(streamFromPeer)
        return
      }
      const stream = remoteStreamRef.current || new MediaStream()
      stream.addTrack(event.track)
      remoteStreamRef.current = stream
      setRemoteStream(stream)
    })
    peer.addEventListener('connectionstatechange', () => {
      if (peer.connectionState === 'connected') {
        patchCall({ status: 'active', connectedAt: Date.now(), error: '' })
      }
      if (peer.connectionState === 'failed') {
        closeAfterStatus('failed', 'The peer-to-peer connection failed.')
        stopMedia()
      }
    })
    return peer
  }, [closeAfterStatus, patchCall, sendSignal, stopMedia])

  const flushCandidates = useCallback(async () => {
    const peer = peerRef.current
    if (!peer?.remoteDescription) return
    const candidates = pendingCandidatesRef.current
    pendingCandidatesRef.current = []
    for (const candidate of candidates) {
      await peer.addIceCandidate(candidate)
    }
  }, [])

  const answerOffer = useCallback(async (description) => {
    const current = callRef.current
    const peer = peerRef.current
    if (!current || !peer || !description) return
    await peer.setRemoteDescription(description)
    await flushCandidates()
    const answer = await peer.createAnswer()
    await peer.setLocalDescription(answer)
    sendSignal({
      type: 'call:answer',
      callId: current.id,
      targetUserId: current.peer.id,
      description: peer.localDescription,
    })
    patchCall({ status: 'connecting' })
  }, [flushCandidates, patchCall, sendSignal])

  const startCall = useCallback(async ({ contact, chatId, kind }) => {
    if (callRef.current) return
    const preparingCall = {
      id: '',
      chatId,
      kind,
      direction: 'outgoing',
      peer: contact,
      status: 'preparing',
      muted: false,
      cameraOff: kind !== 'video',
      speakerMuted: false,
      sharingScreen: false,
      error: '',
    }
    replaceCall(preparingCall)

    try {
      const stream = await getLocalMedia(kind)
      const { call: createdCall } = await createServerCall({
        recipientId: contact.id,
        chatId,
        kind,
      })
      const activeCall = { ...preparingCall, id: createdCall.id, status: 'ringing' }
      replaceCall(activeCall)
      if (!createdCall.online) {
        sendSignal({
          type: 'call:hangup',
          callId: createdCall.id,
          targetUserId: contact.id,
        })
        stopMedia()
        closeAfterStatus('unavailable', 'The user is offline.')
        return
      }

      const peer = createPeer(stream)
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      sendSignal({
        type: 'call:offer',
        callId: createdCall.id,
        targetUserId: contact.id,
        description: peer.localDescription,
      })
    } catch (error) {
      stopMedia()
      closeAfterStatus('failed', mediaErrorMessage(error))
    }
  }, [closeAfterStatus, createPeer, getLocalMedia, replaceCall, sendSignal, stopMedia])

  const acceptCall = useCallback(async () => {
    const current = callRef.current
    if (!current || current.direction !== 'incoming') return
    patchCall({ status: 'connecting', error: '' })
    try {
      const stream = await getLocalMedia(current.kind)
      createPeer(stream)
      if (pendingOfferRef.current) {
        await answerOffer(pendingOfferRef.current)
        pendingOfferRef.current = null
      }
    } catch (error) {
      sendSignal({
        type: 'call:decline',
        callId: current.id,
        targetUserId: current.peer.id,
      })
      stopMedia()
      closeAfterStatus('failed', mediaErrorMessage(error))
    }
  }, [answerOffer, closeAfterStatus, createPeer, getLocalMedia, patchCall, sendSignal, stopMedia])

  const endCall = useCallback(() => {
    const current = callRef.current
    if (!current) return
    if (current.id) {
      sendSignal({
        type: current.direction === 'incoming' && current.status === 'ringing'
          ? 'call:decline'
          : 'call:hangup',
        callId: current.id,
        targetUserId: current.peer.id,
      })
    }
    dismissCall()
  }, [dismissCall, sendSignal])

  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    patchCall({ muted: !track.enabled })
  }, [patchCall])

  const toggleCamera = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    patchCall({ cameraOff: !track.enabled })
  }, [patchCall])

  const toggleSpeaker = useCallback(() => {
    patchCall((current) => ({ speakerMuted: !current.speakerMuted }))
  }, [patchCall])

  const toggleScreenShare = useCallback(async () => {
    const current = callRef.current
    const peer = peerRef.current
    if (!current || !peer || !navigator.mediaDevices?.getDisplayMedia) return
    const sender = peer.getSenders().find((item) => item.track?.kind === 'video')

    if (screenTrackRef.current) {
      const cameraTrack = localStreamRef.current?.getVideoTracks()[0] || null
      await sender?.replaceTrack(cameraTrack)
      screenTrackRef.current.stop()
      screenTrackRef.current = null
      patchCall({ sharingScreen: false })
      return
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true })
      const displayTrack = displayStream.getVideoTracks()[0]
      if (!displayTrack) return
      screenTrackRef.current = displayTrack
      if (sender) {
        await sender.replaceTrack(displayTrack)
      } else {
        peer.addTrack(displayTrack, displayStream)
      }
      patchCall({ sharingScreen: true })
      displayTrack.addEventListener('ended', () => {
        if (screenTrackRef.current !== displayTrack) return
        screenTrackRef.current = null
        const cameraTrack = localStreamRef.current?.getVideoTracks()[0] || null
        sender?.replaceTrack(cameraTrack)
        patchCall({ sharingScreen: false })
      }, { once: true })
    } catch {
      patchCall({ sharingScreen: false })
    }
  }, [patchCall])

  const handleSignal = useCallback(async (payload) => {
    if (payload.type === 'call:incoming') {
      if (callRef.current) {
        sendSignal({
          type: 'call:decline',
          callId: payload.callId,
          targetUserId: payload.from.id,
        })
        return
      }
      replaceCall({
        id: payload.callId,
        chatId: payload.chatId,
        kind: payload.kind,
        direction: 'incoming',
        peer: payload.from,
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

    try {
      if (payload.type === 'call:offer') {
        pendingOfferRef.current = payload.description
        if (current.status === 'connecting' && peerRef.current) {
          await answerOffer(payload.description)
          pendingOfferRef.current = null
        }
        return
      }
      if (payload.type === 'call:answer' && peerRef.current) {
        await peerRef.current.setRemoteDescription(payload.description)
        await flushCandidates()
        patchCall({ status: 'connecting' })
        return
      }
      if (payload.type === 'call:ice') {
        if (peerRef.current?.remoteDescription) {
          await peerRef.current.addIceCandidate(payload.candidate)
        } else {
          pendingCandidatesRef.current.push(payload.candidate)
        }
        return
      }
      if (payload.type === 'call:decline') {
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
  }, [answerOffer, closeAfterStatus, flushCandidates, patchCall, replaceCall, sendSignal, stopMedia])

  const handleSocketClose = useCallback(() => {
    if (!callRef.current) return
    stopMedia()
    closeAfterStatus('failed', 'Connection to the call server was lost.')
  }, [closeAfterStatus, stopMedia])

  useEffect(() => {
    if (call?.status !== 'ringing') return undefined
    const timer = window.setTimeout(() => {
      const current = callRef.current
      if (!current || current.status !== 'ringing') return
      sendSignal({
        type: 'call:hangup',
        callId: current.id,
        targetUserId: current.peer.id,
      })
      stopMedia()
      closeAfterStatus('unavailable', 'No answer.')
    }, 45000)
    return () => window.clearTimeout(timer)
  }, [call?.id, call?.status, closeAfterStatus, sendSignal, stopMedia])

  useEffect(() => () => {
    window.clearTimeout(closeTimerRef.current)
    stopMedia()
  }, [stopMedia])

  return {
    call,
    localStream,
    remoteStream,
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
  }
}
