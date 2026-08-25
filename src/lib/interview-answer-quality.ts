export type InterviewAnswerQuality = 'substantive' | 'severely_poor';

const REFUSAL_OR_NON_ANSWER = /(?:不知道|不清楚|没做过|没有相关经验|没有经验|不会|没想过|随便说说|无可奉告|no\s+idea|don't\s+know|do\s+not\s+know|not\s+sure|haven't\s+done|no\s+experience|cannot\s+answer|can't\s+answer)/iu;
const FILLER_ONLY = /^(?:嗯+|呃+|额+|啊+|哦+|好吧|不知道|不清楚|h+m*|hmm+|uh+|um+|er+|ah+|no\s+idea|i\s+don't\s+know)[。.!！?？,，\s]*$/iu;

function normalizeAnswer(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function meaningfulUnitCount(value: string): number {
  const chinese = value.match(/[\u4e00-\u9fff]/g)?.length || 0;
  const latinWords = value.match(/[a-z][a-z0-9+#.-]*/gi)?.length || 0;
  return chinese + latinWords;
}

/**
 * This is intentionally conservative. It only identifies answers that are
 * clearly unusable, so one bad ASR segment cannot end a live interview.
 */
export function classifyInterviewAnswerQuality(value: string): InterviewAnswerQuality {
  const answer = normalizeAnswer(value);
  if (!answer || FILLER_ONLY.test(answer)) return 'severely_poor';

  const units = meaningfulUnitCount(answer);
  // Short transcripts are common when ASR misses words or endpointing cuts a
  // sentence. Only an explicit refusal is strong enough to count against the
  // candidate; ordinary short answers are handled by a follow-up question.
  if (REFUSAL_OR_NON_ANSWER.test(answer) && units < 24) return 'severely_poor';
  return 'substantive';
}

export function shouldEndInterviewEarly(input: {
  answer: string;
  previousAnswers: string[];
  answersThisRound: number;
}): boolean {
  if (input.answersThisRound < 3) return false;
  const previous = input.previousAnswers.slice(-2);
  if (previous.length < 2) return false;
  return previous.every((answer) => classifyInterviewAnswerQuality(answer) === 'severely_poor')
    && classifyInterviewAnswerQuality(input.answer) === 'severely_poor';
}
