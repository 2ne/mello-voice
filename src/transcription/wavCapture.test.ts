import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ensureMicPermission,
  mapMicError,
  requestMicPermission,
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

describe('requestMicPermission', () => {
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
