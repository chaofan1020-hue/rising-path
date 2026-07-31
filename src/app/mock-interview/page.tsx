'use client';

import { useState } from 'react';
import { Header1 } from '@/components/header1';
import { AccessGuard } from '@/components/access-guard';
import { useLanguage } from '@/lib/language-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { MessageSquare, Send, RotateCcw, CheckCircle } from 'lucide-react';

export default function MockInterviewPage() {
  const { t } = useLanguage();
  const [interviewType, setInterviewType] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [isInterviewing, setIsInterviewing] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [userAnswer, setUserAnswer] = useState('');
  const [feedback, setFeedback] = useState('');
  const [questionHistory, setQuestionHistory] = useState<Array<{question: string, answer: string, feedback: string}>>([]);

  const handleStartInterview = () => {
    if (!interviewType || !jobDescription) return;
    setIsInterviewing(true);
    // TODO: 调用 AI 生成第一个问题
    setCurrentQuestion('请简单介绍一下你自己，以及为什么对这个岗位感兴趣？');
  };

  const handleSubmitAnswer = () => {
    if (!userAnswer.trim()) return;
    // TODO: 调用 AI 评估答案并生成反馈
    setFeedback('这是一个很好的回答！你提到了相关的经验和技能。建议可以更具体地说明你在项目中的贡献。');
    setQuestionHistory([...questionHistory, { question: currentQuestion, answer: userAnswer, feedback: '这是一个很好的回答！' }]);
    setUserAnswer('');
  };

  const handleNextQuestion = () => {
    setFeedback('');
    // TODO: 调用 AI 生成下一个问题
    setCurrentQuestion('描述一个你遇到过的技术挑战，你是如何解决的？');
  };

  const handleEndInterview = () => {
    setIsInterviewing(false);
    setCurrentQuestion('');
    setUserAnswer('');
    setFeedback('');
    setQuestionHistory([]);
  };

  return (
    <AccessGuard>
      <div className="min-h-screen bg-background">
        <Header1 />
        <div className="pt-20 container mx-auto px-4 py-8">
          <div className="max-w-4xl mx-auto">
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                {t('mockInterview.title')}
              </h1>
              <p className="text-gray-500 dark:text-gray-400">
                {t('mockInterview.description')}
              </p>
            </div>

            {!isInterviewing ? (
              <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
                <CardHeader>
                  <CardTitle className="text-gray-900 dark:text-white">{t('mockInterview.setup')}</CardTitle>
                  <CardDescription className="text-gray-500 dark:text-gray-400">
                    {t('mockInterview.setupDescription')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label className="text-gray-900 dark:text-white">{t('mockInterview.interviewType')}</Label>
                    <Select value={interviewType} onValueChange={setInterviewType}>
                      <SelectTrigger className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white">
                        <SelectValue placeholder={t('mockInterview.selectType')} />
                      </SelectTrigger>
                      <SelectContent className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
                        <SelectItem value="technical">{t('mockInterview.technical')}</SelectItem>
                        <SelectItem value="behavioral">{t('mockInterview.behavioral')}</SelectItem>
                        <SelectItem value="case">{t('mockInterview.case')}</SelectItem>
                        <SelectItem value="mixed">{t('mockInterview.mixed')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-gray-900 dark:text-white">{t('mockInterview.jobDescription')}</Label>
                    <Textarea
                      value={jobDescription}
                      onChange={(e) => setJobDescription(e.target.value)}
                      placeholder={t('mockInterview.jobDescriptionPlaceholder')}
                      className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white min-h-[120px]"
                    />
                  </div>

                  <Button
                    onClick={handleStartInterview}
                    disabled={!interviewType || !jobDescription}
                    className="w-full"
                  >
                    <MessageSquare className="mr-2 h-4 w-4" />
                    {t('mockInterview.startInterview')}
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                {/* Current Question */}
                <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
                  <CardHeader>
                    <CardTitle className="text-gray-900 dark:text-white flex items-center gap-2">
                      <MessageSquare className="h-5 w-5" />
                      {t('mockInterview.currentQuestion')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-lg text-gray-700 dark:text-gray-300 mb-4">{currentQuestion}</p>
                    <Textarea
                      value={userAnswer}
                      onChange={(e) => setUserAnswer(e.target.value)}
                      placeholder={t('mockInterview.answerPlaceholder')}
                      className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white min-h-[120px] mb-4"
                    />
                    <div className="flex gap-3">
                      <Button onClick={handleSubmitAnswer} disabled={!userAnswer.trim()}>
                        <Send className="mr-2 h-4 w-4" />
                        {t('mockInterview.submitAnswer')}
                      </Button>
                      <Button variant="outline" onClick={handleEndInterview}>
                        {t('mockInterview.endInterview')}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Feedback */}
                {feedback && (
                  <Card className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
                    <CardHeader>
                      <CardTitle className="text-green-900 dark:text-green-100 flex items-center gap-2">
                        <CheckCircle className="h-5 w-5" />
                        {t('mockInterview.feedback')}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-green-800 dark:text-green-200">{feedback}</p>
                      <Button onClick={handleNextQuestion} className="mt-4">
                        <RotateCcw className="mr-2 h-4 w-4" />
                        {t('mockInterview.nextQuestion')}
                      </Button>
                    </CardContent>
                  </Card>
                )}

                {/* Question History */}
                {questionHistory.length > 0 && (
                  <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
                    <CardHeader>
                      <CardTitle className="text-gray-900 dark:text-white">{t('mockInterview.history')}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {questionHistory.map((item, index) => (
                        <div key={index} className="border-b border-gray-200 dark:border-gray-700 pb-4 last:border-0">
                          <p className="font-medium text-gray-900 dark:text-white mb-2">Q{index + 1}: {item.question}</p>
                          <p className="text-gray-600 dark:text-gray-400 text-sm mb-2">A: {item.answer}</p>
                          <p className="text-green-600 dark:text-green-400 text-sm">✓ {item.feedback}</p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </AccessGuard>
  );
}
