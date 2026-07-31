"use client";

import { motion, useInView, Variants } from "framer-motion";
import { ReactNode, RefObject, useEffect, useState } from "react";

interface TimelineContentProps {
  children: ReactNode;
  animationNum: number;
  timelineRef: RefObject<HTMLElement | null>;
  customVariants?: Variants;
  as?: string;
  className?: string;
  [key: string]: any;
}

export function TimelineContent({
  children,
  animationNum,
  timelineRef,
  customVariants,
  as: Component = "div",
  className,
  ...props
}: TimelineContentProps) {
  const [hasAnimated, setHasAnimated] = useState(false);
  const isInView = useInView(timelineRef as RefObject<HTMLElement>, { once: true, amount: 0.3 });

  useEffect(() => {
    if (isInView && !hasAnimated) {
      setHasAnimated(true);
    }
  }, [isInView, hasAnimated]);

  const defaultVariants: Variants = {
    visible: (i: number) => ({
      y: 0,
      opacity: 1,
      filter: "blur(0px)",
      transition: {
        delay: i * 0.4,
        duration: 0.5,
      },
    }),
    hidden: {
      filter: "blur(10px)",
      y: -20,
      opacity: 0,
    },
  };

  const variants = customVariants || defaultVariants;

  return (
    <motion.div
      custom={animationNum}
      initial="hidden"
      animate={hasAnimated ? "visible" : "hidden"}
      variants={variants}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}
