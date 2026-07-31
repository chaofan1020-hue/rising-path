'use client'

import { FormBuilderHero } from "@/components/ui/hero-section-8";
import { useLanguage } from "@/lib/language-context"

export default function ShowcasePage() {
  const { t } = useLanguage()

  return (
    <FormBuilderHero
      illustrationSrc="https://tally.so/images/demo/v2/roll-up-sleeves.png"
      illustrationAlt="Rising Path - Your Career Growth Partner"
      title={t("showcase.title")}
      description={t("showcase.description")}
      buttonText={t("showcase.clickToEnter")}
      buttonHref="/home"
    />
  )
}
