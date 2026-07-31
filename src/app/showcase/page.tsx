'use client'

import { SplineScene } from "@/components/ui/splite";
import { Card } from "@/components/ui/card"
import { Spotlight } from "@/components/ui/spotlight"
import { useLanguage } from "@/lib/language-context"
import { useRouter } from "next/navigation"

export default function ShowcasePage() {
  const { t } = useLanguage()
  const router = useRouter()

  const handleClick = () => {
    router.push('/home')
  }

  return (
    <div 
      className="min-h-screen bg-white dark:bg-black cursor-pointer"
      onClick={handleClick}
    >
      <div className="container mx-auto px-4 py-8 min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-4xl h-[400px] bg-black/[0.96] relative overflow-hidden">
          <Spotlight
            className="-top-40 left-0 md:left-60 md:-top-20"
            fill="white"
          />
          
          <div className="flex h-full">
            {/* Left content */}
            <div className="flex-1 p-8 relative z-10 flex flex-col justify-center">
              <h1 className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-b from-neutral-50 to-neutral-400">
                {t("showcase.title")}
              </h1>
              <p className="mt-4 text-neutral-300 max-w-lg">
                {t("showcase.description")}
              </p>
              <p className="mt-8 text-neutral-400 text-sm animate-pulse">
                {t("showcase.clickToEnter")}
              </p>
            </div>

            {/* Right content */}
            <div className="flex-[1.3] relative">
              <SplineScene 
                scene="https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode"
                className="w-full h-full"
              />
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
