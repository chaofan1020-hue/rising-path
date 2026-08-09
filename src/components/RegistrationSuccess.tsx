'use client';

import dynamic from 'next/dynamic';

const Lanyard = dynamic(() => import('@/components/Lanyard'), { ssr: false });

export default function RegistrationSuccess({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm">
      <div className="absolute inset-0">
        <Lanyard position={[0, 0, 20]} gravity={[0, -40, 0]} />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-[17%] z-10 px-6 text-center text-white">
        <h2 className="text-3xl font-bold">注册成功</h2>
        <p className="mt-2 text-sm text-white/65">欢迎加入 Rising Path</p>
      </div>
      <div className="absolute inset-x-0 bottom-8 z-10 flex justify-center">
        <button
          type="button"
          onClick={onContinue}
          className="rounded-full bg-white/15 px-8 py-2.5 text-sm font-medium text-white backdrop-blur-md transition-colors hover:bg-white/25"
        >
          关闭测试
        </button>
      </div>
    </div>
  );
}
