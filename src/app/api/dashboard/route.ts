import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const accessCodeId = searchParams.get("access_code_id");

  if (!accessCodeId) {
    return NextResponse.json({ error: "Missing access code" }, { status: 400 });
  }

  const supabase = getSupabaseClient();

  const { data: resumes } = await supabase
    .from("resumes")
    .select("id, created_at, updated_at, file_name")
    .eq("access_code_id", accessCodeId)
    .order("created_at", { ascending: false })
    .limit(1);
  const latestResumeId = resumes?.[0]?.id ?? null;
  const resumeCount = resumes?.length ?? 0;

  const { data: aiMatches } = await supabase
    .from("ai_matches")
    .select("match_score, job_id")
    .eq("access_code_id", accessCodeId)
    .order("created_at", { ascending: false })
    .limit(50);
  const avgMatchScore = aiMatches?.length
    ? Math.round(
        aiMatches.reduce((s, m) => s + (m.match_score || 0), 0) /
          aiMatches.length,
      )
    : 0;

  const { data: interviews } = await supabase
    .from("interview_sessions")
    .select(
      "id, status, current_round, total_rounds, updated_at, created_at, target_company",
    )
    .eq("access_code_id", accessCodeId)
    .order("created_at", { ascending: false })
    .limit(50);
  const interviewCount = interviews?.length ?? 0;
  const latestInterview = interviews?.[0] ?? null;

  const { data: applications } = await supabase
    .from("applications")
    .select("id, status, created_at, updated_at")
    .eq("access_code_id", accessCodeId)
    .limit(200);
  const applicationCount = applications?.length ?? 0;

  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  startOfWeek.setHours(0, 0, 0, 0);
  const weeklyApplications =
    applications?.filter((a) => {
      const d = new Date(a.created_at || 0);
      return d >= startOfWeek;
    }).length ?? 0;

  const { data: favorites } = await supabase
    .from("favorites")
    .select("id, job_id, created_at, jobs!inner(id, updated_at)")
    .eq("access_code_id", accessCodeId);
  const favoriteCount = favorites?.length ?? 0;
  const recentlyUpdatedFavorites =
    favorites?.filter((f: any) => {
      const jobUpdated = new Date(f.jobs?.updated_at || 0);
      return Date.now() - jobUpdated.getTime() < 7 * 24 * 60 * 60 * 1000;
    }).length ?? 0;

  const { data: accessCode } = await supabase
    .from("access_codes")
    .select("last_used_at, created_at")
    .eq("id", accessCodeId)
    .single();

  const tsNow = Date.now();
  const daysSinceLogin = accessCode?.last_used_at
    ? Math.floor(
        (tsNow - new Date(accessCode.last_used_at).getTime()) / 86400000,
      )
    : 0;

  let phase = "preparation";
  let weeklyGoal = 0;

  if (resumeCount === 0) {
    phase = "positioning";
  } else if (
    latestInterview &&
    ["active", "ongoing"].includes(latestInterview.status) &&
    tsNow - new Date(latestInterview.updated_at).getTime() <
      7 * 86400000
  ) {
    phase = "interview";
  } else if (
    latestInterview &&
    ["completed", "ended", "finished"].includes(latestInterview.status) &&
    tsNow - new Date(latestInterview.updated_at).getTime() <
      7 * 86400000
  ) {
    phase = "review";
  } else if (applicationCount >= 3) {
    phase = "applying";
    weeklyGoal = 10;
  }

  const applicationHealth =
    weeklyGoal > 0
      ? Math.min(100, Math.round((weeklyApplications / weeklyGoal) * 100))
      : 0;

  const phaseTitleKey = `dashboard.phase.${phase}.title`;
  const phaseDescriptionKey = `dashboard.phase.${phase}.description`;
  const phaseDescriptionParams: Record<string, string | number> = {};
  if (phase === "positioning") {
    phaseDescriptionParams.count = Math.max(0, 3 - (aiMatches?.length ?? 0));
  } else if (phase === "preparation") {
    phaseDescriptionParams.score = avgMatchScore;
    phaseDescriptionParams.count = interviewCount;
  } else if (phase === "applying") {
    phaseDescriptionParams.count = applicationCount;
    phaseDescriptionParams.weekly = weeklyApplications;
    phaseDescriptionParams.goal = weeklyGoal;
  } else if (phase === "interview") {
    phaseDescriptionParams.target = latestInterview?.target_company || "";
  } else if (phase === "review") {
    phaseDescriptionParams.hours = Math.floor(
      (tsNow - new Date(latestInterview?.updated_at || 0).getTime()) /
        3600000,
    );
  }

  const actions: {
    titleKey: string;
    href: string;
    priority: "high" | "medium" | "low";
  }[] = [];
  if (resumeCount === 0) {
    actions.push({
      titleKey: "dashboard.action.uploadResume",
      href: "/resume",
      priority: "high",
    });
    actions.push({
      titleKey: "dashboard.action.browseJobs",
      href: "/jobs",
      priority: "medium",
    });
  } else {
    actions.push({
      titleKey: "dashboard.action.optimizeResume",
      href: "/optimize",
      priority: avgMatchScore < 75 ? "high" : "medium",
    });
    actions.push({
      titleKey: "dashboard.action.mockInterview",
      href: "/mock-interview",
      priority: interviewCount < 3 ? "high" : "medium",
    });
    actions.push({
      titleKey: "dashboard.action.viewMatches",
      href: "/ai-match",
      priority: "medium",
    });
  }
  if (applicationCount < 3) {
    actions.push({
      titleKey: "dashboard.action.startApplying",
      href: "/jobs",
      priority: phase === "applying" ? "high" : "low",
    });
  }

  const reminders: {
    type: string;
    titleKey: string;
    descriptionKey: string;
    descriptionParams: Record<string, string | number>;
  }[] = [];
  if (daysSinceLogin >= 7) {
    reminders.push({
      type: "stale_login",
      titleKey: "dashboard.reminder.staleLogin.title",
      descriptionKey: "dashboard.reminder.staleLogin.description",
      descriptionParams: { days: daysSinceLogin },
    });
  }
  if (recentlyUpdatedFavorites > 0) {
    reminders.push({
      type: "favorite_update",
      titleKey: "dashboard.reminder.favoriteUpdate.title",
      descriptionKey: "dashboard.reminder.favoriteUpdate.description",
      descriptionParams: { count: recentlyUpdatedFavorites },
    });
  }
  if (
    latestInterview &&
    ["completed", "ended", "finished"].includes(latestInterview.status)
  ) {
    const hoursSinceInterview = Math.floor(
      (tsNow - new Date(latestInterview.updated_at).getTime()) / 3600000,
    );
    if (hoursSinceInterview >= 24 && hoursSinceInterview <= 72) {
      reminders.push({
        type: "post_interview_review",
        titleKey: "dashboard.reminder.review.title",
        descriptionKey: "dashboard.reminder.review.description",
        descriptionParams: { hours: hoursSinceInterview },
      });
    }
  }

  const story = {
    resumeGrowthKey: resumeCount > 0 ? "dashboard.story.resume" : "dashboard.story.resumeEmpty",
    resumeGrowthParams: { count: resumeCount, score: avgMatchScore },
    interviewGrowthKey: interviewCount > 0 ? "dashboard.story.interview" : "dashboard.story.interviewEmpty",
    interviewGrowthParams: { count: interviewCount },
    mindsetGrowthKey:
      applicationCount > 0
        ? "dashboard.story.mindset"
        : "dashboard.story.mindsetEmpty",
    mindsetGrowthParams: { count: applicationCount },
  };

  return NextResponse.json({
    phase,
    phaseTitleKey,
    phaseDescriptionKey,
    phaseDescriptionParams,
    metrics: {
      resumeImpact: avgMatchScore,
      interviewStrength: interviewCount,
      applicationHealth,
      weeklyApplications,
      weeklyGoal,
    },
    actions,
    reminders,
    story,
    counts: {
      resumes: resumeCount,
      matches: aiMatches?.length ?? 0,
      interviews: interviewCount,
      applications: applicationCount,
      favorites: favoriteCount,
    },
  });
}
