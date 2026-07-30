"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export type Locale = "zh-CN" | "zh-TW" | "en";

interface LanguageContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const translations: Record<Locale, Record<string, string>> = {
  "zh-CN": {
    // 导航栏
    "nav.home": "首页",
    "nav.features": "功能",
    "nav.more": "更多",
    "nav.jobSearch": "岗位查询",
    "nav.resumeManager": "简历管理",
    "nav.aiMatch": "AI选岗",
    "nav.atsOptimize": "ATS简历优化",
    "nav.applications": "网申管理",
    "nav.admin": "后台管理",
    "nav.login": "登录",
    "nav.getStarted": "开始使用",
    // 功能卡片
    "features.title": "核心功能",
    "features.subtitle": "为您的求职之路提供全方位支持",
    "feature1.title": "AI智能选岗",
    "feature1.desc": "基于简历智能匹配岗位，精准推荐最适合的机会。",
    "feature2.title": "ATS简历优化",
    "feature2.desc": "针对ATS系统优化简历格式，提高通过率。",
    "feature3.title": "自动网申填写",
    "feature3.desc": "Chrome扩展自动填充网申表单，节省大量重复填写时间。",
    "feature4.title": "海量岗位资源",
    "feature4.desc": "聚合全球知名企业岗位信息，覆盖科技、金融、咨询等多个行业。",
    "feature5.title": "求职进度追踪",
    "feature5.desc": "实时追踪网申状态，管理求职进度，不错过任何机会。",
    "feature6.title": "专属访问码",
    "feature6.desc": "独立用户空间，数据安全可靠，支持多人协作使用。",
    // FAQs
    "faqs.title": "常见问题",
    "faqs.subtitle": "快速解答关于Rising Path平台的常见问题",
    "faqs.contact": "找不到答案？联系我们的",
    "faqs.contactLink": "客服团队",
    "faq1.q": "Rising Path是什么？",
    "faq1.a": "Rising Path是一个专为海外留学生打造的一站式求职平台，提供岗位查询、AI选岗、简历优化、自动网申等功能，帮助您高效求职。",
    "faq2.q": "如何使用访问码？",
    "faq2.a": "访问码是进入平台的凭证。在首页点击任意功能卡片，输入有效的访问码即可进入对应功能页面。每个访问码对应独立的用户空间。",
    "faq3.q": "支持哪些地区和行业？",
    "faq3.a": "我们覆盖全球主要留学目的地国家，包括美国、英国、加拿大、澳大利亚等。行业涵盖科技、金融、咨询、医疗等多个领域。",
    "faq4.q": "简历数据安全吗？",
    "faq4.a": "我们采用企业级数据加密和隔离技术，每个访问码的数据完全独立存储，确保您的信息安全。",
    "faq5.q": "如何联系客服？",
    "faq5.a": "您可以通过平台内的客服系统或发送邮件至support@risingpath.com联系我们的客服团队，我们会在24小时内回复。",
  },
  "zh-TW": {
    // 導航欄
    "nav.home": "首頁",
    "nav.features": "功能",
    "nav.more": "更多",
    "nav.jobSearch": "崗位查詢",
    "nav.resumeManager": "簡歷管理",
    "nav.aiMatch": "AI選崗",
    "nav.atsOptimize": "ATS簡歷優化",
    "nav.applications": "網申管理",
    "nav.admin": "後台管理",
    "nav.login": "登入",
    "nav.getStarted": "開始使用",
    // 功能卡片
    "features.title": "核心功能",
    "features.subtitle": "為您的求職之路提供全方位支援",
    "feature1.title": "AI智能選崗",
    "feature1.desc": "基於簡歷智能匹配崗位，精準推薦最適合的機會。",
    "feature2.title": "ATS簡歷優化",
    "feature2.desc": "針對ATS系統優化簡歷格式，提高通過率。",
    "feature3.title": "自動網申填寫",
    "feature3.desc": "Chrome擴展自動填充網申表單，節省大量重複填寫時間。",
    "feature4.title": "海量崗位資源",
    "feature4.desc": "聚合全球知名企業崗位資訊，覆蓋科技、金融、諮詢等多個行業。",
    "feature5.title": "求職進度追蹤",
    "feature5.desc": "實時追蹤網申狀態，管理求職進度，不錯過任何機會。",
    "feature6.title": "專屬訪問碼",
    "feature6.desc": "獨立用戶空間，數據安全可靠，支援多人協作使用。",
    // FAQs
    "faqs.title": "常見問題",
    "faqs.subtitle": "快速解答關於Rising Path平台的常見問題",
    "faqs.contact": "找不到答案？聯繫我們的",
    "faqs.contactLink": "客服團隊",
    "faq1.q": "Rising Path是什麼？",
    "faq1.a": "Rising Path是一個專為海外留學生打造的一站式求職平台，提供崗位查詢、AI選崗、簡歷優化、自動網申等功能，幫助您高效求職。",
    "faq2.q": "如何使用訪問碼？",
    "faq2.a": "訪問碼是進入平台的憑證。在首頁點擊任意功能卡片，輸入有效的訪問碼即可進入對應功能頁面。每個訪問碼對應獨立的用戶空間。",
    "faq3.q": "支援哪些地區和行業？",
    "faq3.a": "我們覆蓋全球主要留學目的地國家，包括美國、英國、加拿大、澳洲等。行業涵蓋科技、金融、諮詢、醫療等多個領域。",
    "faq4.q": "簡歷數據安全嗎？",
    "faq4.a": "我們採用企業級數據加密和隔離技術，每個訪問碼的數據完全獨立存儲，確保您的資訊安全。",
    "faq5.q": "如何聯繫客服？",
    "faq5.a": "您可以通過平台內的客服系統或發送郵件至support@risingpath.com聯繫我們的客服團隊，我們會在24小時內回覆。",
  },
  "en": {
    // Navigation
    "nav.home": "Home",
    "nav.features": "Features",
    "nav.more": "More",
    "nav.jobSearch": "Job Search",
    "nav.resumeManager": "Resume Manager",
    "nav.aiMatch": "AI Match",
    "nav.atsOptimize": "ATS Optimize",
    "nav.applications": "Applications",
    "nav.admin": "Admin",
    "nav.login": "Log in",
    "nav.getStarted": "Get started",
    // Features
    "features.title": "Core Features",
    "features.subtitle": "Comprehensive support for your career journey",
    "feature1.title": "AI Job Match",
    "feature1.desc": "Intelligently match jobs based on your resume, recommending the best opportunities.",
    "feature2.title": "ATS Resume Optimize",
    "feature2.desc": "Optimize resume format for ATS systems to improve success rate.",
    "feature3.title": "Auto Application",
    "feature3.desc": "Chrome extension auto-fills application forms, saving time on repetitive tasks.",
    "feature4.title": "Massive Job Resources",
    "feature4.desc": "Aggregates job info from global companies across tech, finance, consulting and more.",
    "feature5.title": "Application Tracking",
    "feature5.desc": "Track application status in real-time, manage your job search progress.",
    "feature6.title": "Exclusive Access Code",
    "feature6.desc": "Independent user space with secure data, supporting multi-user collaboration.",
    // FAQs
    "faqs.title": "Frequently Asked Questions",
    "faqs.subtitle": "Quick answers to common questions about Rising Path platform",
    "faqs.contact": "Can't find the answer? Contact our",
    "faqs.contactLink": "customer support team",
    "faq1.q": "What is Rising Path?",
    "faq1.a": "Rising Path is an all-in-one career platform designed for international students, offering job search, AI matching, resume optimization, and auto-application features.",
    "faq2.q": "How to use access code?",
    "faq2.a": "Access code is your credential to enter the platform. Click any feature card on the homepage and enter a valid access code to access the corresponding feature page.",
    "faq3.q": "Which regions and industries are supported?",
    "faq3.a": "We cover major study abroad destinations including USA, UK, Canada, Australia. Industries include tech, finance, consulting, healthcare and more.",
    "faq4.q": "Is resume data secure?",
    "faq4.a": "We use enterprise-grade encryption and data isolation. Each access code's data is stored independently to ensure your information security.",
    "faq5.q": "How to contact support?",
    "faq5.a": "You can reach our support team through the in-platform support system or email support@risingpath.com. We'll respond within 24 hours.",
  },
};

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>("en");

  useEffect(() => {
    const savedLocale = localStorage.getItem("locale") as Locale;
    if (savedLocale && ["zh-CN", "zh-TW", "en"].includes(savedLocale)) {
      setLocale(savedLocale);
    }
  }, []);

  const handleSetLocale = (newLocale: Locale) => {
    setLocale(newLocale);
    localStorage.setItem("locale", newLocale);
  };

  const t = (key: string): string => {
    return translations[locale][key] || key;
  };

  return (
    <LanguageContext.Provider value={{ locale, setLocale: handleSetLocale, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
