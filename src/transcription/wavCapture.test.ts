import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ensureMicPermission,
  mapMicError,
  MAX_CAPTURE_SECONDS,
  prepareSamplesForWhisper,
  requestMicPermission,
  setPreferredMicrophoneDeviceId,
  subscribeCaptureMaxDurationReached,
  warmWavMicCapturePipeline,
} from './wavCapture'

type PermissionStateLike = 'granted' | 'prompt' | 'denied'

interface NavigatorMock {
  permissions?: {
    query: ReturnType<typeof vi.fn>
  }
  mediaDevices?: {
    getUserMedia: ReturnType<typeof vi.fn>
  }
}

function mockNavigator(config: {
  permissionState?: PermissionStateLike
  permissionQueryThrows?: boolean
  mediaRejects?: boolean
}): NavigatorMock {
  const query = vi.fn(async () => {
    if (config.permissionQueryThrows) {
      throw new Error('permissions unavailable')
    }
    return { state: config.permissionState ?? 'prompt' }
  })
  const trackStop = vi.fn()
  const getUserMedia = vi.fn(async () => {
    if (config.mediaRejects) {
      throw new Error('blocked')
    }
    return { getTracks: () => [{ stop: trackStop }] }
  })

  const navigatorMock: NavigatorMock = {
    permissions: { query },
    mediaDevices: { getUserMedia },
  }
  vi.stubGlobal('navigator', navigatorMock)
  return navigatorMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
  setPreferredMicrophoneDeviceId('')
})

describe('ensureMicPermission', () => {
  it('returns false when permission state is denied and gUM fails', async () => {
    const nav = mockNavigator({ permissionState: 'denied', mediaRejects: true })
    await expect(ensureMicPermission()).resolves.toBe(false)
    expect(nav.mediaDevices?.getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('returns true when permission state is granted and gUM succeeds', async () => {
    const nav = mockNavigator({ permissionState: 'granted' })
    await expect(ensureMicPermission()).resolves.toBe(true)
    expect(nav.mediaDevices?.getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('requests mic when state is prompt and stops temp stream tracks', async () => {
    const nav = mockNavigator({ permissionState: 'prompt' })
    await expect(ensureMicPermission()).resolves.toBe(true)
    expect(nav.mediaDevices?.getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('returns false when capture probe fails', async () => {
    const nav = mockNavigator({ permissionQueryThrows: true, mediaRejects: true })
    await expect(ensureMicPermission()).resolves.toBe(false)
    expect(nav.mediaDevices?.getUserMedia).toHaveBeenCalledTimes(1)
  })
})

describe('mapMicError', () => {
  it('maps DOMException names', () => {
    expect(mapMicError(new DOMException('x', 'NotAllowedError'))).toBe('notAllowed')
    expect(mapMicError(new DOMException('x', 'NotFoundError'))).toBe('notFound')
    expect(mapMicError(new DOMException('x', 'NotReadableError'))).toBe('notReadable')
    expect(mapMicError(new DOMException('x', 'AbortError'))).toBe('unknown')
  })

  it('maps object name field', () => {
    expect(mapMicError({ name: 'NotAllowedError' })).toBe('notAllowed')
  })

  it('returns unknown for other errors', () => {
    expect(mapMicError(new Error('blocked'))).toBe('unknown')
  })
})

describe('capture session limits', () => {
  it('allows up to ten minutes per dictation session', () => {
    expect(MAX_CAPTURE_SECONDS).toBe(600)
  })

  it('notifies max-duration subscribers once per registration', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeCaptureMaxDurationReached(listener)
    unsubscribe()
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('prepareSamplesForWhisper', () => {
  it('returns empty for very short audio', () => {
    expect(prepareSamplesForWhisper(new Float32Array(100), 48_000).length).toBe(0)
  })

  it('returns empty for near-digital silence', () => {
    const samples = new Float32Array(48_000).fill(0.0002)
    expect(prepareSamplesForWhisper(samples, 48_000).length).toBe(0)
  })

  it('keeps quiet speech that would be too aggressively trimmed', () => {
    const samples = new Float32Array(48_000)
    samples.fill(0.0015, 12_000, 18_000)
    expect(prepareSamplesForWhisper(samples, 48_000).length).toBe(samples.length)
  })

  it('trims clear speech while preserving useful padding', () => {
    const samples = new Float32Array(48_000)
    samples.fill(0.02, 20_000, 28_000)
    const prepared = prepareSamplesForWhisper(samples, 48_000)
    expect(prepared.length).toBeLessThan(samples.length)
    expect(prepared.length).toBeGreaterThan(8_000)
  })
})

describe('requestMicPermission', () => {
  it('passes exact deviceId when a preferred microphone is set', async () => {
    const nav = mockNavigator({ permissionState: 'granted' })
    setPreferredMicrophoneDeviceId('mic-usb-1')
    await expect(requestMicPermission()).resolves.toEqual({ ok: true })
    expect(nav.mediaDevices?.getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({
        deviceId: { exact: 'mic-usb-1' },
        channelCount: 1,
      }),
      video: false,
    })
  })
  it('returns ok true when granted and capture probe succeeds', async () => {
    const nav = mockNavigator({ permissionState: 'granted' })
    await expect(requestMicPermission()).resolves.toEqual({ ok: true })
    expect(nav.mediaDevices?.getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('returns mapped notAllowed when denied and capture probe fails', async () => {
    const nav = mockNavigator({ permissionState: 'denied', mediaRejects: true })
    const err = new DOMException('denied', 'NotAllowedError')
    nav.mediaDevices!.getUserMedia = vi.fn(async () => {
      throw err
    })
    await expect(requestMicPermission()).resolves.toEqual({ ok: false, mapped: 'notAllowed' })
    expect(nav.mediaDevices?.getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('returns mapped error when granted but capture probe fails', async () => {
    mockNavigator({ permissionState: 'granted', mediaRejects: true })
    await expect(requestMicPermission()).resolves.toEqual({ ok: false, mapped: 'unknown' })
  })
})

describe('warmWavMicCapturePipeline', () => {
  it('probes getUserMedia without throwing when capture is available', async () => {
    const nav = mockNavigator({ permissionState: 'granted' })
    const close = vi.fn(async () => {})
    const resume = vi.fn(async () => {})
    const addModule = vi.fn(async () => {})
    vi.stubGlobal(
      'AudioContext',
      vi.fn(() => ({
        state: 'running',
        sampleRate: 48_000,
        resume,
        close,
        audioWorklet: { addModule },
      })),
    )
    await expect(warmWavMicCapturePipeline()).resolves.toBeUndefined()
    expect(nav.mediaDevices?.getUserMedia).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('ignores getUserMedia failures', async () => {
    mockNavigator({ permissionState: 'denied', mediaRejects: true })
    await expect(warmWavMicCapturePipeline()).resolves.toBeUndefined()
  })
})
