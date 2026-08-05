'use client';

import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';

const Lanyard3D = dynamic(() => import('@/components/Lanyard'), { ssr: false });

const MIN_DISPLAY_MS = 4000;

export default function SubscriptionCelebration({
  open: externalOpen,
  autoShow = true,
  onClose,
}: {
  open?: boolean;
  autoShow?: boolean;
  onClose?: () => void;
}) {
  const [internalOpen, setInternalOpen] = useState(autoShow);
  const [visible, setVisible] = useState(false);
  const [canClose, setCanClose] = useState(false);
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = externalOpen !== undefined
    ? (v: boolean) => { if (!v) onClose?.(); }
    : setInternalOpen;

  useEffect(() => {
    if (autoShow && externalOpen === undefined) {
      const timer = setTimeout(() => setInternalOpen(true), 500);
      return () => clearTimeout(timer);
    }
  }, [autoShow, externalOpen]);

  useEffect(() => {
    if (open) {
      setVisible(true);
      setCanClose(false);
      const timer = setTimeout(() => setCanClose(true), MIN_DISPLAY_MS);
      return () => clearTimeout(timer);
    } else {
      setVisible(false);
      setCanClose(false);
    }
  }, [open]);

  const handleClose = useCallback(() => {
    if (!canClose) return;
    setOpen(false);
  }, [canClose, setOpen]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm animate-in fade-in duration-700"
    >
      {/* 3D Lanyard - 全屏，工牌从顶部掉落 */}
      <div className="absolute inset-0">
        <Lanyard3D
          position={[0, 2.5, 0]}
          gravity={[0, -2, 0]}
          cameraPosition={[0, 0.5, 10]}
          cameraFov={35}
          cardStartY={0}
        />
      </div>

      {/* 文字叠加 - 底部 */}
      <div className="absolute bottom-[18%] left-0 right-0 z-10 text-center px-6 pointer-events-none">
        <div className={`transition-all duration-700 delay-1000 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          <div className="inline-block rounded-full bg-white/10 backdrop-blur-md px-5 py-1.5 mb-4">
            <span className="text-xs font-medium text-white/80 uppercase tracking-widest">
              Pro
            </span>
          </div>
          <h2 className="text-4xl font-bold text-white mb-3 tracking-tight">
            订阅成功！
          </h2>
          <p className="text-white/50 text-sm max-w-xs mx-auto">
            你的专属工牌已生成，开启你的求职之旅
          </p>
        </div>
      </div>

      {/* 关闭按钮 - 延迟出现 */}
      <div className="absolute bottom-8 left-0 right-0 z-10 flex justify-center pointer-events-none">
        <button
          onClick={handleClose}
          disabled={!canClose}
          className={`pointer-events-auto px-8 py-2.5 rounded-full text-sm font-medium transition-all duration-500 ${
            canClose
              ? 'bg-white/10 text-white hover:bg-white/20 backdrop-blur-md opacity-100'
              : 'bg-white/5 text-white/30 opacity-0'
          }`}
        >
          {canClose ? '开始使用' : '请稍候...'}
        </button>
      </div>
    </div>
  );
}