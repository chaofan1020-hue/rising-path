"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

interface VerticalCutRevealProps {
  children: string;
  splitBy?: "words" | "characters";
  staggerDuration?: number;
  staggerFrom?: "first" | "last" | "center";
  reverse?: boolean;
  transition?: any;
}

export function VerticalCutReveal({
  children,
  splitBy = "words",
  staggerDuration = 0.1,
  staggerFrom = "first",
  reverse = false,
  transition = {},
}: VerticalCutRevealProps) {
  const [items, setItems] = useState<string[]>([]);

  useEffect(() => {
    if (splitBy === "words") {
      setItems(children.split(" "));
    } else {
      setItems(children.split(""));
    }
  }, [children, splitBy]);

  const getStaggerDelay = (index: number) => {
    if (reverse) {
      return (items.length - 1 - index) * staggerDuration;
    }
    if (staggerFrom === "center") {
      const center = Math.floor(items.length / 2);
      return Math.abs(index - center) * staggerDuration;
    }
    if (staggerFrom === "last") {
      return (items.length - 1 - index) * staggerDuration;
    }
    return index * staggerDuration;
  };

  return (
    <span className="inline-block">
      {items.map((item, index) => (
        <motion.span
          key={index}
          className="inline-block overflow-hidden"
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{
            ...transition,
            delay: getStaggerDelay(index),
          }}
        >
          <motion.span
            className="inline-block"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            transition={{
              ...transition,
              delay: getStaggerDelay(index),
            }}
          >
            {item}
            {index < items.length - 1 && splitBy === "words" ? " " : ""}
          </motion.span>
        </motion.span>
      ))}
    </span>
  );
}
