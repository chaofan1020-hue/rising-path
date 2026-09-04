'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import { type Locale, useLanguage } from '@/lib/language-context';

type LanyardModule = typeof import('@/components/Lanyard');

// Start the 3D chunk as soon as the auth page imports this client component.
// The same promise is reused by the modal, so opening it does not trigger a
// second module request after registration completes.
const lanyardModulePromise: Promise<LanyardModule> = import('@/components/Lanyard');

function loadLanyardModule(): Promise<LanyardModule> {
  return lanyardModulePromise;
}

const Lanyard = dynamic(() => loadLanyardModule().then((module) => module.default), { ssr: false });
const LIORVIX_LOGO_DATA_URL = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MCAyMCIgZmlsbD0iY3VycmVudENvbG9yIiBhcmlhLWhpZGRlbj0idHJ1ZSI+DQogIDxwYXRoIGQ9Ik0wIDBoMjlhNCA0IDAgMCAxIDAgOEgwVjB6IiAvPg0KICA8cGF0aCBkPSJNNDAgMjBIMTFhNCA0IDAgMCAxIDAtOGgyOXY4eiIgLz4NCjwvc3ZnPg0K';

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

function splitBadgeName(name: string): string[] {
  const characters = Array.from(name.trim() || 'Liorvix member');
  if (characters.length <= 16) return [characters.join('')];

  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const lines = ['', ''];
    for (const word of words) {
      const target = lines[0].length <= lines[1].length ? 0 : 1;
      lines[target] = `${lines[target]}${lines[target] ? ' ' : ''}${word}`;
    }
    if (lines.every((line) => line.length <= 18)) return lines.filter(Boolean);
  }

  const midpoint = Math.ceil(characters.length / 2);
  return [characters.slice(0, midpoint).join(''), characters.slice(midpoint).join('')];
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
    welcome: '欢迎加入 LIORVIX',
    workspace: '为海外留学生打造的求职工作台',
    keepMoving: '继续向前',
    title: '注册成功',
    subtitle: '欢迎加入 Liorvix',
    continue: '进入平台',
  },
  'zh-TW': {
    member: '學生會員',
    welcome: '歡迎加入 LIORVIX',
    workspace: '為海外留學生打造的求職工作台',
    keepMoving: '繼續向前',
    title: '註冊成功',
    subtitle: '歡迎加入 Liorvix',
    continue: '進入平台',
  },
  en: {
    member: 'STUDENT MEMBER',
    welcome: 'WELCOME TO LIORVIX',
    workspace: 'CAREER WORKSPACE FOR INTERNATIONAL STUDENTS',
    keepMoving: 'KEEP MOVING FORWARD',
    title: 'Account created',
    subtitle: 'Welcome to Liorvix',
    continue: 'Enter workspace',
  },
};

function createCardTexture(name: string, side: 'front' | 'back', copy: SuccessCopy): string {
  const safeName = escapeXml(name || 'Liorvix member');
  const safeCopy = {
    member: escapeXml(copy.member),
    welcome: escapeXml(copy.welcome),
    workspace: escapeXml(copy.workspace),
    keepMoving: escapeXml(copy.keepMoving),
  };
  const nameLines = splitBadgeName(name).map(escapeXml);
  const nameLength = Array.from(name).length;
  const nameFontSize = nameLines.length > 1 ? (nameLength > 28 ? 30 : 38) : nameLength > 13 ? 42 : 56;
  const nameMarkup = nameLines.length === 1
    ? `<text x="70" y="528" fill="#1d1d1f" font-family="Arial, Microsoft YaHei, sans-serif" font-size="${nameFontSize}" font-weight="700" letter-spacing="0">${safeName}</text>`
    : `<text x="70" y="478" fill="#1d1d1f" font-family="Arial, Microsoft YaHei, sans-serif" font-size="${nameFontSize}" font-weight="700" letter-spacing="0"><tspan x="70" dy="0">${nameLines[0]}</tspan><tspan x="70" dy="52">${nameLines[1]}</tspan></text>`;
  const isFront = side === 'front';
  const svg = isFront
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 660 1000">
        <rect width="660" height="1000" fill="#f5f5f7" />
        <image href="${LIORVIX_LOGO_DATA_URL}" x="70" y="86" width="112" height="56" preserveAspectRatio="xMinYMid meet" />
        <text x="70" y="181" fill="#1d1d1f" font-family="Arial, Microsoft YaHei, sans-serif" font-size="23" font-weight="700" letter-spacing="6">LIORVIX</text>
        <text x="590" y="174" fill="#86868b" text-anchor="end" font-family="Arial, Microsoft YaHei, sans-serif" font-size="14" font-weight="600" letter-spacing="2">${safeCopy.member}</text>
        <line x1="70" y1="235" x2="590" y2="235" stroke="#d2d2d7" stroke-width="2" />
        <text x="70" y="400" fill="#86868b" font-family="Arial, Microsoft YaHei, sans-serif" font-size="14" font-weight="600" letter-spacing="3">MEMBER</text>
        ${nameMarkup}
        <text x="70" y="693" fill="#86868b" font-family="Arial, Microsoft YaHei, sans-serif" font-size="14" letter-spacing="1">${safeCopy.workspace}</text>
        <line x1="70" y1="842" x2="590" y2="842" stroke="#d2d2d7" stroke-width="2" />
        <text x="70" y="892" fill="#86868b" font-family="Arial, sans-serif" font-size="13" letter-spacing="2">LIORVIX.COM</text>
      </svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 660 1000">
        <rect width="660" height="1000" fill="#f5f5f7" />
        <image href="${LIORVIX_LOGO_DATA_URL}" x="230" y="390" width="200" height="100" preserveAspectRatio="xMidYMid meet" />
        <text x="330" y="568" fill="#1d1d1f" text-anchor="middle" font-family="Arial, Microsoft YaHei, sans-serif" font-size="30" font-weight="700" letter-spacing="10">LIORVIX</text>
        <line x1="255" y1="630" x2="405" y2="630" stroke="#d2d2d7" stroke-width="2" />
        <text x="330" y="690" fill="#86868b" text-anchor="middle" font-family="Arial, Microsoft YaHei, sans-serif" font-size="15" font-weight="600" letter-spacing="2">${safeCopy.keepMoving}</text>
        <text x="330" y="875" fill="#86868b" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" letter-spacing="2">LIORVIX.COM</text>
      </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
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
  const cardTextures = useMemo(
    () => ({
      front: createCardTexture(name, 'front', copy),
      back: createCardTexture(name, 'back', copy),
    }),
    [copy, name],
  );

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm">
      <div className="absolute inset-0">
        <Lanyard
          position={[0, 0, 20]}
          gravity={[0, -40, 0]}
          frontImage={cardTextures.front}
          backImage={cardTextures.back}
          imageFit="contain"
        />
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
