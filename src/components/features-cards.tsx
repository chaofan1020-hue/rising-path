"use client"

import type React from "react"
import Link from "next/link"
import { Warp } from "@paper-design/shaders-react"
import { useLanguage } from "@/lib/language-context"

interface Feature {
  titleKey: string
  descKey: string
  icon: React.ReactNode
  href: string
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
    href: "/access-code",
  },
  {
    titleKey: "feature2.title",
    descKey: "feature2.desc",
    icon: (
      <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24">
        <path d="M7 2v11h3v9l7-12h-4l4-8z" />
      </svg>
    ),
    href: "/access-code",
  },
  {
    titleKey: "feature3.title",
    descKey: "feature3.desc",
    icon: (
      <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24">
        <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z" />
      </svg>
    ),
    href: "/access-code",
  },
  {
    titleKey: "feature4.title",
    descKey: "feature4.desc",
    icon: (
      <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    ),
    href: "/access-code",
  },
  {
    titleKey: "feature5.title",
    descKey: "feature5.desc",
    icon: (
      <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24">
        <path d="M17 1H7c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-2-2-2zM7 4V3h10v1H7zM7 18V6h10v12H7z" />
      </svg>
    ),
    href: "/access-code",
  },
  {
    titleKey: "feature6.title",
    descKey: "feature6.desc",
    icon: (
      <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24">
        <path d="M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1zm-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1z"/>
      </svg>
    ),
    href: "/access-code",
  },
]

export default function FeaturesCards() {
  const { t } = useLanguage()
  const getShaderConfig = (index: number) => {
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
    return configs[index % configs.length]
  }

  return (
    <section className="min-h-screen py-20 px-4 bg-white dark:bg-black rounded-b-[3rem]">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-light text-foreground mb-6">{t("features.title")}</h2>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
            {t("features.subtitle")}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => {
            const shaderConfig = getShaderConfig(index)
            return (
              <div
                key={index}
                onClick={() => {
                  // 保存目标路径到 localStorage，访问码验证后跳转到对应页面
                  const targetPaths = ["/ai-match", "/optimize", "/field-mappings", "/jobs", "/applications", "/mock-interview"];
                  localStorage.setItem("target_path", targetPaths[index] || "/");
                  window.location.href = "/access-code";
                }}
                className="block group cursor-pointer"
              >
                <div className="relative h-64 transition-transform duration-300 group-hover:scale-105">
                  <div className="absolute inset-0 rounded-3xl overflow-hidden">
                    <Warp
                      style={{ height: "100%", width: "100%" }}
                      proportion={shaderConfig.proportion}
                      softness={shaderConfig.softness}
                      distortion={shaderConfig.distortion}
                      swirl={shaderConfig.swirl}
                      swirlIterations={shaderConfig.swirlIterations}
                      shape={shaderConfig.shape}
                      shapeScale={shaderConfig.shapeScale}
                      colors={shaderConfig.colors}
                    />
                  </div>
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
