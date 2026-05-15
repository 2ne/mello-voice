export interface OverlaySessionStateInput {
  barEnabled: boolean
  isExpanded: boolean
  isProcessing: boolean
  activeError: string | null
  inlineHideOpen: boolean
}

/**
 * Preference on: always show the pill.
 * Preference off: only while dictating / processing / error, or inline menu.
 */
export function shouldShowSessionChrome(input: OverlaySessionStateInput): boolean {
  return (
    input.barEnabled ||
    input.isExpanded ||
    input.isProcessing ||
    !!input.activeError ||
    input.inlineHideOpen
  )
}
