'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

const Lanyard3D = dynamic(() => import('@/components/Lanyard'), { ssr: false });

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
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = externalOpen !== undefined ? (v: boolean) => onClose?.() : setInternalOpen;

  useEffect(() => {
    if (autoShow && externalOpen === undefined) {
      const timer = setTimeout(() => setInternalOpen(true), 500);
      return () => clearTimeout(timer);
    }
  }, [autoShow, externalOpen]);

  useEffect(() => {
    if (open) {
      // 先淡入遮罩，再触发掉落
      const t = setTimeout(() => setVisible(true), 100);
      return () => clearTimeout(t);
    } else {
      setVisible(false);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm animate-in fade-in duration-500"
      onClick={() => setOpen(false)}
    >
      {/* 3D Lanyard - 全屏，工牌从顶部掉落 */}
      <div className="absolute inset-0">
        <Lanyard3D
          position={[0, 7, 0]}
          gravity={[0, -10, 0]}
          cameraPosition={[0, 0, 15]}
          cameraFov={45}
          cardStartY={0}
        />
      </div>

      {/* 文字叠加 - 底部 */}
      <div className="absolute bottom-[18%] left-0 right-0 z-10 text-center px-6 pointer-events-none">
        <div className={`transition-all duration-700 delay-500 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
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
          <p className="text-white/30 text-xs mt-6">
            点击任意位置关闭
          </p>
        </div>
      </div>
    </div>
  );
}