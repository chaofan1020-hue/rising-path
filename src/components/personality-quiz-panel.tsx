'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { apiFetch } from '@/lib/api-client';
import { useLanguage } from '@/lib/language-context';
import {
  getRandomPersonalityQuestions,
  type PersonalityAnswer,
  type PersonalityAssessment,
  type PersonalityDimension,
  type PersonalityQuestion,
} from '@/lib/personality-assessment';
import type { ResumeProfile } from '@/lib/resume-types';
import {
  ArrowRight,
  Brain,
  Compass,
  Loader2,
  RefreshCw,
  Target,
} from 'lucide-react';

const DIMENSION_ORDER: PersonalityDimension[] = [
  'analytical',
  'creative',
  'people',
  'execution',
  'risk',
];

interface PersonalityQuizPanelProps {
  resumeId: number;
  assessment: PersonalityAssessment | null;
  autoStart?: boolean;
  showRecommendations?: boolean;
  onCompleted: (assessment: PersonalityAssessment, profile: ResumeProfile | null) => void;
  onSkip?: () => void;
}

export function PersonalityQuizPanel({
  resumeId,
  assessment,
  autoStart = false,
  showRecommendations = true,
  onCompleted,
  onSkip,
}: PersonalityQuizPanelProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(autoStart && !assessment);
  const [questions, setQuestions] = useState<PersonalityQuestion[]>(() => getRandomPersonalityQuestions());
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const closeWizard = () => {
    setOpen(false);
    setAnswers({});
    setCurrentIndex(0);
    setError('');
    onSkip?.();
  };

  const startQuiz = () => {
    setQuestions(getRandomPersonalityQuestions());
    setAnswers({});
    setCurrentIndex(0);
    setError('');
    setOpen(true);
  };

  const handleSubmit = async (answersOverride?: Record<string, number>) => {
    const submittedAnswers = answersOverride || answers;
    if (Object.keys(submittedAnswers).length < questions.length) {
      setError(t('personality.incomplete'));
      return;
    }
    setSubmitting(true);
    setError('');
    const payload: PersonalityAnswer[] = questions.map((question) => ({
      questionId: question.id,
      score: submittedAnswers[question.id] as PersonalityAnswer['score'],
    }));
    try {
      const response = await apiFetch('/api/personality/assessment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeId, answers: payload }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('personality.saveError'));
      onCompleted(data.assessment, data.profile || null);
      setOpen(false);
      setAnswers({});
      setCurrentIndex(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('personality.saveError'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open && assessment) {
    return (
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3 md:p-4">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900">
              <Compass className="h-3.5 w-3.5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {t(assessment.result.summaryKey)}
              </p>
              <p className="text-xs text-zinc-500">{t('resume.personalityDone')}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={startQuiz}
          >
            <RefreshCw className="mr-1 h-3 w-3" />
            {t('personality.retake')}
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 mb-4">
          {DIMENSION_ORDER.map((dimension) => (
            <div key={dimension}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-zinc-500">{t(`personality.dimension.${dimension}`)}</span>
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  {assessment.result.dimensions[dimension]}
                </span>
              </div>
              <Progress value={assessment.result.dimensions[dimension]} className="h-1.5" />
            </div>
          ))}
        </div>

        {showRecommendations !== false && (() => {
          const core = (assessment.recommendations || []).slice(0, 3);
          const alternatives = (assessment.recommendations || []).slice(3, 5);
          const renderCard = (recommendation: typeof core[number]) => (
            <div key={recommendation.roleKey} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {t(recommendation.labelKey)}
                </p>
                <Badge variant="secondary" className="text-[10px]">
                  {t(`personality.fit.${recommendation.fit}`)}
                </Badge>
              </div>
              <p className="text-xs text-zinc-400 mb-2">{recommendation.score}%</p>
              <ul className="space-y-1">
                {recommendation.reasons.map((reason) => (
                  <li key={reason} className="text-xs text-zinc-500 leading-relaxed">
                    {t(reason)}
                  </li>
                ))}
              </ul>
              {recommendation.sponsorship && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="text-[10px]">
                    {t(`personality.sponsor.${recommendation.sponsorship.level}`)}
                  </Badge>
                  {recommendation.sponsorship.activeJobCount > 0 && (
                    <span className="text-[10px] text-zinc-400">
                      {recommendation.sponsorship.sponsorJobCount} / {recommendation.sponsorship.activeJobCount}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
          return (
            <>
              <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-2">
                {t('personality.recommendationsCore')}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {core.map(renderCard)}
              </div>
              {alternatives.length > 0 && (
                <>
                  <p className="mt-4 text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-2">
                    {t('personality.recommendationsAlternatives')}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {alternatives.map(renderCard)}
                  </div>
                </>
              )}
            </>
          );
        })()}

        <Link href="/dashboard" className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-zinc-900 dark:text-zinc-100 hover:underline">
          {t(showRecommendations === false ? 'personality.viewDirections' : 'personality.backDashboard')}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </section>
    );
  }

  if (!open) {
    return (
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3 md:p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 flex-shrink-0">
              <Brain className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {t('resume.personalityEmpty')}
              </p>
              <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                {t('resume.personalityHint')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {onSkip && (
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onSkip}>
                {t('personality.skip')}
              </Button>
            )}
            <Button size="sm" className="h-8" onClick={startQuiz}>
              {t('resume.personalityStart')}
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3 md:p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900">
            <Brain className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {t('personality.assessmentProgress')}
          </span>
        </div>
        <Badge variant="secondary" className="text-xs">
          {currentIndex + 1} / {questions.length}
        </Badge>
        {submitting && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
      </div>
      <div className="mb-4 flex justify-end">
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={closeWizard} disabled={submitting}>
          {t('personality.skip')}
        </Button>
      </div>

      <Progress
        value={(Object.keys(answers).length / questions.length) * 100}
        className="h-2 mb-6"
      />

      <h3 className="text-base md:text-lg font-semibold text-zinc-900 dark:text-zinc-50 mb-6 leading-relaxed min-h-[4.5rem]">
        {t(questions[currentIndex].textKey)}
      </h3>

      <div className="grid grid-cols-5 gap-2 mb-6">
        {[1, 2, 3, 4, 5].map((score) => {
          const questionId = questions[currentIndex].id;
          const selected = answers[questionId] === score;
          return (
            <Button
              key={score}
              type="button"
              variant={selected ? 'default' : 'outline'}
              size="sm"
              className={`h-11 text-xs ${selected ? 'bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900' : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
              onClick={() => {
                const nextAnswers = { ...answers, [questionId]: score };
                setAnswers(nextAnswers);
          if (currentIndex < questions.length - 1) {
                  setCurrentIndex(currentIndex + 1);
                } else {
                  void handleSubmit(nextAnswers);
                }
              }}
              disabled={submitting}
            >
              {score}
            </Button>
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-zinc-400 mb-6">
        <span>{t('personality.scaleLow')}</span>
        <span>{t('personality.scaleHigh')}</span>
      </div>

      {error && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 dark:bg-primary/15">
          <p className="text-xs text-foreground">{t('personality.failed')}</p>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={submitting}
            onClick={() => void handleSubmit()}
          >
            {t('personality.retry')}
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={currentIndex === 0 || submitting}
          onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
        >
          {t('personality.previous')}
        </Button>
      </div>
    </section>
  );
}
