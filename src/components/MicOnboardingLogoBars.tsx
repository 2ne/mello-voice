import { cn } from '@/lib/utils'

const micOnboardingBarBase =
  'w-[0.3125rem] shrink-0 rounded-full animate-[mello-logo-bar-breathe_1.28s_var(--ease-opacity-breathe)_infinite] motion-reduce:animate-none motion-reduce:opacity-100'

/** Animated bars from the mic onboarding / warming screens. */
export function MicOnboardingLogoBars({ variant = 'onDark' }: { variant?: 'onDark' | 'onLight' }) {
  const tall =
    variant === 'onDark'
      ? 'bg-[color-mix(in_oklab,var(--background)_94%,transparent)]'
      : 'bg-[color-mix(in_oklab,var(--foreground)_94%,transparent)]'
  const short =
    variant === 'onDark'
      ? 'bg-[color-mix(in_oklab,var(--background)_52%,transparent)]'
      : 'bg-[color-mix(in_oklab,var(--foreground)_52%,transparent)]'

  return (
    <div className="flex shrink-0 items-center justify-center gap-[0.3125rem]" role="img" aria-label="Loading">
      <span className={cn(micOnboardingBarBase, 'h-3', short)} />
      <span className={cn(micOnboardingBarBase, 'h-[1.35rem] delay-[130ms]', tall)} />
      <span className={cn(micOnboardingBarBase, 'h-3 delay-[260ms]', short)} />
    </div>
  )
}
