'use client';

import Link from 'next/link';
import {
  careerStageLabel,
  regionLabel,
  studentInitial,
  type AdminStudentIdentity,
} from '@/lib/admin-student-identity';

export function StudentIdentity({
  student,
  href,
  compact = false,
}: {
  student: AdminStudentIdentity;
  href?: string;
  compact?: boolean;
}) {
  const meta = [student.schoolName, regionLabel(student.preferredRegion), careerStageLabel(student.careerStage)]
    .filter(Boolean)
    .join(' · ');
  const showEmail = Boolean(student.emailHandle) && student.emailHandle !== student.displayName;
  const unnamed = student.nameSource === 'email' || student.nameSource === 'code' || student.nameSource === 'unknown';

  const content = (
    <div className="flex min-w-0 items-start gap-3">
      <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-900 text-xs font-medium text-white dark:bg-white dark:text-zinc-900">
        {student.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={student.avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          studentInitial(student.displayName)
        )}
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{student.displayName}</span>
          {unnamed && student.nameSource === 'email' && (
            <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">邮箱名</span>
          )}
        </span>
        {!compact && (
          <span className="mt-1 block space-y-0.5">
            {showEmail && (
              <span className="block truncate text-xs text-zinc-600 dark:text-zinc-400">{student.emailHandle}</span>
            )}
            {meta ? <span className="block truncate text-xs text-zinc-500">{meta}</span> : null}
            <span className="block font-mono text-[11px] tracking-wide text-zinc-400">{student.publicCode}</span>
          </span>
        )}
      </span>
    </div>
  );

  if (!href) return content;
  return (
    <Link href={href} className="block min-w-0 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-900">
      {content}
    </Link>
  );
}
