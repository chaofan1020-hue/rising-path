import { NextResponse } from 'next/server';

const MIGRATION_ERROR_MARKERS = [
  'schema cache',
  'could not find the table',
  'could not find the function',
  'relation "public.',
  'does not exist',
] as const;

export function isAdminMigrationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return MIGRATION_ERROR_MARKERS.some((marker) => normalized.includes(marker.toLowerCase()));
}

export function adminMigrationUnavailable(
  error: unknown,
  requiredMigrations: string[],
  message: string,
): NextResponse | null {
  if (!isAdminMigrationError(error)) return null;
  return NextResponse.json({
    data: null,
    error: {
      code: 'ADMIN_MIGRATION_REQUIRED',
      message,
      requiredMigrations,
    },
  }, { status: 503 });
}
