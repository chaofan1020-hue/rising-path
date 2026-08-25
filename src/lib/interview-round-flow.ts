export type InterviewTurnAction = 'continue' | 'round_end' | 'session_complete';

export function decideInterviewTurnAction({
  isTimeout,
  isLastRound,
  answersThisRound,
  questionQuota,
}: {
  isTimeout: boolean;
  isLastRound: boolean;
  answersThisRound: number;
  questionQuota: number;
}): InterviewTurnAction {
  if (isTimeout || answersThisRound >= questionQuota) {
    return isLastRound ? 'session_complete' : 'round_end';
  }
  return 'continue';
}

/**
 * Round boundaries are deterministic. Letting a streamed model response
 * contain a last question while the state already advances orphaned that
 * question under the next interviewer.
 */
export function buildInterviewRoundClosing({
  language,
  action,
  timedOut,
  earlyExit = false,
}: {
  language: 'zh' | 'en';
  action: Exclude<InterviewTurnAction, 'continue'>;
  timedOut: boolean;
  earlyExit?: boolean;
}): string {
  if (language === 'en') {
    if (action === 'session_complete') {
      if (earlyExit) {
        return 'Thank you for your time today. Based on our conversation, we will conclude the interview here. We will follow up with the result.';
      }
      return timedOut
        ? 'Time is up, so we will conclude the interview here. Thank you for your time today.'
        : 'Thank you for your answers. That concludes today\'s interview.';
    }
    return timedOut
      ? 'Time is up for this round. We will pause here and the next interviewer will join shortly.'
      : 'Thank you for your answer. We will pause this round here, and the next interviewer will join shortly.';
  }

  if (action === 'session_complete') {
    if (earlyExit) {
      return '感谢你的时间。基于今天的交流，我们先在这里结束面试，后续结果会通过平台通知。';
    }
    return timedOut
      ? '本场面试时间已到，今天的面试先到这里。感谢你的时间。'
      : '感谢你的回答，今天的面试到这里结束。';
  }
  return timedOut
    ? '本轮时间已到，我们先到这里，下一位面试官将很快接入。'
    : '感谢你的回答，本轮先到这里，下一位面试官将很快接入。';
}
