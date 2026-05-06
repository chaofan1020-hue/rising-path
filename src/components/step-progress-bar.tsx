'use client';

import Link from 'next/link';
import {
  FileText,
  Brain,
  CheckCircle,
  Send,
  Mail,
  ArrowRight,
} from 'lucide-react';

const steps = [
  { key: 'resume', label: '提供简历', icon: FileText, href: '/resume' },
  { key: 'match', label: 'AI选岗', icon: Brain, href: '/ai-match' },
  { key: 'confirm', label: '确认岗位', icon: CheckCircle, href: '/confirm' },
  { key: 'submit', label: '投递', icon: Send, href: '/submit' },
  { key: 'receipt', label: '回执', icon: Mail, href: '/applications' },
];

interface StepProgressBarProps {
  currentStep: number;
}

export function StepProgressBar({ currentStep }: StepProgressBarProps) {
  const currentIndex = currentStep - 1; // 1-based to 0-based

  return (
    <div className="flex items-center justify-center gap-1 md:gap-2 overflow-x-auto py-1">
      {steps.map((step, index) => {
        const isCompleted = index < currentIndex;
        const isCurrent = index === currentIndex;
        const Icon = step.icon;

        return (
          <div key={step.key} className="flex items-center">
            <Link
              href={isCompleted || isCurrent ? step.href : '#'}
              className={`flex items-center gap-1 md:gap-1.5 px-2 md:px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-all whitespace-nowrap ${
                isCurrent
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : isCompleted
                  ? 'text-primary hover:bg-primary/5 cursor-pointer'
                  : 'text-muted-foreground cursor-default'
              }`}
              onClick={(e) => {
                if (!isCompleted && !isCurrent) e.preventDefault();
              }}
            >
              <div className={`flex items-center justify-center w-5 h-5 md:w-6 md:h-6 rounded-full text-[10px] md:text-xs font-bold ${
                isCurrent
                  ? 'bg-primary-foreground/20 text-primary-foreground'
                  : isCompleted
                  ? 'bg-primary/10 text-primary'
                  : 'bg-muted text-muted-foreground'
              }`}>
                {isCompleted ? (
                  <svg className="w-3 h-3 md:w-3.5 md:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  index + 1
                )}
              </div>
              <Icon className="h-3.5 w-3.5 md:h-4 md:w-4 hidden sm:block" />
              <span className="hidden md:inline">{step.label}</span>
              <span className="md:hidden">{step.label.slice(0, 2)}</span>
            </Link>

            {/* Connector arrow */}
            {index < steps.length - 1 && (
              <ArrowRight className={`h-3 w-3 md:h-4 md:w-4 mx-0.5 md:mx-1 flex-shrink-0 ${
                index < currentIndex ? 'text-primary' : 'text-muted-foreground/40'
              }`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
