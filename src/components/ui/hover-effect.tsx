'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface HoverEffectItem {
  title: string;
  description: string;
  link: string;
  icon?: ReactNode;
}

export function HoverEffect({
  items,
  className,
}: {
  items: HoverEffectItem[];
  className?: string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div className={cn('grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3', className)}>
      {items.map((item, index) => (
        <Link
          href={item.link}
          key={item.link}
          className="group relative block h-full w-full p-2"
          onMouseEnter={() => setHoveredIndex(index)}
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <AnimatePresence>
            {hoveredIndex === index && (
              <motion.span
                className="absolute inset-0 block h-full w-full rounded-3xl bg-orange-500/80"
                layoutId="hoverBackground"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.15 } }}
                exit={{ opacity: 0, transition: { duration: 0.15, delay: 0.2 } }}
              />
            )}
          </AnimatePresence>
          <HoverCard>
            <CardTitle className="flex items-center gap-3">
              {item.icon && (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-200">
                  {item.icon}
                </span>
              )}
              <span>{item.title}</span>
            </CardTitle>
            <CardDescription>{item.description}</CardDescription>
          </HoverCard>
        </Link>
      ))}
    </div>
  );
}

function HoverCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'relative z-20 h-full w-full overflow-hidden rounded-2xl border border-transparent bg-black p-3 dark:border-white/[0.2] group-hover:border-slate-700',
        className,
      )}
    >
      <div className="relative z-50">
        <div className="p-3">{children}</div>
      </div>
    </div>
  );
}

function CardTitle({ className, children }: { className?: string; children: ReactNode }) {
  return <h4 className={cn('mt-4 font-bold tracking-wide text-zinc-100', className)}>{children}</h4>;
}

function CardDescription({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <p className={cn('mt-4 text-sm leading-relaxed tracking-wide text-zinc-400', className)}>{children}</p>
  );
}
