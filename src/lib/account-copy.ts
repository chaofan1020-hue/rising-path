import type { Locale } from '@/lib/language-context';

export type AccountCopy = {
  accountCenter: string;
  profileSettings: string;
  profileDescription: string;
  personalProfile: string;
  profileCardDescription: string;
  aiCredits: string;
  aiCreditsDescription: string;
  balanceDescription: string;
  viewCreditHistory: string;
  commonEntries: string;
  myResume: string;
  cockpit: string;
  profileSaved: string;
  profileSaveFailed: string;
  profileLoadFailed: string;
  passwordUpdated: string;
  passwordUpdateFailed: string;
  newPassword: string;
  passwordPlaceholder: string;
  updatePassword: string;
  updatingPassword: string;
  displayName: string;
  displayNamePlaceholder: string;
  loginEmail: string;
  saveProfile: string;
  savingProfile: string;
  chooseAvatar: string;
  avatarHint: string;
  avatarSelected: string;
  avatarUploadFailed: string;
  avatarUploading: string;
  accountFallback: string;
};

export const ACCOUNT_COPY: Record<Locale, AccountCopy> = {
  'zh-CN': {
    accountCenter: '账户中心', profileSettings: '个人资料与账号设置', profileDescription: '管理你的个人资料、登录安全和 AI 积分。', personalProfile: '个人资料', profileCardDescription: '这些信息会显示在首页右上角的个人中心。', aiCredits: 'AI 积分', aiCreditsDescription: '统一积分余额控制 AI 功能使用。', balanceDescription: '积分不足时，AI 功能会自动暂停。', viewCreditHistory: '查看积分流水', commonEntries: '常用入口', myResume: '我的简历', cockpit: '求职驾驶舱', profileSaved: '个人资料已保存', profileSaveFailed: '保存个人资料失败', profileLoadFailed: '读取个人资料失败', passwordUpdated: '密码已更新', passwordUpdateFailed: '更新密码失败', newPassword: '新密码', passwordPlaceholder: '至少 8 位', updatePassword: '更新密码', updatingPassword: '更新中...', displayName: '显示名称', displayNamePlaceholder: '例如：Alex Chen', loginEmail: '登录邮箱', saveProfile: '保存资料', savingProfile: '保存中...', chooseAvatar: '选择头像文件', avatarHint: '支持 JPG、PNG、WebP 或 GIF，最大 5MB', avatarSelected: '已选择', avatarUploadFailed: '头像上传失败', avatarUploading: '头像上传中...', accountFallback: '我的账户',
  },
  'zh-TW': {
    accountCenter: '帳戶中心', profileSettings: '個人資料與帳號設定', profileDescription: '管理你的個人資料、登入安全和 AI 積分。', personalProfile: '個人資料', profileCardDescription: '這些資訊會顯示在首頁右上角的個人中心。', aiCredits: 'AI 積分', aiCreditsDescription: '統一積分餘額控制 AI 功能使用。', balanceDescription: '積分不足時，AI 功能會自動暫停。', viewCreditHistory: '查看積分流水', commonEntries: '常用入口', myResume: '我的履歷', cockpit: '求職駕駛艙', profileSaved: '個人資料已儲存', profileSaveFailed: '儲存個人資料失敗', profileLoadFailed: '讀取個人資料失敗', passwordUpdated: '密碼已更新', passwordUpdateFailed: '更新密碼失敗', newPassword: '新密碼', passwordPlaceholder: '至少 8 位', updatePassword: '更新密碼', updatingPassword: '更新中...', displayName: '顯示名稱', displayNamePlaceholder: '例如：Alex Chen', loginEmail: '登入信箱', saveProfile: '儲存資料', savingProfile: '儲存中...', chooseAvatar: '選擇頭像檔案', avatarHint: '支援 JPG、PNG、WebP 或 GIF，最大 5MB', avatarSelected: '已選擇', avatarUploadFailed: '頭像上傳失敗', avatarUploading: '頭像上傳中...', accountFallback: '我的帳戶',
  },
  en: {
    accountCenter: 'Account center', profileSettings: 'Profile and account settings', profileDescription: 'Manage your profile, sign-in security, and AI credits.', personalProfile: 'Profile', profileCardDescription: 'This information appears in the account menu at the top right of the home page.', aiCredits: 'AI credits', aiCreditsDescription: 'Your shared credit balance controls AI feature access.', balanceDescription: 'AI features pause automatically when your balance is empty.', viewCreditHistory: 'View credit history', commonEntries: 'Quick links', myResume: 'My resume', cockpit: 'Career cockpit', profileSaved: 'Profile saved', profileSaveFailed: 'Could not save your profile', profileLoadFailed: 'Could not load your profile', passwordUpdated: 'Password updated', passwordUpdateFailed: 'Could not update password', newPassword: 'New password', passwordPlaceholder: 'At least 8 characters', updatePassword: 'Update password', updatingPassword: 'Updating...', displayName: 'Display name', displayNamePlaceholder: 'e.g. Alex Chen', loginEmail: 'Sign-in email', saveProfile: 'Save profile', savingProfile: 'Saving...', chooseAvatar: 'Choose avatar file', avatarHint: 'JPG, PNG, WebP, or GIF up to 5MB', avatarSelected: 'Selected', avatarUploadFailed: 'Avatar upload failed', avatarUploading: 'Uploading avatar...', accountFallback: 'My account',
  },
};
