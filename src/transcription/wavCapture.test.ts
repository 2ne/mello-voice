import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureMicPermission } from './wavCapture'

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
  it('returns false when permission state is denied', async () => {
    const nav = mockNavigator({ permissionState: 'denied' })
    await expect(ensureMicPermission()).resolves.toBe(false)
    expect(nav.mediaDevices?.getUserMedia).not.toHaveBeenCalled()
  })

  it('returns true when permission state is granted', async () => {
    const nav = mockNavigator({ permissionState: 'granted' })
    await expect(ensureMicPermission()).resolves.toBe(true)
    expect(nav.mediaDevices?.getUserMedia).not.toHaveBeenCalled()
  })

  it('requests mic when state is prompt and stops temp stream tracks', async () => {
    const nav = mockNavigator({ permissionState: 'prompt' })
    await expect(ensureMicPermission()).resolves.toBe(true)
    expect(nav.mediaDevices?.getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('returns false when permission query is unavailable and gUM fails', async () => {
    const nav = mockNavigator({ permissionQueryThrows: true, mediaRejects: true })
    await expect(ensureMicPermission()).resolves.toBe(false)
    expect(nav.permissions?.query).toHaveBeenCalledTimes(1)
    expect(nav.mediaDevices?.getUserMedia).toHaveBeenCalledTimes(1)
  })
})
