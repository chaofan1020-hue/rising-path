"use client"

import type React from "react"
import dynamic from "next/dynamic"
import { Gauge } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { getSupabaseBrowserClient } from "@/lib/supabase-browser"
import { useLanguage } from "@/lib/language-context"
import type { FeatureWarpConfig } from "@/components/feature-card-warp"

const FeatureCardWarp = dynamic(
  () => import("@/components/feature-card-warp").then((module) => module.FeatureCardWarp),
  { ssr: false },
)

interface Feature {
  titleKey: string
  descKey: string
  icon: React.ReactNode
}

function DeferredFeatureBackground({ config }: { config: FeatureWarpConfig }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    let startTimer: number | undefined
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        // Keep the opening path animation on a quiet main thread before
        // initializing a WebGL surface further down the page.
        startTimer = window.setTimeout(() => setIsVisible(true), 700)
        observer.disconnect()
      },
      { rootMargin: "0px" },
    )
    observer.observe(element)
    return () => {
      observer.disconnect()
      if (startTimer) window.clearTimeout(startTimer)
    }
  }, [])

  return <div
    ref={containerRef}
    className="absolute inset-0 overflow-hidden rounded-lg"
    style={{ backgroundColor: config.colors[0] }}
  >
    {isVisible && <FeatureCardWarp config={config} />}
  </div>
}

const features: Feature[] = [
  {
    titleKey: "feature1.title",
    descKey: "feature1.desc",
    icon: (
      <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    ),
  },
  {
    titleKey: "feature2.title",
    descKey: "feature2.desc",
    icon: (
      <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24">
        <path d="M7 2v11h3v9l7-12h-4l4-8z" />
      </svg>
    ),
  },
  {
    titleKey: "feature3.title",
    descKey: "feature3.desc",
    icon: (
      <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24">
        <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z" />
      </svg>
    ),
  },
  {
    titleKey: "feature4.title",
    descKey: "feature4.desc",
    icon: (
      <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24">
        <path d="M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6 0h-4V4h4v2z" />
      </svg>
    ),
  },
  {
    titleKey: "feature5.title",
    descKey: "feature5.desc",
    icon: <Gauge className="w-12 h-12 text-white" strokeWidth={1.5} />,
  },
  {
    titleKey: "feature6.title",
    descKey: "feature6.desc",
    icon: (
      <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2M7.5 13A2.5 2.5 0 0 0 5 15.5A2.5 2.5 0 0 0 7.5 18a2.5 2.5 0 0 0 2.5-2.5A2.5 2.5 0 0 0 7.5 13m9 0a2.5 2.5 0 0 0-2.5 2.5a2.5 2.5 0 0 0 2.5 2.5a2.5 2.5 0 0 0 2.5-2.5a2.5 2.5 0 0 0-2.5-2.5Z"/>
      </svg>
    ),
  },
]

export default function FeaturesCards() {
  const { t } = useLanguage()
  const router = useRouter()

  const handleFeatureClick = async (index: number) => {
    const targetPaths = ["/ai-match", "/optimize", "/field-mappings", "/jobs", "/dashboard", "/mock-interview"]
    const targetPath = targetPaths[index] || "/"

    try {
      const client = await getSupabaseBrowserClient()
      const {
        data: { session },
      } = await client.auth.getSession()
      router.push(session ? targetPath : "/login")
    } catch {
      router.push("/login")
    }
  }

  const getShaderConfig = (index: number): FeatureWarpConfig => {
    const configs = [
      {
        proportion: 0.3,
        softness: 0.8,
        distortion: 0.15,
        swirl: 0.6,
        swirlIterations: 8,
        shape: "checks" as const,
        shapeScale: 0.08,
        colors: ["hsl(320, 60%, 12%)", "hsl(330, 70%, 18%)", "hsl(310, 50%, 9%)", "hsl(325, 65%, 15%)"],
      },
      {
        proportion: 0.4,
        softness: 1.2,
        distortion: 0.2,
        swirl: 0.9,
        swirlIterations: 12,
        shape: "stripes" as const,
        shapeScale: 0.12,
        colors: ["hsl(170, 60%, 9%)", "hsl(180, 70%, 15%)", "hsl(160, 50%, 7%)", "hsl(175, 65%, 12%)"],
      },
      {
        proportion: 0.35,
        softness: 0.9,
        distortion: 0.18,
        swirl: 0.7,
        swirlIterations: 10,
        shape: "checks" as const,
        shapeScale: 0.1,
        colors: ["hsl(150, 70%, 8%)", "hsl(160, 80%, 13%)", "hsl(140, 60%, 6%)", "hsl(155, 75%, 10%)"],
      },
      {
        proportion: 0.45,
        softness: 1.1,
        distortion: 0.22,
        swirl: 0.8,
        swirlIterations: 15,
        shape: "stripes" as const,
        shapeScale: 0.09,
        colors: ["hsl(70, 50%, 9%)", "hsl(80, 60%, 15%)", "hsl(60, 40%, 7%)", "hsl(75, 55%, 12%)"],
      },
      {
        proportion: 0.38,
        softness: 0.95,
        distortion: 0.16,
        swirl: 0.85,
        swirlIterations: 11,
        shape: "checks" as const,
        shapeScale: 0.11,
        colors: ["hsl(270, 50%, 9%)", "hsl(280, 60%, 15%)", "hsl(260, 40%, 7%)", "hsl(275, 55%, 12%)"],
      },
      {
        proportion: 0.42,
        softness: 1.0,
        distortion: 0.19,
        swirl: 0.75,
        swirlIterations: 9,
        shape: "stripes" as const,
        shapeScale: 0.13,
        colors: ["hsl(350, 60%, 9%)", "hsl(360, 70%, 15%)", "hsl(340, 50%, 7%)", "hsl(355, 65%, 12%)"],
      },
    ]
    return configs[index % configs.length] as FeatureWarpConfig
  }

  return (
    <section className="min-h-screen px-4 pb-16 pt-4 md:pt-6 bg-white dark:bg-black rounded-b-[3rem]">
      <div className="max-w-7xl mx-auto">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 md:mb-6">
          <h2 className="text-2xl font-light text-black dark:text-white md:text-3xl">{t("features.title")}</h2>
          <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-300 md:text-base">
            {t("features.subtitle")}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => {
            const shaderConfig = getShaderConfig(index)
            return (
              <div
                key={index}
                onClick={() => void handleFeatureClick(index)}
                className="block group cursor-pointer"
              >
                <div className="relative h-64 transition-transform duration-300 group-hover:scale-105">
                  <DeferredFeatureBackground config={shaderConfig} />
                  <div className="relative z-10 flex flex-col items-center justify-center h-full px-6 text-center">
                    <div className="mb-3 p-2.5 rounded-xl bg-white/10 backdrop-blur-sm transition-transform duration-300 group-hover:scale-110">
                      {feature.icon}
                    </div>
                    <h3 className="text-xl font-semibold text-white mb-2">{t(feature.titleKey)}</h3>
                    <p className="text-white/80 text-sm leading-relaxed">{t(feature.descKey)}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
