import { describe, expect, it } from 'vitest'
import { shouldShowSessionChrome } from './overlaySessionState'

describe('shouldShowSessionChrome', () => {
  it('shows chrome while processing even when bar preference is off', () => {
    expect(
      shouldShowSessionChrome({
        barEnabled: false,
        isExpanded: false,
        isProcessing: true,
        activeError: null,
      }),
    ).toBe(true)
  })

  it('shows chrome when activeError is present even if bar preference is off', () => {
    expect(
      shouldShowSessionChrome({
        barEnabled: false,
        isExpanded: false,
        isProcessing: false,
        activeError: 'Microphone access is required. Allow it and try again.',
      }),
    ).toBe(true)
  })

  it('hides chrome when preference is off and session is idle', () => {
    expect(
      shouldShowSessionChrome({
        barEnabled: false,
        isExpanded: false,
        isProcessing: false,
        activeError: null,
      }),
    ).toBe(false)
  })
})
