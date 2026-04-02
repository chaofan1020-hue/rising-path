'use client';

import Image from 'next/image';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
}

export function Logo({ size = 'md', showText = true }: LogoProps) {
  const sizes = {
    sm: 24,
    md: 32,
    lg: 40,
  };

  const dimensions = sizes[size];

  return (
    <div className="flex items-center gap-2">
      <Image
        src="/logo.png?v=2"
        alt="PathUp"
        width={dimensions}
        height={dimensions}
        className="rounded-lg"
        priority
        key="logo-v2"
      />
      {showText && (
        <span className="font-bold text-xl">PathUp</span>
      )}
    </div>
  );
}
