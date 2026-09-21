'use client';

import * as React from 'react';
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from 'framer-motion';
import { cn } from '@/lib/utils';

export type HaloReelItem = {
  src?: string;
  alt?: string;
  icon?: React.ReactNode;
  bgColor?: string;
  textColor?: string;
  title?: string;
  subtitle?: string;
};

export interface HaloReelProps extends Omit<React.ComponentPropsWithoutRef<'div'>, 'children'> {
  items: HaloReelItem[];
  cardWidth?: number;
  cardHeight?: number;
  minScale?: number;
  radiusXRatio?: number;
  centerXRatio?: number;
  radiusYRatio?: number;
  autoPlay?: boolean;
  holdDuration?: number;
  stepDuration?: number;
  pauseOnHover?: boolean;
  draggable?: boolean;
  spread?: number;
  maxCards?: number;
  dragSensitivity?: number;
  centerLabel?: React.ReactNode;
  showCenterLabel?: boolean;
}

const TAU = Math.PI * 2;
const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));

export function HaloReel({
  items,
  cardWidth = 130,
  cardHeight = 180,
  minScale = 0.4,
  radiusXRatio = 0.45,
  centerXRatio = 0,
  radiusYRatio = 0.36,
  autoPlay = true,
  holdDuration = 1000,
  stepDuration = 700,
  pauseOnHover = true,
  draggable = true,
  spread = 1.2,
  maxCards = 64,
  dragSensitivity = 1,
  centerLabel,
  showCenterLabel = true,
  className,
  style,
  ...props
}: HaloReelProps) {
  const stageRef = React.useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const count = items.length;
  const rotation = useMotionValue(0);
  const draggingRef = React.useRef(false);
  const hoverRef = React.useRef(false);

  const [size, setSize] = React.useState({ w: 0, h: 0 });

  React.useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const measure = () => setSize({ w: node.offsetWidth, h: node.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const radiusX = size.w * radiusXRatio;
  const radiusY = size.h * radiusYRatio;

  const slots = clamp(
    Math.ceil(TAU * Math.max(radiusX / (cardWidth * spread), radiusY / (cardHeight * spread))),
    count,
    Math.max(count, maxCards),
  );
  const step = slots ? TAU / slots : 0;

  const fit = size.w
    ? clamp(Math.min(size.w / (radiusX + cardWidth), size.h / (2 * radiusY + cardHeight)), 0.45, 1)
    : 1;
  const cardW = cardWidth * fit;
  const cardH = cardHeight * fit;

  React.useEffect(() => {
    if (!autoPlay || reduceMotion || !count) return;

    let timer = 0;
    let controls: ReturnType<typeof animate> | undefined;

    const tick = () => {
      timer = window.setTimeout(() => {
        if (draggingRef.current || (pauseOnHover && hoverRef.current)) {
          tick();
          return;
        }
        controls = animate(rotation, rotation.get() - step, {
          duration: stepDuration / 1000,
          ease: [0.4, 0, 0.2, 1],
          onComplete: tick,
        });
      }, holdDuration);
    };

    tick();
    return () => {
      window.clearTimeout(timer);
      controls?.stop();
    };
  }, [autoPlay, count, holdDuration, pauseOnHover, reduceMotion, rotation, step, stepDuration]);

  const dragRef = React.useRef({ left: 0, top: 0, angle: 0 });

  const pointerAngle = (event: React.PointerEvent) => {
    const { left, top } = dragRef.current;
    return Math.atan2(
      (event.clientY - top - size.h / 2) / (radiusY || 1),
      (event.clientX - left - size.w * centerXRatio) / (radiusX || 1),
    );
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggable || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = { left: rect.left, top: rect.top, angle: pointerAngle(event) };
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const angle = pointerAngle(event);
    const delta = ((angle - dragRef.current.angle + Math.PI * 3) % TAU) - Math.PI;
    dragRef.current.angle = angle;
    rotation.set(rotation.get() + delta * dragSensitivity);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const snapped = Math.round(rotation.get() / step) * step;
    if (reduceMotion) {
      rotation.set(snapped);
      return;
    }
    animate(rotation, snapped, { duration: 0.5, ease: [0.16, 1, 0.3, 1] });
  };

  const spinBy = (direction: number) => {
    const target = Math.round(rotation.get() / step) * step - direction * step;
    if (reduceMotion) {
      rotation.set(target);
      return;
    }
    animate(rotation, target, { duration: stepDuration / 1000, ease: [0.4, 0, 0.2, 1] });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const direction = { ArrowRight: 1, ArrowLeft: -1 }[event.key as 'ArrowRight' | 'ArrowLeft'];
    if (!direction) return;
    event.preventDefault();
    spinBy(direction);
  };

  // 槽位数对图片数余 1 时，最后一个槽位会与第一个槽位相邻同图，错开一位避免
  const slotItemIndexes = React.useMemo(() => {
    const indexes: number[] = [];
    for (let slot = 0; slot < slots; slot++) {
      const base = slot % count;
      const isSeamClash = slots % count === 1 && slot === slots - 1;
      indexes.push(isSeamClash && count > 1 ? (base + 1) % count : base);
    }
    return indexes;
  }, [slots, count]);

  if (!count) return null;

  return (
    <div
      ref={stageRef}
      role="region"
      aria-roledescription="carousel"
      aria-label={props['aria-label'] ?? 'Image carousel'}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={cn(
        'relative h-[100dvh] w-full touch-pan-y select-none overflow-hidden outline-none',
        draggable && 'cursor-grab active:cursor-grabbing',
        'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        className,
      )}
      style={style}
      {...props}
    >
      {showCenterLabel && centerLabel ? (
        <div
          className="pointer-events-none absolute inset-y-0 z-0 flex items-center justify-center px-4 text-center"
          style={{ left: size.w * centerXRatio + radiusX + cardW / 2, right: 0 }}
        >
          {centerLabel}
        </div>
      ) : null}

      {Array.from({ length: slots }, (_, index) => (
        <WheelCard
          key={index}
          item={items[slotItemIndexes[index] ?? 0]}
          decorative={index >= count}
          index={index}
          step={step}
          rotation={rotation}
          radiusX={radiusX}
          radiusY={radiusY}
          centerXRatio={centerXRatio}
          minScale={minScale}
          width={cardW}
          height={cardH}
          onHoverChange={(hovered) => {
            hoverRef.current = hovered;
          }}
        />
      ))}
    </div>
  );
}

function WheelCard({
  item,
  index,
  step,
  rotation,
  radiusX,
  radiusY,
  centerXRatio,
  minScale,
  width,
  height,
  decorative,
  onHoverChange,
}: {
  item: HaloReelItem;
  index: number;
  step: number;
  rotation: MotionValue<number>;
  radiusX: number;
  radiusY: number;
  centerXRatio: number;
  minScale: number;
  width: number;
  height: number;
  decorative: boolean;
  onHoverChange: (hovered: boolean) => void;
}) {
  const cos = useTransform(rotation, (value) => Math.cos(index * step + value));
  const sin = useTransform(rotation, (value) => Math.sin(index * step + value));
  const x = useTransform(cos, (value) => value * radiusX);
  const y = useTransform(sin, (value) => value * radiusY);
  const scale = useTransform(cos, (value) => minScale + (1 - minScale) * ((value + 1) / 2));
  // 卡片层级必须低于固定顶部导航栏（z-40/z-50），否则前排卡片会盖住导航
  const zIndex = useTransform(scale, (value) => Math.round(value * 30));

  return (
    <motion.div
      suppressHydrationWarning
      role={decorative ? undefined : 'group'}
      aria-roledescription={decorative ? undefined : 'slide'}
      aria-hidden={decorative || undefined}
      onPointerEnter={() => onHoverChange(true)}
      onPointerLeave={() => onHoverChange(false)}
      style={{
        x,
        y,
        scale,
        zIndex,
        width,
        height,
        left: `${centerXRatio * 100}%`,
        top: '50%',
        marginLeft: -width / 2,
        marginTop: -height / 2,
      }}
      className="absolute overflow-hidden shadow-xl"
    >
      {item.icon ? (
        <div className="flex h-full w-full items-center justify-center bg-white p-3">{item.icon}</div>
      ) : item.src ? (
        <img
          src={item.src}
          alt={decorative ? '' : (item.alt ?? '')}
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
        />
      ) : (
        <div
          className="flex h-full w-full flex-col items-center justify-center gap-1 bg-card p-3 text-center text-card-foreground"
          style={{ backgroundColor: item.bgColor, color: item.textColor }}
        >
          {item.title && <span className="text-2xl font-black leading-none">{item.title}</span>}
          {item.subtitle && (
            <span className="text-[0.6rem] uppercase tracking-[0.2em] opacity-70">{item.subtitle}</span>
          )}
        </div>
      )}
    </motion.div>
  );
}

export default HaloReel;
