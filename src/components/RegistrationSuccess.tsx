'use client';

import dynamic from 'next/dynamic';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { type Locale, useLanguage } from '@/lib/language-context';
import {
  badgeSerialFromName,
  isCjkChar,
  normalizeBadgeName,
  preferredBadgeMaxSize,
  preferredBadgeTracking,
  splitBadgeNameLines,
} from '@/lib/apple-badge-layout';

type LanyardModule = typeof import('@/components/Lanyard');

// Start the 3D chunk as soon as the auth page imports this client component.
// The same promise is reused by the modal, so opening it does not trigger a
// second module request after registration completes.
const lanyardModulePromise: Promise<LanyardModule> = import('@/components/Lanyard');

function loadLanyardModule(): Promise<LanyardModule> {
  return lanyardModulePromise;
}

const Lanyard = dynamic(() => loadLanyardModule().then((module) => module.default), { ssr: false });

/** Start downloading the Three scene before registration is submitted. */
export function preloadRegistrationSuccess(): void {
  void loadLanyardModule()
    .then(({ preloadLanyardAssets }) => preloadLanyardAssets())
    .catch((error) => {
      // Rendering keeps its normal dynamic-import retry path if a speculative preload fails.
      console.warn('[RegistrationSuccess] Lanyard preload failed:', error);
    });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function estimateLineWidth(text: string, fontSize: number, trackingEm: number): number {
  const chars = Array.from(text);
  let width = 0;
  for (const char of chars) {
    if (isCjkChar(char)) width += fontSize;
    else if (char === ' ') width += fontSize * 0.28;
    else if (/[A-Z]/.test(char)) width += fontSize * 0.7;
    else if (/[ilI.'’]/.test(char)) width += fontSize * 0.3;
    else if (/[mwMW]/.test(char)) width += fontSize * 0.86;
    else width += fontSize * 0.56;
  }
  return width + fontSize * trackingEm * Math.max(0, chars.length - 1);
}

function layoutCardName(name: string): { lines: string[]; fontSize: number; letterSpacing: number } {
  const text = normalizeBadgeName(name) || 'Liorvix member';
  const maxWidth = 540;
  const trackingEm = preferredBadgeTracking(text);
  const maxSize = preferredBadgeMaxSize(text);
  const minSize = 40;

  const largestFit = (lines: string[], tracking: number) => {
    for (let size = maxSize; size >= minSize; size -= 1) {
      if (lines.every((line) => estimateLineWidth(line, size, tracking) <= maxWidth)) return size;
    }
    return minSize;
  };

  const single = [text];
  const singleSize = largestFit(single, trackingEm);
  const split = splitBadgeNameLines(text);
  const canSplit = split.length > 1;
  const splitTracking = canSplit ? Math.min(trackingEm, 0.02) : trackingEm;
  const splitSize = canSplit ? largestFit([...split], splitTracking) : 0;
  const preferSplit = canSplit && (splitSize >= singleSize + 4 || singleSize < 52);

  if (preferSplit) {
    return { lines: [...split], fontSize: splitSize, letterSpacing: splitTracking * splitSize };
  }
  return { lines: single, fontSize: singleSize, letterSpacing: trackingEm * singleSize };
}

function liorvixMark(centerX: number, y: number, scale: number): string {
  const x = centerX - 34.5 * scale;
  return `<g fill="#1d1d1f" transform="translate(${x} ${y}) scale(${scale})"><path d="M0 0h29a4 4 0 0 1 0 8H0V0z"/><path d="M40 20H11a4 4 0 0 1 0-8h29v8z"/></g>`;
}

type SuccessCopy = {
  member: string;
  welcome: string;
  workspace: string;
  keepMoving: string;
  title: string;
  subtitle: string;
  continue: string;
};

const SUCCESS_COPY: Record<Locale, SuccessCopy> = {
  'zh-CN': {
    member: '学生会员',
    welcome: '欢迎加入',
    workspace: '为海外留学生打造的求职工作台',
    keepMoving: '继续向前',
    title: '注册成功',
    subtitle: '欢迎加入 Liorvix',
    continue: '进入平台',
  },
  'zh-TW': {
    member: '學生會員',
    welcome: '歡迎加入',
    workspace: '為海外留學生打造的求職工作台',
    keepMoving: '繼續向前',
    title: '註冊成功',
    subtitle: '歡迎加入 Liorvix',
    continue: '進入平台',
  },
  en: {
    member: 'STUDENT MEMBER',
    welcome: 'Welcome',
    workspace: 'CAREER WORKSPACE FOR INTERNATIONAL STUDENTS',
    keepMoving: 'KEEP MOVING FORWARD',
    title: 'Account created',
    subtitle: 'Welcome to Liorvix',
    continue: 'Enter workspace',
  },
};

function createCardTexture(name: string, side: 'front' | 'back', copy: SuccessCopy): string {
  const font = '-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, Arial, sans-serif';
  const ink = '#1d1d1f';
  const secondary = '#3a3a3c';
  const member = escapeXml(copy.member);
  const welcome = escapeXml(copy.welcome);
  const keepMoving = escapeXml(copy.keepMoving);
  const serial = badgeSerialFromName(name);
  const layout = layoutCardName(name);
  const nameLines = layout.lines.map(escapeXml);
  const nameLineHeight = Math.round(layout.fontSize * 1.08);
  const welcomeY = 442;
  const nameStartY = welcomeY + 40 + layout.fontSize;
  const nameMarkup = nameLines.length === 1
    ? `<text x="330" y="${nameStartY}" text-anchor="middle" fill="${ink}" font-family="${font}" font-size="${layout.fontSize}" font-weight="700" letter-spacing="${layout.letterSpacing}">${nameLines[0]}</text>`
    : `<text x="330" y="${nameStartY}" text-anchor="middle" fill="${ink}" font-family="${font}" font-size="${layout.fontSize}" font-weight="700" letter-spacing="${layout.letterSpacing}"><tspan x="330" dy="0">${nameLines[0]}</tspan><tspan x="330" dy="${nameLineHeight}">${nameLines[1]}</tspan></text>`;
  const roleY = nameStartY + (nameLines.length === 1 ? Math.round(layout.fontSize * 0.62) : nameLineHeight + Math.round(layout.fontSize * 0.46));
  const svg = side === 'front'
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 660 1000" width="660" height="1000">
        <rect width="660" height="1000" fill="#f5f5f7" />
        ${liorvixMark(330, 214, 3.8)}
        <text x="330" y="332" text-anchor="middle" fill="${ink}" font-family="${font}" font-size="42" font-weight="700" letter-spacing="8">LIORVIX</text>
        <line x1="250" y1="368" x2="410" y2="368" stroke="#d2d2d7" stroke-width="2" />
        <text x="330" y="${welcomeY}" text-anchor="middle" fill="${ink}" font-family="${font}" font-size="42" font-weight="600">${welcome}</text>
        ${nameMarkup}
        <text x="330" y="${roleY}" text-anchor="middle" fill="${ink}" font-family="${font}" font-size="32" font-weight="600" letter-spacing="2">${member}</text>
        <line x1="80" y1="868" x2="580" y2="868" stroke="#d2d2d7" stroke-width="2" />
        <text x="80" y="922" fill="${secondary}" font-family="${font}" font-size="22" font-weight="600" letter-spacing="2.5">LIORVIX.COM</text>
        <text x="580" y="922" text-anchor="end" fill="${secondary}" font-family="${font}" font-size="22" font-weight="600" letter-spacing="1.5">NO. ${serial}</text>
      </svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 660 1000" width="660" height="1000">
        <rect width="660" height="1000" fill="#f5f5f7" />
        ${liorvixMark(330, 360, 4.6)}
        <text x="330" y="504" text-anchor="middle" fill="${ink}" font-family="${font}" font-size="40" font-weight="700" letter-spacing="8">LIORVIX</text>
        <line x1="240" y1="544" x2="420" y2="544" stroke="#d2d2d7" stroke-width="2" />
        <text x="330" y="598" text-anchor="middle" fill="${secondary}" font-family="${font}" font-size="24" font-weight="600" letter-spacing="2">${keepMoving}</text>
        <text x="330" y="922" text-anchor="middle" fill="${secondary}" font-family="${font}" font-size="20" font-weight="600" letter-spacing="2.5">LIORVIX.COM</text>
      </svg>`;

  return svg;
}

const CARD_TEXTURE_WIDTH = 1320;
const CARD_TEXTURE_HEIGHT = 2000;

function rasterizeSvgToPng(svg: string): Promise<string> {
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = CARD_TEXTURE_WIDTH;
      canvas.height = CARD_TEXTURE_HEIGHT;
      const context = canvas.getContext('2d');
      if (!context) {
        resolve(svgUrl);
        return;
      }
      context.fillStyle = '#f5f5f7';
      context.fillRect(0, 0, CARD_TEXTURE_WIDTH, CARD_TEXTURE_HEIGHT);
      context.drawImage(image, 0, 0, CARD_TEXTURE_WIDTH, CARD_TEXTURE_HEIGHT);
      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(svgUrl);
          return;
        }
        resolve(URL.createObjectURL(blob));
      }, 'image/png');
    };
    image.onerror = () => resolve(svgUrl);
    image.src = svgUrl;
  });
}

export default function RegistrationSuccess({
  onContinue,
  displayName,
}: {
  onContinue: () => void;
  displayName?: string;
}) {
  const { locale } = useLanguage();
  const copy = SUCCESS_COPY[locale];
  const name = displayName?.trim() || 'Liorvix member';
  const cardSvgs = useMemo(
    () => ({
      front: createCardTexture(name, 'front', copy),
      back: createCardTexture(name, 'back', copy),
    }),
    [copy, name],
  );
  const [cardTextures, setCardTextures] = useState<{ front: string; back: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let frontUrl: string | null = null;
    let backUrl: string | null = null;
    Promise.all([rasterizeSvgToPng(cardSvgs.front), rasterizeSvgToPng(cardSvgs.back)])
      .then(([front, back]) => {
        if (cancelled) {
          if (front.startsWith('blob:')) URL.revokeObjectURL(front);
          if (back.startsWith('blob:')) URL.revokeObjectURL(back);
          return;
        }
        frontUrl = front;
        backUrl = back;
        setCardTextures({ front, back });
      })
      .catch(() => {
        if (!cancelled) {
          setCardTextures({
            front: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cardSvgs.front)}`,
            back: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cardSvgs.back)}`,
          });
        }
      });
    return () => {
      cancelled = true;
      if (frontUrl?.startsWith('blob:')) URL.revokeObjectURL(frontUrl);
      if (backUrl?.startsWith('blob:')) URL.revokeObjectURL(backUrl);
    };
  }, [cardSvgs]);

  return (
    <div className="fixed inset-0 z-[9999] bg-black/85">
      <div className="absolute inset-0">
        {cardTextures ? (
          <Suspense fallback={null}>
            <Lanyard
              position={[0, 0, 20]}
              gravity={[0, -40, 0]}
              frontImage={cardTextures.front}
              backImage={cardTextures.back}
              imageFit="contain"
            />
          </Suspense>
        ) : null}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-[17%] z-10 px-6 text-center text-white">
        <h2 className="text-3xl font-bold">{copy.title}</h2>
        <p className="mt-2 text-sm text-white/65">{copy.subtitle}</p>
      </div>
      <div className="absolute inset-x-0 bottom-8 z-10 flex justify-center">
        <button
          type="button"
          onClick={onContinue}
          className="rounded-full bg-white/15 px-8 py-2.5 text-sm font-medium text-white backdrop-blur-md transition-colors hover:bg-white/25"
        >
          {copy.continue}
        </button>
      </div>
    </div>
  );
}
