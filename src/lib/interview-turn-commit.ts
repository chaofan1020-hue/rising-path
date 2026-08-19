export interface InterviewTurnCommitMessage {
  role: 'interviewer' | 'candidate';
  content: string;
  round?: number;
  interviewerId?: number;
  questionHash?: string;
}

export interface AppendedInterviewTurn {
  message: InterviewTurnCommitMessage;
  turnIndex: number;
}

/**
 * Returns only the transcript entries created by the current request, while
 * preserving their absolute transcript indexes for the atomic DB commit.
 */
export function getAppendedInterviewTurns(
  messages: readonly InterviewTurnCommitMessage[],
  persistedMessageCount: number,
): AppendedInterviewTurn[] {
  if (!Number.isInteger(persistedMessageCount) || persistedMessageCount < 0 || persistedMessageCount > messages.length) {
    throw new Error('invalid persisted interview transcript length');
  }

  return messages
    .slice(persistedMessageCount)
    .map((message, offset) => ({ message, turnIndex: persistedMessageCount + offset }))
    .filter(({ message }) => Boolean(message.content?.trim()));
}
