'use client';

import { MapPin, Crosshair, Rocket } from 'lucide-react';

const iconMap = {
  MapPin,
  Crosshair,
  Rocket,
};

interface ScrollCardProps {
  iconName: string;
  title: string;
  description: string;
  iconColor: string;
  scrollTo?: string;
}

export function ScrollCard({ 
  iconName, 
  title, 
  description, 
  iconColor,
  scrollTo 
}: ScrollCardProps) {
  const Icon = iconMap[iconName as keyof typeof iconMap];
  
  const handleClick = () => {
    if (scrollTo) {
      const element = document.getElementById(scrollTo);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  if (!Icon) return null;

  return (
    <div
      className="group cursor-pointer"
      onClick={handleClick}
    >
      <div className="relative p-6 md:p-12 rounded-2xl md:rounded-[32px] bg-neutral-950 text-white overflow-hidden hover:-translate-y-1 md:hover:-translate-y-3 transition-all duration-500">
        <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 ${iconColor === 'text-sky-600' ? 'bg-gradient-to-br from-blue-500/30 via-blue-600/10 to-transparent' : iconColor === 'text-violet-600' ? 'bg-gradient-to-br from-purple-500/30 via-purple-600/10 to-transparent' : 'bg-gradient-to-br from-orange-500/30 via-orange-600/10 to-transparent'}`} />
        <div className="relative mb-4 md:mb-10">
          <div className="w-10 h-10 md:w-14 md:h-14 rounded-full border border-white/20 flex items-center justify-center group-hover:border-white/60 group-hover:bg-white/10 transition-all duration-300">
            <Icon className="h-5 w-5 md:h-7 md:w-7 text-white/80 group-hover:text-white transition-colors" />
          </div>
        </div>
        <h3 className="relative font-semibold text-lg md:text-2xl mb-2 md:mb-4 tracking-tight">{title}</h3>
        <p className="relative text-white/50 text-sm md:text-base leading-relaxed font-light">{description}</p>
        <div className={`absolute bottom-0 left-0 right-0 h-px ${iconColor === 'text-sky-600' ? 'bg-gradient-to-r from-transparent via-blue-400 to-transparent' : iconColor === 'text-violet-600' ? 'bg-gradient-to-r from-transparent via-purple-400 to-transparent' : 'bg-gradient-to-r from-transparent via-orange-400 to-transparent'} opacity-50 group-hover:opacity-100 transition-opacity duration-300`} />
      </div>
    </div>
  );
}

