'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { FloatingIconsHero, type FloatingIconsHeroProps } from '@/components/ui/floating-icons-hero'
import {
  IconGoogle,
  IconApple,
  IconMicrosoft,
  IconFigma,
  IconGitHub,
  IconSlack,
  IconNotion,
  IconVercel,
  IconStripe,
  IconDiscord,
  IconX,
  IconSpotify,
  IconDropbox,
  IconTwitch,
  IconLinear,
  IconYouTube,
} from '@/components/ui/hero-icons'
import { useLanguage } from '@/lib/language-context'

const demoIcons: FloatingIconsHeroProps['icons'] = [
  { id: 1, icon: IconGoogle, className: 'top-[10%] left-[10%]' },
  { id: 2, icon: IconApple, className: 'top-[20%] right-[8%]' },
  { id: 3, icon: IconMicrosoft, className: 'top-[80%] left-[10%]' },
  { id: 4, icon: IconFigma, className: 'bottom-[10%] right-[10%]' },
  { id: 5, icon: IconGitHub, className: 'top-[5%] left-[30%]' },
  { id: 6, icon: IconSlack, className: 'top-[5%] right-[30%]' },
  { id: 7, icon: IconVercel, className: 'bottom-[8%] left-[25%]' },
  { id: 8, icon: IconStripe, className: 'top-[40%] left-[15%]' },
  { id: 9, icon: IconDiscord, className: 'top-[75%] right-[25%]' },
  { id: 10, icon: IconX, className: 'top-[90%] left-[70%]' },
  { id: 11, icon: IconNotion, className: 'top-[50%] right-[5%]' },
  { id: 12, icon: IconSpotify, className: 'top-[55%] left-[5%]' },
  { id: 13, icon: IconDropbox, className: 'top-[5%] left-[55%]' },
  { id: 14, icon: IconTwitch, className: 'bottom-[5%] right-[45%]' },
  { id: 15, icon: IconLinear, className: 'top-[25%] right-[20%]' },
  { id: 16, icon: IconYouTube, className: 'top-[60%] left-[30%]' },
]

export default function ShowcasePage() {
  const { locale } = useLanguage()
  const router = useRouter()
  const [isExiting, setIsExiting] = useState(false)

  useEffect(() => {
    router.prefetch('/home')
  }, [router])

  const content = {
    'zh-CN': {
      title: 'Rising Path',
      subtitle: '专为海外留学生打造的一站式求职平台',
      cta: '开始探索',
    },
    'zh-TW': {
      title: 'Rising Path',
      subtitle: '專為海外留學生打造的一站式求職平台',
      cta: '開始探索',
    },
    'en': {
      title: 'Rising Path',
      subtitle: 'Your one-stop career platform for international students',
      cta: 'Get Started',
    },
  }

  const { title, subtitle, cta } = content[locale]

  const handleCtaClick = () => {
    setIsExiting(true)
    setTimeout(() => {
      router.push('/home')
    }, 600)
  }

  return (
    <AnimatePresence>
      {!isExiting && (
        <motion.div
          initial={{ y: 0 }}
          exit={{ y: '-100%', opacity: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <FloatingIconsHero
            title={title}
            subtitle={subtitle}
            ctaText={cta}
            ctaHref="/home"
            icons={demoIcons}
            onCtaClick={handleCtaClick}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
