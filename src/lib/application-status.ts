export const APPLICATION_STATUSES = ['pending', 'filling', 'submitted', 'closed'] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, { zh: string; en: string }> = {
  pending: { zh: '待投递', en: 'Pending' },
  filling: { zh: '填写中', en: 'Filling' },
  submitted: { zh: '已投递', en: 'Submitted' },
  closed: { zh: '已关闭', en: 'Closed' },
};

export function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return APPLICATION_STATUSES.includes(value as ApplicationStatus);
}
