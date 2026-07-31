'use client'

import { motion, useMotionTemplate, useMotionValue } from 'framer-motion'
import { useEffect } from 'react'

interface SpotlightProps {
  className?: string
  fill?: string
}

export function Spotlight({ className, fill = "white" }: SpotlightProps) {
  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mouseX.set(e.clientX)
      mouseY.set(e.clientY)
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [mouseX, mouseY])

  return (
    <>
      {/* 静态聚光灯效果 */}
      <motion.div
        className={`absolute w-64 h-64 rounded-full blur-3xl opacity-20 pointer-events-none ${className}`}
        style={{
          background: fill,
        }}
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.2, 0.3, 0.2],
        }}
        transition={{
          duration: 3,
          repeat: Infinity,
          repeatType: "reverse",
        }}
      />
      
      {/* 鼠标跟随光斑效果 */}
      <motion.div
        className="fixed inset-0 pointer-events-none z-50"
        style={{
          background: useMotionTemplate`radial-gradient(600px circle at ${mouseX}px ${mouseY}px, ${fill}15, transparent 80%)`,
        }}
      />
    </>
  )
}
