'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export type TimelineAnimationProps = {
  animationNum: number;
  timelineRef?: React.RefObject<HTMLElement | null>;
  as?: React.ElementType;
  className?: string;
  children?: React.ReactNode;
};

// 滚动进入视口时按 animationNum 依次错峰入场的通用包装
export function TimelineAnimation({
  animationNum,
  as,
  className,
  children,
}: TimelineAnimationProps) {
  const Tag = as ?? 'div';
  const MotionTag = React.useMemo(() => motion.create(Tag), [Tag]);
  return (
    <MotionTag
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{
        duration: 0.55,
        delay: Math.min(animationNum * 0.07, 0.49),
        ease: [0.16, 1, 0.3, 1],
      }}
      className={cn(className)}
    >
      {children}
    </MotionTag>
  );
}

export default TimelineAnimation;
