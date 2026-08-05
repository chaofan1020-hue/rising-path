'use client';

import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';

const Lanyard3D = dynamic(() => import('@/components/Lanyard'), { ssr: false });

const MIN_DISPLAY_MS = 3000;

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
  const [hasError, setHasError] = useState(false);
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
      setHasError(false);
      // Enable close button after min display time — no auto-close
      const enableTimer = setTimeout(() => setCanClose(true), MIN_DISPLAY_MS);
      return () => {
        clearTimeout(enableTimer);
      };
    } else {
      setVisible(false);
      setCanClose(false);
    }
  }, [open]);

  const handleClose = useCallback(() => {
    if (!canClose) return;
    setOpen(false);
  }, [canClose, setOpen]);

  const handleLanyardError = useCallback(() => {
    setHasError(true);
    // Auto-close on error after a short delay
    setTimeout(() => setOpen(false), 1500);
  }, [setOpen]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm animate-in fade-in duration-700"
    >
      {/* 3D Lanyard */}
      <div className="absolute inset-0">
        {!hasError && (
          <Lanyard3D
            position={[0, 2.5, 0]}
            gravity={[0, -50, 0]}
            cameraPosition={[0, 0.5, 13]}
            cameraFov={25}
            cardStartY={0}
            onError={handleLanyardError}
          />
        )}
      </div>

      {/* Error fallback */}
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="w-20 h-20 rounded-2xl bg-white/10 mx-auto mb-6 flex items-center justify-center">
              <svg viewBox="0 0 40 20" fill="currentColor" className="w-10 h-5 text-white">
                <path d="M0 0h29a4 4 0 0 1 0 8H0V0z" />
                <path d="M40 20H11a4 4 0 0 1 0-8h29v8z" />
              </svg>
            </div>
            <h2 className="text-3xl font-bold text-white mb-3">订阅成功！</h2>
            <p className="text-white/50 text-sm">欢迎加入 Rising Path</p>
          </div>
        </div>
      )}

      {/* Text overlay */}
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

      {/* Close button */}
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