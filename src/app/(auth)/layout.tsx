import { MotionFadeIn } from '@/components/motion/motion-fade-in'
import { ThemeToggle } from '@/components/theme/ThemeToggle'

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="auth-shell">
      <div className="mb-8 flex w-full max-w-[400px] items-center justify-between sm:mb-10">
        <span className="text-sm font-semibold tracking-tight text-foreground">StockCasa</span>
        <ThemeToggle />
      </div>
      <MotionFadeIn className="auth-card w-full max-w-[400px]">
        {children}
      </MotionFadeIn>
    </div>
  )
}
