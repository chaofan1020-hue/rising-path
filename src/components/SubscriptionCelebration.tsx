'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { X } from 'lucide-react';

const Lanyard3D = dynamic(() => import('@/components/Lanyard'), { ssr: false });

export interface SubscriptionCelebrationProps {
  userName?: string;
  planName?: string;
  open?: boolean;
  autoShow?: boolean;
  onClose?: () => void;
}

export default function SubscriptionCelebration({
  userName = '',
  planName = 'Pro',
  open: externalOpen,
  autoShow = true,
  onClose,
}: SubscriptionCelebrationProps) {
  const [internalOpen, setInternalOpen] = useState(autoShow);
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = externalOpen !== undefined ? (v: boolean) => onClose?.() : setInternalOpen;

  useEffect(() => {
    if (autoShow && externalOpen === undefined) {
      const timer = setTimeout(() => setInternalOpen(true), 500);
      return () => clearTimeout(timer);
    }
  }, [autoShow, externalOpen]);

  const handleClose = () => {
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="relative w-[90vw] max-w-[480px] h-[600px] mx-auto">
        {/* 3D Lanyard */}
        <div className="absolute inset-0">
          <Lanyard3D position={[0, 0, 20]} gravity={[0, -40, 0]} />
        </div>

        {/* 关闭按钮 */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 z-10 rounded-full bg-white/10 p-2 text-white/70 hover:bg-white/20 hover:text-white transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        {/* 文字叠加 */}
        <div className="absolute bottom-12 left-0 right-0 z-10 text-center px-6">
          <div className="inline-block rounded-full bg-white/10 backdrop-blur-md px-4 py-1 mb-3">
            <span className="text-xs font-medium text-white/80 uppercase tracking-wider">
              {planName}
            </span>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">
            🎉 订阅成功！
          </h2>
          {userName && (
            <p className="text-white/70 text-sm">
              {userName}，欢迎加入 Rising Path {planName} 计划
            </p>
          )}
          <p className="text-white/50 text-xs mt-2">
            你的工牌已生成，开始你的求职之旅吧
          </p>
        </div>
      </div>
    </div>
  );
}