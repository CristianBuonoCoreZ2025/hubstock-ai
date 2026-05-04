'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

type Props = {
  children: React.ReactNode
  className?: string
  /** Segundos */
  delay?: number
  /** Duración de la transición en segundos */
  duration?: number
}

/**
 * Entrada suave (fade + ligero desplazamiento) para secciones responsivas.
 */
export function MotionFadeIn({
  children,
  className,
  delay = 0,
  duration = 0.42,
}: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration,
        delay,
        ease: [0.22, 1, 0.36, 1],
      }}
      className={cn(className)}
    >
      {children}
    </motion.div>
  )
}
