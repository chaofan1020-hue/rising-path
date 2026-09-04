export const ADMIN_PERMISSIONS = {
  dashboardRead: 'admin.dashboard.read',
  jobSyncWrite: 'admin.job-sync.write',
  dnaRead: 'admin.dna.read',
  dnaWrite: 'admin.dna.write',
  dnaPublish: 'admin.dna.publish',
  feedbackRead: 'admin.feedback.read',
  feedbackReview: 'admin.feedback.review',
  jobsRead: 'admin.jobs.read',
  jobsWrite: 'admin.jobs.write',
  usersRead: 'admin.users.read',
  usageExport: 'admin.usage.export',
  configWrite: 'admin.config.write',
  auditRead: 'admin.audit.read',
  rolesWrite: 'admin.roles.write',
} as const;

export type AdminPermission = typeof ADMIN_PERMISSIONS[keyof typeof ADMIN_PERMISSIONS];
