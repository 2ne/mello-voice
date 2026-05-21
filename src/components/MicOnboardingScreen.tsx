import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { MicrophoneOutlineIcon } from '@/components/icons/MicrophoneOutlineIcon'
import { MicOnboardingLogoBars } from '@/components/MicOnboardingLogoBars'
import { micRecoveryCopy, type MicRecoveryKind } from '@/transcription/wavCapture'

export interface MicOnboardingScreenProps {
  phase: 'prompt' | 'warming'
  recovery: MicRecoveryKind | null
  /** From `runtime_os` — Windows blocked flow differs (WebView2 vs Settings app list). */
  runtimeOs?: string | null
  busy: boolean
  onAllowClick: () => void
  onOpenMicSettings?: () => void
}

export function MicOnboardingScreen({
  phase,
  recovery,
  runtimeOs,
  busy,
  onAllowClick,
  onOpenMicSettings,
}: MicOnboardingScreenProps) {
  const recoveryCopy = recovery ? micRecoveryCopy(recovery, runtimeOs) : null
  const isNotFoundRecovery = recovery === 'notFound'
  const isBlockedRecovery = recovery === 'notAllowed'
  const isWindowsBlocked = isBlockedRecovery && runtimeOs === 'windows'
  const primaryCtaLabel =
    isBlockedRecovery && !isWindowsBlocked
      ? 'Open microphone settings'
      : recovery === 'notFound' || recovery === 'notReadable' || recovery === 'unknown'
        ? 'Retry microphone check'
        : 'Allow microphone access'

  if (phase === 'warming') {
    return (
      <div className="mic-onboarding-enter flex min-h-svh flex-col items-center justify-center gap-4 bg-background px-8 py-12">
        <div
          className="flex size-[3.5rem] shrink-0 items-center justify-center rounded-full bg-foreground shadow-sm ring-1 ring-black/[0.06] dark:ring-white/[0.08]"
          aria-hidden
        >
          <MicOnboardingLogoBars />
        </div>
        <p className="text-base text-muted-foreground">Loading</p>
      </div>
    )
  }

  return (
    <div className="mic-onboarding-enter flex min-h-svh flex-col items-center justify-center px-8 py-12">
      <div className="flex w-full max-w-max flex-col items-stretch gap-10">
        <div className="flex flex-col items-center gap-5 text-center">
          <div
            className="flex size-[3.5rem] shrink-0 items-center justify-center rounded-full bg-foreground shadow-sm ring-1 ring-black/[0.06] dark:ring-white/[0.08]"
            aria-hidden
          >
            <MicOnboardingLogoBars />
          </div>
          <div className="space-y-1">
            <h1 className="mb-2 text-2xl font-semibold tracking-[-0.03em] text-foreground">
              Mello Voice
            </h1>
            <p className="text-base leading-snug text-muted-foreground">
              Private dictation, processed locally.
            </p>
            <p className="text-base leading-snug text-muted-foreground">
              Nothing you say leaves your device.
            </p>
          </div>
        </div>

        <Separator className="w-full shrink-0 bg-border/80" />

        <div className="flex w-full flex-col items-center gap-6">
          {recoveryCopy ? (
            <div
              role="alert"
              className="w-full rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-left"
            >
              <p className="text-base font-medium text-foreground">{recoveryCopy.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {recoveryCopy.body}
              </p>
            </div>
          ) : null}

          {isNotFoundRecovery || isBlockedRecovery ? null : (
            <>
              <MicrophoneOutlineIcon
                className="text-muted-foreground"
                strokeWidth={1.35}
                size={36}
              />
              <p className="max-w-[280px] text-center text-base leading-snug text-foreground">
                Mello Voice needs microphone access
              </p>
            </>
          )}

          <div className="flex w-full flex-col gap-3">
            <Button
              type="button"
              size="lg"
              className="h-12 w-full rounded-full px-6 text-lg font-semibold"
              disabled={busy}
              onClick={
                isBlockedRecovery && !isWindowsBlocked
                  ? (onOpenMicSettings ?? onAllowClick)
                  : onAllowClick
              }
            >
              {primaryCtaLabel}
            </Button>
            {isBlockedRecovery && !isWindowsBlocked ? (
              <Button
                type="button"
                variant="ghost"
                size="lg"
                className="h-11 w-full rounded-full px-6 text-base font-medium text-muted-foreground"
                disabled={busy}
                onClick={onAllowClick}
              >
                Check again
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
