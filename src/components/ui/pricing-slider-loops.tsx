'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/language-context';
import { TimelineAnimation } from '@/components/ui/product-packs-utils/timeline-animation';

// 占位档位数据：接入真实定价时直接改这两个数组
const PRICING_BREAKPOINTS = [
  { maxCredits: 1000, price: 0 },
  { maxCredits: 5000, price: 49 },
  { maxCredits: 10000, price: 99 },
  { maxCredits: 15000, price: 149 },
  { maxCredits: 25000, price: 199 },
  { maxCredits: 50000, price: 249 },
  { maxCredits: 100000, price: 399 },
  { maxCredits: 150000, price: 599 },
  { maxCredits: 200000, price: 799 },
];

const BREAKPOINT_CREDIT_VALUES = [
  ...Array.from({ length: 11 }, (_, i) => i * 100),
  5000, 10000, 15000, 25000, 50000, 100000, 150000, 200000,
  300000, 400000, 500000, 600000, 700000, 800000, 900000, 1000000,
];

const getPriceForCredits = (credits: number): { price: number | null } => {
  if (credits === 1000000) return { price: null };

  const breakpoint = PRICING_BREAKPOINTS.find((tier) => credits <= tier.maxCredits);
  if (breakpoint) return { price: breakpoint.price };

  // 20 万之后每增加 10 万加 $400，直到 100 万
  const basePrice = 799;
  const extraCredits = credits - 200000;
  const extraUnits = Math.ceil(extraCredits / 100000);
  return { price: basePrice + extraUnits * 400 };
};

export function LoopsPricingSlider() {
  const { t } = useLanguage();
  const [sliderIndex, setSliderIndex] = useState(0);

  const credits = BREAKPOINT_CREDIT_VALUES[sliderIndex];
  const { price } = getPriceForCredits(credits);
  const isCustom = credits === 1000000;
  const label = isCustom
    ? t('slider.maxCredits')
    : `${credits.toLocaleString()} ${t('slider.unit')}`;

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSliderIndex(Number(e.target.value));
  };

  return (
    <section className="relative bg-white px-6 py-16 text-black md:py-20 rounded-t-[3rem]">
      <div className="mx-auto max-w-3xl text-center">
        <TimelineAnimation
          animationNum={1}
          timelineRef={undefined}
          as="h2"
          className="mb-4 text-4xl font-semibold tracking-tight md:text-5xl"
        >
          {t('pricing.title')}
        </TimelineAnimation>
        <TimelineAnimation
          animationNum={2}
          timelineRef={undefined}
          as="p"
          className="mx-auto max-w-lg text-pretty leading-relaxed text-neutral-500"
        >
          {t('pricing.subtitle')}
        </TimelineAnimation>
      </div>

      <div className="mx-auto mt-12 max-w-3xl">
        <div className="flex flex-col gap-6 md:flex-row">
          {/* 左卡：滑杆计算器 */}
          <div className="relative flex-1 rounded-xl border border-gray-200 p-8">
            <h3 className="mb-4 text-sm font-semibold text-neutral-800">{t('slider.calcTitle')}</h3>
            <div className="mb-8 text-3xl font-bold text-black">{label}</div>
            <input
              type="range"
              min={0}
              max={BREAKPOINT_CREDIT_VALUES.length - 1}
              step={1}
              value={sliderIndex}
              onChange={handleSliderChange}
              className="mb-12 h-3 w-full appearance-none rounded bg-gray-200"
              style={{
                background: `linear-gradient(to right, #F97316 0%, #F97316 ${
                  (sliderIndex / (BREAKPOINT_CREDIT_VALUES.length - 1)) * 100
                }%, #E5E7EB ${(sliderIndex / (BREAKPOINT_CREDIT_VALUES.length - 1)) * 100}%, #E5E7EB 100%)`,
              }}
            />

            <style>{`
              input[type='range']::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 28px;
                height: 28px;
                background: #ffffff;
                border: 2px solid #E5E7EB;
                border-radius: 50%;
                cursor: pointer;
                margin-top: -1px;
                box-shadow: 0 1px 5px rgba(192, 192, 192, 0.5);
                position: relative;
              }
              input[type='range']::-moz-range-thumb {
                width: 26px;
                height: 26px;
                background: #ffffff;
                border: 2px solid #E5E7EB;
                border-radius: 50%;
                cursor: pointer;
                box-shadow: 0 1px 5px rgba(192, 192, 192, 0.5);
              }
            `}</style>

            <div className="absolute bottom-8 left-8 right-8 flex items-center justify-between text-sm text-neutral-500">
              <span>{t('slider.custom')}</span>
              <a
                href="mailto:support@liorvix.com?subject=Enterprise%20pricing"
                className="flex items-center font-medium text-black"
              >
                {t('slider.contact')} <span className="ml-1">→</span>
              </a>
            </div>
          </div>

          {/* 右卡：当前方案 */}
          <div className="flex-1 rounded-xl border border-gray-200 bg-neutral-50 p-8">
            <h3 className="mb-4 text-sm font-semibold text-neutral-800">{t('slider.planTitle')}</h3>
            <div className="mb-2">
              <div className="mb-6 text-3xl font-bold text-black">
                {price === 0 ? t('slider.free') : price === null ? t('slider.contact') : `$${price} ${t('slider.perMonth')}`}
              </div>
            </div>
            <p className="mt-8 text-sm leading-relaxed text-gray-500">
              {price === 0
                ? t('slider.freeDesc')
                : price === null
                ? t('slider.enterpriseDesc')
                : t('slider.paidDesc')}
            </p>
            <Link
              href="/login"
              className="mt-8 inline-block rounded-md bg-black px-6 py-3 text-sm font-semibold text-white"
            >
              {price === null ? t('slider.contact') : t('slider.getStarted')}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export default LoopsPricingSlider;
